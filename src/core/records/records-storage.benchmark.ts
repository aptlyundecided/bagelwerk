/** Opt-in synthetic storage comparison; never opens the normal records directory. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openPgliteExecutor } from './sql/pgliteExecutor';
import { createHttpExecutor } from './sql/httpExecutor';
import { startRecordsServer } from './server/recordsServer';

const rows = 25_600;
const payloadBytes = 4096;
const samples = 200;
const burstSize = 50;
function stats(values: number[]) {
  const sorted = [...values].sort((a,b)=>a-b);
  return { count: values.length, medianMs: sorted[Math.floor(sorted.length/2)]!, p95Ms: sorted[Math.ceil(sorted.length*0.95)-1]!, maxMs: sorted[sorted.length-1]! };
}
async function directoryBytes(dir: string): Promise<number> {
  let total=0;
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    total += entry.isDirectory() ? await directoryBytes(file) : (await stat(file)).size;
  }
  return total;
}
async function run(mode: string, output: string) {
  assert.ok(['memory','disk','reopened'].includes(mode));
  const dataDir=mode==='memory'?'memory://':path.join(output,'pgdata');
  const start=performance.now();
  const db=await openPgliteExecutor({dataDir});
  const openMs=performance.now()-start;
  let server: Awaited<ReturnType<typeof startRecordsServer>> | undefined;
  try {
    let seedMs: number | null=null;
    if(mode!=='reopened') {
      await db.exec('CREATE TABLE storage_probe(id integer PRIMARY KEY, payload text NOT NULL)');
      // Keep payload bytes on disk rather than measuring compression of repeated text.
      await db.exec('ALTER TABLE storage_probe ALTER COLUMN payload SET STORAGE EXTERNAL');
      const before=performance.now();
      for(let first=1;first<=rows;first+=400) {
        await db.query(`INSERT INTO storage_probe SELECT id, (SELECT string_agg(md5(id::text || ':' || j::text), '' ORDER BY j) FROM generate_series(1,128) j) FROM generate_series($1::int,$2::int) id`,[first,Math.min(rows,first+399)]);
      }
      await db.exec('ANALYZE storage_probe');
      await db.exec('CHECKPOINT');
      seedMs=performance.now()-before;
    }
    const [count]=await db.query<{n:number}>('SELECT count(*)::int AS n FROM storage_probe');
    assert.equal(count.n,rows);
    server=await startRecordsServer({executor:db,recordsDir:path.join(output,mode+'-server'),dataDir});
    const client=createHttpExecutor({url:server.url,token:server.token});
    const scan=async()=>{
      const before=performance.now();
      const [result]=await client.query<{n:number; checksum_length:number}>('SELECT count(*)::int AS n, sum(length(md5(payload)))::int AS checksum_length FROM storage_probe');
      assert.equal(result.n,rows);assert.equal(result.checksum_length,rows*32);
      return performance.now()-before;
    };
    // First payload scan after open; OS page cache is intentionally not purged.
    const firstScanMs=await scan();
    let peakRss=process.memoryUsage().rss;
    const read=async(index:number)=>{
      const id=((index*7919)%rows)+1;
      const before=performance.now();
      const [result]=await client.query<{id:number;payload:string}>('SELECT id,payload FROM storage_probe WHERE id=$1',[id]);
      assert.equal(result.id,id);assert.equal(result.payload.length,payloadBytes);
      peakRss=Math.max(peakRss,process.memoryUsage().rss);
      return performance.now()-before;
    };
    for(let i=0;i<20;i++)await read(i);
    const individual=[];
    for(let i=0;i<samples;i++)individual.push(await read(i+20));
    const bursts=[], requestLatency=[];
    for(let round=0;round<10;round++) {
      const before=performance.now();
      requestLatency.push(...await Promise.all(Array.from({length:burstSize},(_,i)=>read(1000+round*burstSize+i))));
      bursts.push(performance.now()-before);
    }
    const scans=[];
    for(let i=0;i<3;i++)scans.push(await scan());
    const [size]=await db.query<{bytes:string}>('SELECT pg_total_relation_size(\'storage_probe\')::text AS bytes');
    const result={mode,rows,payloadBytes,payloadMiB:rows*payloadBytes/1024/1024,relationBytes:Number(size.bytes),openMs,seedMs,firstScanMs,individualReads:stats(individual),burstRequests:stats(requestLatency),burstCompletion:stats(bursts),warmFullScans:stats(scans),sampledReadPeakRssBytes:peakRss,processMaxRssBytes:process.resourceUsage().maxRSS*1024,notes:['HTTP callers in one process; not 50 OS processes.','Synthetic 4KiB payloads and simple indexed reads; not Bagelwerk records/search schema.','Reopened mode uses a fresh process; OS filesystem cache is not cleared.','Full scans compute md5 on every payload; include CPU cost.','One run per mode; timings include local host noise.']};
    await writeFile(path.join(output,mode+'.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  } finally {
    await server?.close();
    await db.close();
  }
}
async function main() {
  if(process.argv[2]==='--child') {await run(process.argv[3]!,process.argv[4]!);return;}
  const base=path.resolve('.artifacts/benchmarks');
  await mkdir(base,{recursive:true});
  const output=await mkdtemp(path.join(base,'records-storage-'));
  await writeFile(path.join(output,'settings.json'),JSON.stringify({createdAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,totalMemoryBytes:os.totalmem(),rows,payloadBytes,samples,burstSize,retention:'Keep results and disk database; no real records directory used.'},null,2));
  console.log('Benchmark output: '+output);
  for(const mode of ['memory','disk','reopened']) {
    const child=spawnSync(process.execPath,['--import','tsx',__filename,'--child',mode,output],{stdio:'inherit',env:{...process.env,BAGELWERK_RECORDS:'off'},timeout:180_000});
    if(child.error)throw child.error;
    assert.equal(child.status,0,`${mode} benchmark failed`);
  }
  const results=await Promise.all(['memory','disk','reopened'].map(async mode=>JSON.parse(await readFile(path.join(output,mode+'.json'),'utf8'))));
  await writeFile(path.join(output,'results.json'),JSON.stringify({results,retainedDatabaseBytes:await directoryBytes(path.join(output,'pgdata'))},null,2)+'\n');
  console.log('Saved results and disk database: '+output);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
