import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteExecutor } from './sql/pgliteExecutor';
import { startRecordsServer } from './server/recordsServer';

function waitFor(child: ChildProcess, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null) => onError(new Error(`Child exited before ${type}: ${code}`));
    const onMessage = (message: { type: string; message?: string }) => {
      if (message.type === 'failure') onError(new Error(message.message));
      else if (message.type === type) { cleanup(); resolve(); }
    };
    child.on('message', onMessage); child.once('exit', onExit); child.once('error', onError);
  });
}

const callers = Number(process.env.BAGELWERK_RECORDS_TEST_CALLERS ?? 10);
assert.ok(Number.isInteger(callers) && callers >= 1 && callers <= 100, 'BAGELWERK_RECORDS_TEST_CALLERS must be an integer from 1 to 100');

test(`${callers} separate callers wait behind an occupied database, remain responsive, and finish intact`, { timeout: 25_000 }, async (t) => {
  const db = await PGlite.create();
  const executor = createPgliteExecutor(db);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bagelwerk-waiting-'));
  let release!: () => void;
  let entered!: () => void;
  let allArrived!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const arrived = new Promise<void>(resolve => { allArrived = resolve; });
  let requests = 0;
  const server = await startRecordsServer({
    executor: { ...executor, transaction(statements) {
      requests += 1;
      if (requests === callers) allArrived();
      return executor.transaction(statements);
    } }, recordsDir: dir, dataDir: 'memory://',
  });
  const children: ChildProcess[] = [];
  let blocker: Promise<void> | undefined;
  t.after(async () => {
    release();
    for (const child of children) if (child.exitCode === null) child.kill();
    await blocker;
    await server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await db.exec('CREATE TABLE waiting_probe (sequence serial PRIMARY KEY, caller integer, step text)');
  blocker = db.transaction(async () => { entered(); await gate; });
  await started;
  for (let i = 0; i < callers; i++) children.push(fork(path.join(__dirname, 'records-request-worker.ts'), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env: { ...process.env, BAGELWERK_RECORDS: 'off' },
  }));
  await Promise.all(children.map(child => waitFor(child, 'ready')));
  let completed = 0;
  const done = Promise.all(children.map(child => waitFor(child, 'done').then(() => { completed += 1; })));
  // Attach a handler immediately so an early child failure is never an unhandled rejection.
  void done.catch(() => undefined);
  children.forEach((child, index) => child.send({ type: 'request', url: server.url, token: server.token, index }));
  await arrived;
  const responsive = Promise.all(children.map(child => waitFor(child, 'pong')));
  children.forEach(child => child.send({ type: 'ping' }));
  await responsive;
  assert.equal(completed, 0, 'all requests wait while the database transaction is held');
  release();
  await blocker;
  await done;
  assert.equal(completed, callers);
  const { rows } = await db.query<{ caller: number; step: string }>('SELECT caller, step FROM waiting_probe ORDER BY sequence');
  assert.equal(rows.length, callers * 2);
  assert.equal(new Set(rows.map(row => row.caller)).size, callers);
  for (let i = 0; i < rows.length; i += 2) {
    assert.equal(rows[i]!.step, 'start');
    assert.equal(rows[i + 1]!.step, 'end');
    assert.equal(rows[i]!.caller, rows[i + 1]!.caller, 'transactions from different callers do not interleave');
  }
});
