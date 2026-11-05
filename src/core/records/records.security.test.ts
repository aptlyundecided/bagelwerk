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

test("read-only queries reject writes and multiple statements", async () => {
  const store = await memoryStore();
  try {
    await assert.rejects(store.readOnlyQuery("DELETE FROM node_runs"), /Only SELECT/);
    await assert.rejects(store.readOnlyQuery("WITH gone AS (DELETE FROM node_runs RETURNING 1) SELECT * FROM gone"), /read-only|permission denied|data-modifying/);
    await assert.rejects(store.readOnlyQuery("SELECT 1; SELECT 2"), /one SQL statement/i);
    const ok = await store.readOnlyQuery("SELECT * FROM (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12)) AS v(n)", [], { maxRows: 10 });
    assert.equal(ok.rows.length, 10);
    assert.equal(ok.truncated, true);
  } finally {
    await store.close();
  }
});

test("data dir lock admits one live holder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "records-lock-"));
  const first = tryAcquireDataDirLock(path.join(dir, "pgdata"), "test");
  assert.ok(first);
  assert.equal(tryAcquireDataDirLock(path.join(dir, "pgdata"), "test"), undefined);
  first!.release();
  const again = tryAcquireDataDirLock(path.join(dir, "pgdata"), "test");
  assert.ok(again);
  again!.release();
});

test("agent SQL is SELECT-only, row-capped in SQL, and cannot read artifact bodies", async () => {
  const store = await memoryStore();
  try {
    await store.apply(store.nodeArtifactStatements("/run", [{ relativePath: "a.md", present: true, contentText: "secret body" }]));
    await assert.rejects(store.readOnlyQuery("SELECT content_text FROM node_artifacts"), /permission denied/);
    const ok = await store.readOnlyQuery("SELECT relative_path FROM node_artifacts");
    assert.equal(ok.rows.length, 1);
    await assert.rejects(store.readOnlyQuery("COPY (SELECT 1) TO '/tmp/x'"), /Only SELECT/);
    await assert.rejects(store.readOnlyQuery("SELECT pg_sleep(100)"), /not allowed/);
    await assert.rejects(store.readOnlyQuery("SELECT pg_read_file('PG_VERSION')"), /not allowed/);
    await assert.rejects(store.readOnlyQuery('SELECT "pg_sleep"(100)'), /not allowed/);
    await assert.rejects(store.readOnlyQuery("WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT 1 FROM r) SELECT count(*) FROM r"), /not allowed/);
    await assert.rejects(store.readOnlyQuery("SELECT record FROM acceptances"), /permission denied/);
    assert.equal((await store.readOnlyQuery("SELECT 'pg_sleep(1) in a string is fine' AS s")).rows.length, 1);
    await store.apply(store.agentRunEventStatements("/obs/cap", Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, kind: "message", summary: `e${i}` }))));
    const capped = await store.readOnlyQuery("SELECT seq FROM agent_run_events", [], { maxRows: 5 });
    assert.equal(capped.rows.length, 5);
    assert.equal(capped.truncated, true);
  } finally {
    await store.close();
  }
});

test("redaction keeps token counts and the acceptance record exact", async () => {
  const store = await memoryStore();
  try {
    await store.apply([
      ...store.agentRunStatements({ observationDir: "/obs/t" }),
      ...store.agentFileStatements("/obs/t", "summary.json", JSON.stringify({ executionStatus: "completed", usage: { inputTokens: 1200, output_tokens: 34 }, apiKey: "abc", token: "xyz" })),
      ...store.acceptanceStatements({ artifactRoot: "/r", sessionId: "sk-learn-experiment-0123456789abcdefghij", nodePath: "n", runDir: "/r/x/run-001", record: { acceptedAt: new Date().toISOString(), runDir: "/r/x/run-001", note: "Bearer abcdefghijklmnopqrstuvwxyz" } }),
    ]);
    const [run] = await store.executor.query<{ usage: Record<string, unknown>; summary: Record<string, unknown> }>("SELECT usage, summary FROM agent_runs");
    assert.deepEqual(run!.usage, { inputTokens: 1200, output_tokens: 34 });
    assert.equal(run!.summary.apiKey, "[redacted]");
    assert.equal(run!.summary.token, "[redacted]");
    const [acc] = await store.executor.query<{ record: { note: string } }>("SELECT record FROM acceptances");
    assert.equal(acc!.record.note, "Bearer abcdefghijklmnopqrstuvwxyz");
  } finally {
    await store.close();
  }
});
