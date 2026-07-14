import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { listExternalFlows } from "../flow-runner";
import { runSupervisedExternalFlow } from "./runSupervisedFlow";

const execFileAsync = promisify(execFile);

async function createSupervisedExternalFlowWorkspace(): Promise<string> {
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
  await writeFile(path.join(root, "supervisedSmokeFlow.mjs"), flowModuleSource(), "utf8");
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

function flowModuleSource(): string {
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

const nodeTypeEntry = {
  nodeType: "supervised-smoke.write",
  validateParams: (value) => value ?? {},
  execute: async ({ working }) => {
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
