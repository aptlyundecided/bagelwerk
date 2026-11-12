import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { listExternalFlows } from "../flow-runner";
import { runSupervisedExternalFlow } from "./runSupervisedFlow";

const execFileAsync = promisify(execFile);

async function createSupervisedExternalFlowWorkspace(failures = 0): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "flow-supervisor-smoke-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["checkout", "-b", "feature/flow-supervisor-smoke"], { cwd: root });
  await writeFile(
    path.join(root, "flow.config.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      flows: [{ id: "smoke", module: "./supervisedSmokeFlow.mjs", label: "Supervised smoke" }],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(root, "supervisedSmokeFlow.mjs"), flowModuleSource(failures), "utf8");
  return root;
}

test("runSupervisedExternalFlow runs a deterministic external flow and writes supervisor report", async () => {
  const root = await createSupervisedExternalFlowWorkspace();
  const [flow] = await listExternalFlows(root);
  assert.ok(flow);

  const result = await runSupervisedExternalFlow({
    cwd: root,
    targetWorkspace: root,
    flowId: flow.id,
    sessionId: "demo",
    input: { env: {} },
    supervisorPolicy: { workspace: { allowDirtyWorktree: true } },
  });

  assert.equal(result.flowResult?.run.runTree.status, "completed");
  assert.equal(result.supervisor.status, "clean-success");
  assert.equal(result.supervisor.workspace.ok, true);
  assert.equal(result.supervisor.metrics.completedNodeCount, 1);
  assert.equal(result.supervisor.metrics.failedNodeCount, 0);
  assert.match(await readFile(result.supervisor.artifacts.summaryPath, "utf8"), /Flow Supervisor Summary/);
  assert.match(await readFile(result.supervisor.artifacts.metricsPath, "utf8"), /"completedNodeCount": 1/);
});

function flowModuleSource(failures = 0): string {
  return `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function writeJsonArtifact(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\\n", "utf8");
  return { key: relativePath, label: relativePath, path: filePath, relativePath };
}

const configuredNode = {
  nodeId: "supervised-smoke.write",
  nodeType: "supervised-smoke.write",
  name: "write",
  description: "Writes a deterministic artifact.",
  createdAt: "2026-06-04",
  updatedAt: "2026-06-04",
  params: {},
};

let attempts = 0;
const nodeTypeEntry = {
  nodeType: "supervised-smoke.write",
  validateParams: (value) => value ?? {},
  execute: async ({ working }) => {
    attempts += 1;
    if (attempts <= ${failures}) return { status: "failed", note: "fixture unavailable", payload: { attempt: attempts } };
    const artifact = await writeJsonArtifact(working.input.runtime.record.runDir, "supervised-smoke.json", { ok: true });
    return { status: "completed", note: "done", payload: { artifactFiles: [artifact] } };
  },
  describeArtifacts: () => ({ outputs: [{ key: "supervised-smoke", label: "Supervised smoke", relativePath: "supervised-smoke.json", kind: "contract" }] }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

export default {
  label: "Supervised smoke",
  workspaceName: "supervised-smoke",
  flow: {
    flowId: "smoke",
    name: "Supervised smoke",
    createdAt: "2026-06-04",
    updatedAt: "2026-06-04",
    initial: "write",
    nodes: { write: { nodeId: "supervised-smoke.write" } },
    edges: [],
  },
  configuredNodes: [configuredNode],
  nodeRegistry: {
    get(nodeType) { return nodeType === nodeTypeEntry.nodeType ? nodeTypeEntry : undefined; },
    list() { return [nodeTypeEntry]; },
  },
};
`;
}


for (const [mode, failures, maxAttempts, retries] of [
  ["observe-only", 3, 3, 0], ["resume-once", 1, 2, 1], ["bounded-retry", 5, 2, 1],
] as const) {
  test(`${mode} reports actual retries and final exhaustion in its retained ledger`, async t => {
    const root = await createSupervisedExternalFlowWorkspace(failures);
    t.after(() => rm(root, { recursive: true, force: true }));
    const [flow] = await listExternalFlows(root);
    const result = await runSupervisedExternalFlow({ cwd: root, targetWorkspace: root, flowId: flow.id, sessionId: "retry", input: {}, supervisorPolicy: { workspace: { allowDirtyWorktree: true }, recovery: { mode, maxSupervisorAttempts: maxAttempts } } });
    const raw = await readFile(result.supervisor.artifacts.ledgerPath, "utf8");
    const entries = raw.trim().split("\n").map(line => JSON.parse(line));
    const states = entries.map(entry => entry.event).filter(event => event?.type === "execution-state" && event.scope === "supervisor");
    const retryEvents = states.filter(event => event.state === "retry_in_progress");
    assert.equal(retryEvents.length, retries);
    if (retries) {
      assert.equal(retryEvents[0].attempt, 2);
      assert.equal(retryEvents[0].maxAttempts, maxAttempts);
      assert.match(retryEvents[0].reason, /failed/);
    }
    const success = failures === 1;
    assert.equal(states.some(event => event.state === "ended_unresolved"), !success);
    assert.equal(result.flowResult?.run.runTree.status, success ? "completed" : "failed");
  });
}

test("workspace guard records a blocked start without a Flow attempt", async t => {
  const root = await createSupervisedExternalFlowWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const [flow] = await listExternalFlows(root);
  const result = await runSupervisedExternalFlow({ cwd: root, targetWorkspace: root, flowId: flow.id, sessionId: "blocked", input: {} });
  assert.equal(result.flowResult, undefined);
  assert.equal(result.supervisor.status, "aborted");
  assert.match(await readFile(result.supervisor.artifacts.ledgerPath, "utf8"), /start_blocked/);
});
