import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listExternalFlows, runExternalFlow } from ".";

async function createExternalSmokeRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "external-powers-smoke-"));
  await writeFile(
    path.join(root, "flow.config.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      flows: [
        {
          id: "smoke",
          module: "./externalPowersFlow.mjs",
          label: "External powers smoke",
          description: "Test external flow loaded through dynamic import.",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "externalPowersFlow.mjs"),
    `import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const externalRoot = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.join(externalRoot, "external-powers-state.json");

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return { runs: 0, messages: [] };
  }
}

async function writeJsonArtifact(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\\n", "utf8");
  return { key: relativePath, label: relativePath, path: filePath, relativePath };
}

const configuredNode = {
  nodeId: "external-powers.prepare-state",
  nodeType: "external-powers.prepare-state",
  name: "prepare-state",
  description: "Writes state beside the external flow module.",
  createdAt: "2026-05-28",
  updatedAt: "2026-05-28",
  params: {},
};

const nodeTypeEntry = {
  nodeType: "external-powers.prepare-state",
  validateParams: (value) => value ?? {},
  execute: async ({ working }) => {
    const state = await readState();
    const next = {
      runs: state.runs + 1,
      messages: [...state.messages, "external powers online"],
    };
    await writeFile(statePath, JSON.stringify(next, null, 2) + "\\n", "utf8");
    const artifact = await writeJsonArtifact(working.input.runtime.record.runDir, "external-powers-result.json", {
      statePath,
      state: next,
    });
    return {
      status: "completed",
      note: "External powers state written.",
      payload: { artifactFiles: [artifact] },
    };
  },
  describeArtifacts: () => ({
    outputs: [{ key: "external-powers-result", label: "External powers result", relativePath: "external-powers-result.json", kind: "contract" }],
  }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

export default {
  label: "External powers smoke",
  description: "Dynamic import smoke flow.",
  workspaceName: "external-powers-smoke",
  flow: {
    flowId: "smoke",
    name: "External powers smoke",
    createdAt: "2026-05-28",
    updatedAt: "2026-05-28",
    initial: "prepare-state",
    nodes: {
      "prepare-state": { nodeId: "external-powers.prepare-state" },
    },
    edges: [],
  },
  configuredNodes: [configuredNode],
  nodeRegistry: {
    get(nodeType) {
      return nodeType === nodeTypeEntry.nodeType ? nodeTypeEntry : undefined;
    },
    list() {
      return [nodeTypeEntry];
    },
  },
};
`,
    "utf8",
  );
  return root;
}

test("lists external flows from CWD-resolved flow.config.json", async () => {
  const root = await createExternalSmokeRepo();
  const flows = await listExternalFlows(root);
  assert.equal(flows.length, 1);
  assert.equal(flows[0]!.localId, "smoke");
  assert.match(flows[0]!.id, /^external-powers-smoke-.+:smoke$/);
  assert.equal(flows[0]!.label, "External powers smoke");
});

test("runs an external flow through Generic Flow Runner and preserves in-place state", async () => {
  const root = await createExternalSmokeRepo();
  const [flow] = await listExternalFlows(root);
  assert.ok(flow);

  const result = await runExternalFlow({ cwd: root, flowId: flow.id, sessionId: "demo", input: { env: {} } });

  assert.equal(result.run.runTree.status, "completed");
  assert.equal(result.run.runTree.flowId, flow.id);

  const state = JSON.parse(await readFile(path.join(root, "external-powers-state.json"), "utf8"));
  assert.equal(state.runs, 1);
  assert.deepEqual(state.messages, ["external powers online"]);
});
