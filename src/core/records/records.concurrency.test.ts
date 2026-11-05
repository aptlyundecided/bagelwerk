import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runFlowRunnerFlow } from "../flow-runner";
import { flowRunnerAcceptedDir } from "../flow-runner/runRecords";
import { acceptedTreeNodeForResume } from "../flow-runner/flow-runner-core/resume/resume";
import { beginNodeObservation } from "../agent-execution/nodeObservability";
import { openRecordStoreFromEnv } from "./mirror/resolveRecords";
import { enqueueRecords } from "./mirror/recordsMirror";
import {
  configureRecords,
  createHttpExecutor,
  embedPendingDocs,
  flushRecords,
  handleRecordsTool,
  HashingEmbedder,
  ingestPaths,
  openPgliteExecutor,
  RecordStore,
  serveRecordsMcp,
  startRecordsServer,
  syncAcceptedSurfaceFromRecords,
  tryAcquireDataDirLock,
} from ".";

// Split across files so each suite gets its own process: every PGlite instance holds a large WASM heap.
async function memoryStore(): Promise<RecordStore> {
  const store = new RecordStore(await openPgliteExecutor({ dataDir: "memory://" }));
  await store.migrate();
  return store;
}

async function count(store: RecordStore, table: string, where = "true", params: unknown[] = []): Promise<number> {
  const [row] = await store.executor.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return row!.n;
}

test("records server: many clients through one owner, token required, read-only enforced", async (t) => {
  const store = await memoryStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "records-server-"));
  const server = await startRecordsServer({ executor: store.executor, recordsDir: dir, dataDir: "memory://" });
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const clients = Array.from({ length: 4 }, () => new RecordStore(createHttpExecutor({ url: server.url, token: server.token })));
  await Promise.all(clients.map((client, index) => client.apply(client.agentRunStatements({ observationDir: `/obs/${index}`, nodeId: `op-${index}` }))));
  await Promise.all(clients.map((client, index) => client.apply(client.agentRunEventStatements(`/obs/${index}`, Array.from({ length: 25 }, (_, seq) => ({ seq: seq + 1, kind: "message", summary: `client ${index} says ${seq}` }))))));
  assert.equal(await count(store, "agent_run_events"), 100);
  assert.equal((await clients[0]!.search({ query: "client says", limit: 200 })).length, 100);
  await assert.rejects(clients[1]!.readOnlyQuery("UPDATE agent_runs SET status = 'x'"), /Only SELECT/);
  const intruder = new RecordStore(createHttpExecutor({ url: server.url, token: "wrong" }));
  await assert.rejects(intruder.stats(), /unauthorized/);

  // One malformed record over HTTP is isolated; the rest of its batch still lands.
  await configureRecords(clients[2]!);
  try {
    enqueueRecords((s) => s.agentRunStatements({ observationDir: "/obs/good-1" }));
    enqueueRecords(() => [{ sql: "INSERT INTO agent_runs (observation_dir, started_at) VALUES ($1, $2)", params: ["/obs/bad", "not a timestamp"] }]);
    enqueueRecords((s) => s.agentRunStatements({ observationDir: "/obs/good-2" }));
    await flushRecords();
    assert.equal(await count(store, "agent_runs", "observation_dir IN ('/obs/good-1', '/obs/good-2')"), 2);
    assert.equal(await count(store, "agent_runs", "observation_dir = '/obs/bad'"), 0);
  } finally {
    await configureRecords(undefined);
  }
});

test("semantic + hybrid search over embedded docs; MCP tools answer", async (t) => {
  const store = await memoryStore();
  t.after(() => store.close());
  await store.apply([
    ...store.agentRunStatements({ observationDir: "/obs/a", nodeId: "sluice" }),
    ...store.agentRunEventStatements("/obs/a", [
      { seq: 1, harness: "claude-code", kind: "message", summary: "The database migration failed because the users table is locked by a long transaction" },
      { seq: 2, harness: "claude-code", kind: "message", summary: "Rendered the contract board with three bounties" },
    ]),
  ]);
  const embedder = new HashingEmbedder(256);
  const embedded = await embedPendingDocs(store, embedder);
  assert.equal(embedded.remaining, 0);
  assert.ok(embedded.embedded >= 2);
  const again = await embedPendingDocs(store, embedder);
  assert.equal(again.embedded, 0, "unchanged docs are not re-embedded");

  const semantic = await store.search({ query: "migration locked table", mode: "semantic" }, embedder);
  assert.match(semantic[0]!.snippet, /migration failed/);
  const hybrid = await store.search({ query: "migration locked" }, embedder);
  assert.deepEqual(new Set(hybrid[0]!.matchedBy), new Set(["text", "semantic"]));

  const viaTool = (await handleRecordsTool(store, embedder, "records_search", { query: "bounties", mode: "text" })) as Array<{ snippet: string }>;
  assert.match(viaTool[0]!.snippet, /bounties/);
  const viaSql = (await handleRecordsTool(store, embedder, "records_query", { sql: "SELECT count(*)::int AS n FROM agent_run_events" })) as { rows: Array<{ n: number }> };
  assert.equal(viaSql.rows[0]!.n, 2);

  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  output.on("data", (chunk) => lines.push(...String(chunk).split("\n").filter(Boolean)));
  const served = serveRecordsMcp({ store, embedder, input, output });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "records_stats", arguments: {} } })}\n`);
  input.end();
  await served;
  const byId = new Map(lines.map((line) => JSON.parse(line)).map((message) => [message.id, message]));
  assert.equal(byId.get(1).result.serverInfo.name, "bagelwerk-records");
  assert.ok(byId.get(2).result.tools.some((tool: { name: string }) => tool.name === "records_search"));
  assert.match(byId.get(3).result.content[0].text, /agent_run_events/);
});

test("flush waits only for writes enqueued before it, even while others keep writing", async () => {
  const store = await memoryStore();
  await configureRecords(store);
  let streaming = true;
  try {
    let seq = 0;
    const stream = (async () => {
      while (streaming) {
        seq += 1;
        const current = seq;
        enqueueRecords((s) => s.agentRunEventStatements("/obs/stream", [{ seq: current, kind: "message", summary: `tick ${current}` }]));
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    await flushRecords({ timeoutMs: 20_000 });
    assert.ok(Date.now() - started < 3000, `flush took ${Date.now() - started}ms`);
    streaming = false;
    await stream;
  } finally {
    streaming = false;
    await configureRecords(undefined);
    await store.close();
  }
});

test("auto mode: the in-process owner serves the store to later openers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "records-auto-"));
  const env = { BAGELWERK_RECORDS: "auto", BAGELWERK_RECORDS_DIR: dir };
  const owner = await openRecordStoreFromEnv({ env });
  assert.ok(owner && owner.store.executor.kind === "pglite");
  assert.match(owner!.description, /serving http/);
  const second = await openRecordStoreFromEnv({ env });
  assert.equal(second?.store.executor.kind, "http");
  await second!.store.apply(second!.store.agentRunStatements({ observationDir: "/obs/via-owner", nodeId: "x" }));
  assert.equal(await count(owner!.store, "agent_runs", "observation_dir = '/obs/via-owner'"), 1);
  await second!.close();
  await owner!.close();
  const reopened = await openRecordStoreFromEnv({ env, serve: false });
  assert.equal(reopened?.store.executor.kind, "pglite", "lock and advert released on close");
  await reopened!.close();
});
