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

function demoFlow() {
  const configuredNodes = ["alpha", "beta"].map((name) => ({
    nodeId: `demo.${name}`,
    nodeType: `demo.${name}`,
    name,
    description: `${name} node`,
    createdAt: "2026-11-05",
    updatedAt: "2026-11-05",
    params: {},
  }));
  const artifactFile = async (runDir: string, relativePath: string, content: string) => {
    const filePath = path.join(runDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return { key: relativePath, label: relativePath, path: filePath, relativePath };
  };
  const entries = [
    {
      nodeType: "demo.alpha",
      validateParams: (value: unknown) => value ?? {},
      execute: async ({ working }: any) => {
        const file = await artifactFile(working.input.runtime.record.runDir, "alpha.md", "Alpha found the flux capacitor misaligned by 3 degrees.\n");
        return { status: "completed", note: "alpha wrote its finding", payload: { artifactFiles: [file] } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "alpha.md", label: "Alpha finding", relativePath: "alpha.md", kind: "report" }] }),
      collectArtifacts: ({ payload }: any) => payload?.artifactFiles ?? [],
    },
    {
      nodeType: "demo.beta",
      validateParams: (value: unknown) => value ?? {},
      execute: async ({ working }: any) => {
        const upstream = working.input.runtime.preflight.dependencies[0];
        const text = await readFile(upstream.acceptedPath, "utf8");
        const file = await artifactFile(working.input.runtime.record.runDir, "beta.md", `Beta read: ${text}`);
        return { status: "completed", note: "beta consumed alpha", payload: { artifactFiles: [file] } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "beta.md", label: "Beta summary", relativePath: "beta.md", kind: "report" }] }),
      collectArtifacts: ({ payload }: any) => payload?.artifactFiles ?? [],
    },
  ];
  return {
    flow: {
      flowId: "demo",
      name: "Demo",
      createdAt: "2026-11-05",
      updatedAt: "2026-11-05",
      initial: "alpha",
      nodes: {
        alpha: { nodeId: "demo.alpha" },
        beta: { nodeId: "demo.beta", acceptedArtifacts: [{ from: "alpha", relativePath: "alpha.md" }] },
      },
      edges: [{ from: "alpha", to: "beta", on: "completed" }],
    },
    configuredNodes,
    nodeRegistry: { get: (type: string) => entries.find((entry) => entry.nodeType === type) as any, list: () => entries as any },
  };
}

test("migrations are idempotent and enable pgvector on PGlite", async () => {
  const store = await memoryStore();
  const again = await store.migrate();
  assert.ok(again.every((outcome) => outcome.status === "already"));
  assert.equal(await store.isSemanticAvailable(), true);
  await store.close();
});

test("a flow run is mirrored live, searchable, and the store is the authority for accepted/", async (t) => {
  const store = await memoryStore();
  await configureRecords(store);
  t.after(async () => {
    await configureRecords(undefined);
    await store.close();
  });
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "records-flow-"));
  const demo = demoFlow();

  const result = await runFlowRunnerFlow({ ...demo, input: {}, sessionId: "s1", artifactRoot } as any);
  await flushRecords();
  assert.equal(result.runTree.status, "completed");

  assert.equal(await count(store, "flow_runs", "status = 'completed'"), 1);
  assert.equal(await count(store, "node_runs", "status = 'completed'"), 2);
  assert.ok((await count(store, "flow_events")) >= 6);
  const alphaAcceptance = await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha");
  assert.ok(alphaAcceptance, "alpha accepted");
  assert.ok(await store.getCurrentAcceptance(artifactRoot, "s1", "demo.beta"));
  const [beta] = await store.executor.query<{ content_text: string }>("SELECT content_text FROM node_artifacts WHERE relative_path = 'beta.md'");
  assert.match(beta!.content_text, /Beta read: Alpha found the flux capacitor/);

  const hits = await store.search({ query: "flux capacitor misaligned" });
  assert.ok(hits.some((hit) => hit.sourceKind === "node_artifact" && hit.nodePath === "demo.alpha"), JSON.stringify(hits));
  const scoped = await store.search({ query: "capacitor", nodePath: "demo.beta" });
  assert.ok(scoped.length > 0 && scoped.every((hit) => hit.nodePath === "demo.beta"));
  const fuzzy = await store.search({ query: "by 3 degr", mode: "fuzzy" });
  assert.ok(fuzzy.length > 0);

  // Authority: the accepted/ cache is rebuilt from the store when it is missing...
  const alphaAccepted = flowRunnerAcceptedDir(artifactRoot, "s1", "demo.alpha");
  const original = await readFile(path.join(alphaAccepted, "alpha.md"), "utf8");
  await rm(alphaAccepted, { recursive: true, force: true });
  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "materialized");
  assert.equal(await readFile(path.join(alphaAccepted, "alpha.md"), "utf8"), original);
  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "in-sync");

  // ...and when it disagrees with the store (here: a tampered selection and artifact).
  await writeFile(path.join(alphaAccepted, "accepted-selection.json"), JSON.stringify({ acceptedAt: "2001-01-01T00:00:00.000Z", runDir: "/nowhere/run-999" }));
  await writeFile(path.join(alphaAccepted, "alpha.md"), "tampered");
  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "materialized");
  assert.equal(await readFile(path.join(alphaAccepted, "alpha.md"), "utf8"), original);

  // Resume reads through the store: with accepted/ deleted, alpha still counts as accepted.
  await rm(alphaAccepted, { recursive: true, force: true });
  const resumed = await acceptedTreeNodeForResume({
    artifactRoot,
    sessionId: "s1",
    resolvedFlow: result.resolvedFlow as any,
    nodeRegistry: demo.nodeRegistry as any,
    qualifiedNodePath: "demo.alpha",
  });
  assert.equal(resumed?.skipReason, "resume-accepted");

  // A second run of beta alone (prefix resume) reads alpha's restored hand-off.
  await rm(alphaAccepted, { recursive: true, force: true });
  const rerun = await runFlowRunnerFlow({ ...demo, input: {}, sessionId: "s1", artifactRoot, resume: { mode: "accepted" } } as any);
  assert.equal(rerun.runTree.status, "completed");
  await flushRecords();
  assert.match(await readFile(path.join(alphaAccepted, "alpha.md"), "utf8"), /flux capacitor/);

  // Backfill into a fresh store from files yields the same records, and is idempotent.
  const fresh = await memoryStore();
  t.after(() => fresh.close());
  const first = await ingestPaths(fresh, [artifactRoot]);
  assert.equal(first.errors.length, 0, JSON.stringify(first.errors));
  const second = await ingestPaths(fresh, [artifactRoot]);
  assert.equal(second.errors.length, 0);
  for (const table of ["node_runs", "flow_runs", "flow_events", "node_artifacts"]) {
    assert.equal(await count(fresh, table), await count(store, table), `${table} parity`);
  }
  const freshAlpha = await fresh.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha");
  const liveAlpha = await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha");
  assert.equal(freshAlpha?.run_dir, liveAlpha?.run_dir);
});

test("agent observations are mirrored with prompt, events, summary, and secrets redacted", async (t) => {
  const store = await memoryStore();
  await configureRecords(store);
  t.after(async () => {
    await configureRecords(undefined);
    await store.close();
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "records-agent-"));
  const observation = await beginNodeObservation({ runId: "queue-1", nodeId: "jig" }, { env: { BAGELWERK_AGENT_ARTIFACTS_ROOT: root } });
  await observation.writeText("prompt.md", "Fix the flaky retry in the uploader. Key sk-ant-abcdefghijklmnopqrstuvwxyz0123 must not leak.");
  await observation.writeJson("input.json", { harness: "codex", model: "gpt-x", cwd: "/work" });
  await observation.appendNdjson("run-events.ndjson", { seq: 1, at: new Date().toISOString(), harness: "codex", kind: "command", phase: "completed", summary: "npm test -- uploader exited 1", detail: { exitCode: 1, output: "ECONNRESET while uploading chunk 7" } });
  await observation.appendNdjson("run-events.ndjson", { seq: 2, at: new Date().toISOString(), harness: "codex", kind: "message", summary: "The retry loop swallows ECONNRESET." });
  await observation.writeText("result.md", "Patched retry backoff.");
  await observation.finalize({ executionStatus: "completed", qualityStatus: "success", usage: { inputTokens: 10, outputTokens: 5 } });

  const run = await store.getAgentRun(path.resolve(observation.artifactDir));
  assert.ok(run);
  assert.equal(run!.harness, "codex");
  assert.equal(run!.status, "completed");
  assert.equal(run!.node_id, "jig");
  assert.match(String(run!.prompt), /\[redacted\]/);
  assert.doesNotMatch(String(run!.prompt), /sk-ant-/);
  assert.equal((run!.events as unknown[]).length, 2);

  const hits = await store.search({ query: "ECONNRESET", kinds: ["agent_event"] });
  assert.equal(hits.length, 2);
  assert.ok(hits.every((hit) => hit.harness === "codex"));
  const chunk = await store.search({ query: "chunk 7", mode: "fuzzy" });
  assert.ok(chunk.length >= 1);

  // Ingest of the same directory into a fresh store gives the same rows.
  const fresh = await memoryStore();
  t.after(() => fresh.close());
  const report = await ingestPaths(fresh, [root]);
  assert.equal(report.agentRuns, 1);
  assert.equal(report.agentRunEvents, 2);
  assert.equal(await count(fresh, "agent_run_events"), 2);
  assert.equal(await count(fresh, "agent_files"), await count(store, "agent_files"));
});

test("files-only acceptance newer than the store wins and heals the store; older loses", async (t) => {
  const store = await memoryStore();
  await configureRecords(store);
  t.after(async () => {
    await configureRecords(undefined);
    await store.close();
  });
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "records-heal-"));
  const demo = demoFlow();
  await runFlowRunnerFlow({ ...demo, input: {}, sessionId: "s1", artifactRoot } as any);
  await flushRecords();
  const storeRun = (await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha"))!.run_dir;

  // A second process ran alpha with the store busy: files only, newer acceptance.
  await configureRecords(null);
  await runFlowRunnerFlow({ ...demo, input: {}, sessionId: "s1", artifactRoot } as any);
  await configureRecords(store);
  const alphaAccepted = flowRunnerAcceptedDir(artifactRoot, "s1", "demo.alpha");
  const filesSelection = JSON.parse(await readFile(path.join(alphaAccepted, "accepted-selection.json"), "utf8"));
  assert.notEqual(path.resolve(filesSelection.runDir), storeRun);

  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "healed-store");
  const healed = await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha");
  assert.equal(healed!.run_dir, path.resolve(filesSelection.runDir), "store now points at the newer files-only run");
  assert.equal(await count(store, "node_runs", "run_dir = $1", [path.resolve(filesSelection.runDir)]), 1, "the files-only run was recorded");
  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "in-sync");

  // Withdrawal is the reset path: no current acceptance, and healing does not resurrect it.
  await store.apply(store.unacceptStatements(artifactRoot, "s1", "demo.alpha"));
  await rm(alphaAccepted, { recursive: true, force: true });
  assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "no-record");
  assert.equal(await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha"), undefined);
});

test("a reused run directory starts clean", async () => {
  const store = await memoryStore();
  await configureRecords(store);
  try {
    const runDir = path.resolve(await mkdtemp(path.join(os.tmpdir(), "records-reuse-")), "s", "nodes", "n", "runs", "run-001");
    await store.apply([
      ...store.nodeRunStatements({ runDir, artifactRoot: "/r", sessionId: "s", nodePath: "n", status: "completed", note: "old run" }),
      ...store.nodeArtifactStatements(runDir, [{ relativePath: "old.md", present: true, contentText: "old" }]),
      ...store.flowEventStatements([{ ownerRunDir: runDir, ord: 0, event: { type: "node-start" } }]),
    ]);
    const { recordNodeRunBegun } = await import("./mirror/hooks");
    recordNodeRunBegun({ artifactRoot: "/r", record: { sessionId: "s", flowId: "f", qualifiedNodePath: "n", runDir } });
    await flushRecords();
    assert.equal(await count(store, "node_artifacts", "run_dir = $1", [runDir]), 0);
    assert.equal(await count(store, "flow_events", "owner_run_dir = $1", [runDir]), 0);
    const [row] = await store.executor.query<{ status: string; note: string | null }>("SELECT status, note FROM node_runs WHERE run_dir = $1", [runDir]);
    assert.deepEqual(row, { status: "running", note: null });
  } finally {
    await configureRecords(undefined);
    await store.close();
  }
});

test("reusing a run dir withdraws acceptances that pointed at it and restores the previous one", async () => {
  const store = await memoryStore();
  await configureRecords(store);
  try {
    const base = path.resolve(await mkdtemp(path.join(os.tmpdir(), "records-reuse-acc-")));
    const run1 = path.join(base, "s", "nodes", "n", "runs", "run-001");
    const run2 = path.join(base, "s", "nodes", "n", "runs", "run-002");
    await store.apply([
      ...store.acceptanceStatements({ artifactRoot: base, sessionId: "s", nodePath: "n", runDir: run2, record: { acceptedAt: "2026-01-01T00:00:00.000Z", runDir: run2 } }),
      ...store.acceptanceStatements({ artifactRoot: base, sessionId: "s", nodePath: "n", runDir: run1, record: { acceptedAt: "2026-02-01T00:00:00.000Z", runDir: run1 } }),
    ]);
    assert.equal((await store.getCurrentAcceptance(base, "s", "n"))!.run_dir, run1);
    const { recordNodeRunBegun } = await import("./mirror/hooks");
    recordNodeRunBegun({ artifactRoot: base, record: { sessionId: "s", flowId: "f", qualifiedNodePath: "n", runDir: run1 } });
    await flushRecords();
    assert.equal((await store.getCurrentAcceptance(base, "s", "n"))!.run_dir, run2, "falls back to the last acceptance that still exists");
  } finally {
    await configureRecords(undefined);
    await store.close();
  }
});

test("unaccept withdraws the nodeId alias too and is not healed back from kept files", async () => {
  const store = await memoryStore();
  await configureRecords(store);
  try {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "records-unaccept-"));
    const demo = demoFlow();
    await runFlowRunnerFlow({ ...demo, input: {}, sessionId: "s1", artifactRoot } as any);
    await flushRecords();
    // demo nodes use qualified path === nodeId, so add an explicit alias row to exercise the alias branch.
    const current = (await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha"))!;
    await store.apply(store.acceptanceStatements({ artifactRoot, sessionId: "s1", nodePath: "alpha-alias", runDir: current.run_dir, aliasFor: "demo.alpha", record: { ...current.record, aliasForQualifiedNodePath: "demo.alpha" } }));
    await store.apply(store.unacceptStatements(artifactRoot, "s1", "demo.alpha"));
    assert.equal(await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha"), undefined);
    assert.equal(await store.getCurrentAcceptance(artifactRoot, "s1", "alpha-alias"), undefined);
    const alphaAccepted = flowRunnerAcceptedDir(artifactRoot, "s1", "demo.alpha");
    // Files kept (--keep-files): the withdrawn acceptance is not resurrected from them.
    assert.equal(await syncAcceptedSurfaceFromRecords({ artifactRoot, sessionId: "s1", nodePath: "demo.alpha", acceptedDir: alphaAccepted }), "no-record");
    assert.equal(await store.getCurrentAcceptance(artifactRoot, "s1", "demo.alpha"), undefined);
  } finally {
    await configureRecords(undefined);
    await store.close();
  }
});
