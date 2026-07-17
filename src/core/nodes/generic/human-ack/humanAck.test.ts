import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStaticNodeRegistry, type NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { acceptFlowWorkbenchRun, runFlowWorkbenchNode, workbenchAcceptedDir, workbenchLatestDir } from "../../../flow-workbench";
import { coreHumanAckNodeTypeEntry, runHumanAckNode, type HumanAckNodePayload } from ".";

async function tempRoot(prefix: string): Promise<string> {
  return mkdir(path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`), { recursive: true });
}

const params = {
  title: "Read the handoff",
  message: "A downstream Node will rely on this acknowledgement artifact.",
  prompt: "Press Enter to acknowledge and continue.",
  artifactBaseName: "read-handoff-ack",
};

test("core.human-ack completes on Enter and writes context archaeology artifacts", async () => {
  const root = await tempRoot("human-ack-success");
  try {
    const run = await runHumanAckNode({
      nodeId: "node.ack",
      params,
      input: {
        interaction: {
          ask: async ({ prompt, contextNote, allowEmpty }) => {
            assert.match(prompt, /Read the handoff/);
            assert.match(contextNote ?? "", /durable acknowledgement artifact/);
            assert.equal(allowEmpty, true);
            return { answer: "Looks good to continue." };
          },
        },
        runtime: { record: { runDir: root } },
      },
    });

    assert.equal(run.status, "completed");
    assert.equal(run.payload?.finalVerdict, "human_acknowledged");
    assert.equal(run.payload?.acceptEligible, true);
    assert.equal(run.payload?.acknowledgement.acknowledged, true);
    assert.equal(run.payload?.artifactFiles.length, 2);
    const json = JSON.parse(await readFile(path.join(root, "read-handoff-ack.json"), "utf8")) as HumanAckNodePayload["acknowledgement"];
    assert.equal(json.nodeType, "core.human-ack");
    assert.equal(json.acknowledged, true);
    assert.equal(json.answerText, "Looks good to continue.");
    assert.equal(json.answerLength, "Looks good to continue.".length);
    const markdown = await readFile(path.join(root, "read-handoff-ack.md"), "utf8");
    assert.match(markdown, /Context archaeology/);
    assert.match(markdown, /- Answer: Looks good to continue\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core.human-ack fails closed without interaction and records failure artifacts", async () => {
  const root = await tempRoot("human-ack-missing-interaction");
  try {
    const run = await runHumanAckNode({ nodeId: "node.ack", params, input: { workbench: { record: { runDir: root } } } });

    assert.equal(run.status, "failed");
    assert.equal(run.payload?.finalVerdict, "human_ack_interaction_unavailable");
    assert.equal(run.payload?.acceptEligible, false);
    assert.equal(run.payload?.acknowledgement.reason, "interaction_unavailable");
    const json = JSON.parse(await readFile(path.join(root, "read-handoff-ack.json"), "utf8")) as HumanAckNodePayload["acknowledgement"];
    assert.equal(json.acknowledged, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core.human-ack declares and collects handoff artifacts", async () => {
  const declared = coreHumanAckNodeTypeEntry.describeArtifacts?.({ nodeId: "node.ack", params });
  assert.deepEqual(declared?.outputs.map((artifact) => [artifact.relativePath, artifact.kind]), [
    ["read-handoff-ack.json", "handoff"],
    ["read-handoff-ack.md", "handoff"],
  ]);

  const run = await runHumanAckNode({
    nodeId: "node.ack",
    params,
    input: { interaction: { ask: async () => ({ answer: "" }) } },
  });
  assert.deepEqual(coreHumanAckNodeTypeEntry.collectArtifacts?.({ nodeId: "node.ack", params, payload: run.payload }), []);
});

test("core.human-ack artifacts can be accepted and used downstream in Flow Workbench", async () => {
  const workspaceRoot = await tempRoot("human-ack-workbench");
  const sessionId = "ack-session";
  const readerNodeTypeEntry: NodeTypeEntry<Record<string, never>, unknown, { acknowledged: boolean }> = {
    nodeType: "test.read-human-ack",
    validateParams: (value) => value as Record<string, never>,
    execute: async ({ working }): Promise<NodeResult<{ acknowledged: boolean }>> => {
      const input = working.input as { workbench?: { preflight?: { dependencies?: Array<{ relativePath: string; acceptedPath: string }> } } };
      const dependency = input.workbench?.preflight?.dependencies?.find((item) => item.relativePath === "human-ack.json");
      assert.ok(dependency, "expected accepted human-ack.json dependency");
      const artifact = JSON.parse(await readFile(dependency.acceptedPath, "utf8")) as { acknowledged: boolean };
      return { status: artifact.acknowledged ? "completed" : "failed", payload: { acknowledged: artifact.acknowledged } };
    },
  };
  const registry = createStaticNodeRegistry([coreHumanAckNodeTypeEntry, readerNodeTypeEntry]);
  const flow = {
    flowId: "root",
    name: "Root",
    createdAt: "2026-05-25",
    updatedAt: "2026-05-25",
    initial: "ack",
    nodes: {
      ack: { nodeId: "node.ack" },
      read: { nodeId: "node.read", acceptedArtifacts: [{ from: "ack", relativePath: "human-ack.json" }] },
    },
    edges: [{ from: "ack", to: "read", on: "completed" }],
  };
  const configuredNodes = [
    {
      nodeId: "node.ack",
      nodeType: "core.human-ack",
      name: "Ack",
      description: "Human ack",
      createdAt: "2026-05-25",
      updatedAt: "2026-05-25",
      params: { title: "Continue", message: "Acknowledge before reading." },
    },
    {
      nodeId: "node.read",
      nodeType: "test.read-human-ack",
      name: "Read",
      description: "Read ack",
      createdAt: "2026-05-25",
      updatedAt: "2026-05-25",
      params: {},
    },
  ];

  try {
    const ackRun = await runFlowWorkbenchNode({
      workspaceRoot,
      sessionId,
      flow,
      configuredNodes,
      nodeRegistry: registry,
      qualifiedNodePath: "root.ack",
      input: { interaction: { ask: async () => ({ answer: "" }) } },
      log: () => {},
    });
    assert.equal(ackRun.runResult?.working.outputsByNodeId["node.ack"]?.status, "completed");
    assert.equal(ackRun.artifactExistence?.every((artifact) => artifact.exists), true);
    assert.match(await readFile(path.join(workbenchLatestDir(workspaceRoot, sessionId, "root.ack"), "human-ack.md"), "utf8"), /Human Acknowledgement/);

    await acceptFlowWorkbenchRun({ run: ackRun, acceptedByKind: "user", acceptedById: "test" });
    assert.match(await readFile(path.join(workbenchAcceptedDir(workspaceRoot, sessionId, "root.ack"), "human-ack.json"), "utf8"), /"acknowledged": true/);

    const readRun = await runFlowWorkbenchNode({
      workspaceRoot,
      sessionId,
      flow,
      configuredNodes,
      nodeRegistry: registry,
      qualifiedNodePath: "root.read",
      input: {},
      log: () => {},
    });
    assert.equal(readRun.runResult?.working.outputsByNodeId["node.read"]?.status, "completed");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
