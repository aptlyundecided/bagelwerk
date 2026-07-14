import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStaticNodeRegistry } from "../nodes/config";
import { acceptFlowWorkbenchRun, acceptFlowWorkbenchRunTree, preflightWorkbenchRun, readFlowWorkbenchQueueRun, recompileFlowWorkbenchQueueRun, rerunFlowWorkbenchQueueWorkItem, runFlowWorkbenchFlow, runFlowWorkbenchNode, runFlowWorkbenchQueue, workbenchDynamicWorkItemRoot } from "./flowWorkbench";
import { workbenchAcceptedDir, workbenchLatestDir } from "./runRecords";

test("preflightWorkbenchRun fails when required accepted upstream artifacts are missing", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.node",
      validateParams: (value: unknown) => value as { value: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.value }),
      describeArtifacts: () => ({ outputs: [{ key: "out", label: "Output", relativePath: "out.txt" }] }),
    },
  ]);

  const run = await preflightWorkbenchRun({
    workspaceRoot: tempRoot,
    sessionId: "session-1",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      initial: "downstream",
      nodes: {
        upstream: { nodeId: "upstream" },
        downstream: { nodeId: "downstream", acceptedArtifacts: [{ from: "upstream", relativePath: "out.txt" }] },
      },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "upstream", nodeType: "test.node", name: "Upstream", description: "u", createdAt: "2026-05-15", updatedAt: "2026-05-15", params: { value: "u" } },
      { nodeId: "downstream", nodeType: "test.node", name: "Downstream", description: "d", createdAt: "2026-05-15", updatedAt: "2026-05-15", params: { value: "d" } },
    ],
    nodeRegistry: registry,
    qualifiedNodePath: "root.downstream",
    input: undefined,
  });

  assert.equal(run.preflight.ok, false);
  assert.equal(run.preflight.missing.length, 1);
});

test("preflightWorkbenchRun resolves legacy accepted artifacts by stable producer nodeId", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-alias-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.node",
      validateParams: (value: unknown) => value as { value: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.value }),
      describeArtifacts: () => ({ outputs: [{ key: "out", label: "Output", relativePath: "out.txt" }] }),
    },
  ]);
  const legacyAcceptedDir = workbenchAcceptedDir(tempRoot, "session-alias", "node.source");
  await mkdir(legacyAcceptedDir, { recursive: true });
  await writeFile(path.join(legacyAcceptedDir, "out.txt"), "legacy\n", "utf8");

  const run = await preflightWorkbenchRun({
    workspaceRoot: tempRoot,
    sessionId: "session-alias",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      initial: "target",
      nodes: {
        target: { nodeId: "node.target", acceptedArtifacts: [{ from: "root.lane.source", relativePath: "out.txt" }] },
      },
      flows: {
        lane: {
          flowId: "lane",
          name: "Lane",
          createdAt: "2026-05-23",
          updatedAt: "2026-05-23",
          initial: "source",
          nodes: { source: { nodeId: "node.source" } },
          edges: [],
        },
      },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "node.source", nodeType: "test.node", name: "Source", description: "s", createdAt: "2026-05-23", updatedAt: "2026-05-23", params: { value: "source" } },
      { nodeId: "node.target", nodeType: "test.node", name: "Target", description: "t", createdAt: "2026-05-23", updatedAt: "2026-05-23", params: { value: "target" } },
    ],
    nodeRegistry: registry,
    qualifiedNodePath: "root.target",
    input: undefined,
  });

  assert.equal(run.preflight.ok, true);
  assert.equal(run.preflight.dependencies[0]?.aliasResolved, true);
  assert.equal(run.preflight.dependencies[0]?.fromQualifiedPath, "root.lane.source");
  assert.equal(run.preflight.dependencies[0]?.resolvedFromQualifiedPath, "node.source");
  assert.equal((await readFile(run.preflight.dependencies[0]!.acceptedPath, "utf8")).trim(), "legacy");
});


test("preflightWorkbenchRun records effective executionPolicy and policy sources", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-policy-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.node",
      validateParams: (value: unknown) => value as { value: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.value }),
    },
  ]);

  const run = await preflightWorkbenchRun({
    workspaceRoot: tempRoot,
    sessionId: "session-policy",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      initial: "lane",
      executionPolicy: { agent: { runtime: "cursor", provider: "cursor", model: "auto" } },
      flows: {
        lane: {
          flowId: "lane",
          name: "Lane",
          createdAt: "2026-05-23",
          updatedAt: "2026-05-23",
          initial: "target",
          nodes: { target: { nodeId: "node.target" } },
          edges: [],
        },
      },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "node.target", nodeType: "test.node", name: "Target", description: "t", createdAt: "2026-05-23", updatedAt: "2026-05-23", params: { value: "target" } },
    ],
    nodeRegistry: registry,
    qualifiedNodePath: "root.lane.target",
    input: {
      executionPolicy: {
        paths: {
          "root.lane": { agent: { runtime: "opencode", provider: "opencode", model: "gemma" } },
        },
      },
    },
  });

  assert.deepEqual(run.launchSnapshot.executionPolicy, { agent: { runtime: "opencode", provider: "opencode", model: "gemma" } });
  assert.deepEqual(run.launchSnapshot.executionPolicySources, [
    { kind: "flow", path: "root" },
    { kind: "run-overlay", path: "root.lane" },
  ]);
});


test("runFlowWorkbenchNode exposes effective executionPolicy through legacy userInput fields", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-policy-input-${Date.now()}`), { recursive: true });
  let observed: unknown;
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.policy-input",
      validateParams: (value: unknown) => value as Record<string, never>,
      execute: async ({ working }) => {
        observed = working.input;
        return { status: "completed", payload: "ok" };
      },
    },
  ]);

  await runFlowWorkbenchNode({
    workspaceRoot: tempRoot,
    sessionId: "session-policy-input",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      initial: "lane",
      flows: {
        lane: {
          flowId: "lane",
          name: "Lane",
          createdAt: "2026-05-23",
          updatedAt: "2026-05-23",
          initial: "target",
          executionPolicy: { agent: { runtime: "cursor", provider: "cursor", model: "auto" } },
          nodes: { target: { nodeId: "node.target" } },
          edges: [],
        },
      },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "node.target", nodeType: "test.policy-input", name: "Target", description: "t", createdAt: "2026-05-23", updatedAt: "2026-05-23", params: {} },
    ],
    nodeRegistry: registry,
    qualifiedNodePath: "root.lane.target",
    input: {
      provider: "original",
      modelOverride: "original-model",
      executionPolicy: { paths: { "root.lane": { agent: { provider: "opencode", model: "gemma", runtime: "opencode" } } } },
    },
  });

  assert.deepEqual((observed as { userInput?: unknown }).userInput, {
    provider: "opencode",
    modelOverride: "gemma",
    agentRuntime: "opencode",
    executionPolicy: { paths: { "root.lane": { agent: { provider: "opencode", model: "gemma", runtime: "opencode" } } } },
  });
});


test("runFlowWorkbenchNode copies emitted artifacts and accepts them into the accepted surface", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-${Date.now()}-2`), { recursive: true });
  const canonicalFile = path.join(tempRoot, "canonical-output.txt");
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.node",
      validateParams: (value: unknown) => value as { value: string; filePath: string },
      execute: async ({ params }) => {
        await writeFile(params.filePath, `${params.value}\n`, "utf8");
        return { status: "completed", payload: { filePath: params.filePath } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "out", label: "Output", relativePath: "out.txt" }] }),
      collectArtifacts: ({ payload }) => [{ key: "out", label: "Output", path: (payload as { filePath: string }).filePath, relativePath: "out.txt" }],
    },
  ]);

  const run = await runFlowWorkbenchNode({
    workspaceRoot: tempRoot,
    sessionId: "session-1",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      initial: "alpha",
      nodes: {
        alpha: { nodeId: "node.alpha" },
      },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "node.alpha", nodeType: "test.node", name: "Alpha", description: "a", createdAt: "2026-05-15", updatedAt: "2026-05-15", params: { value: "alpha", filePath: canonicalFile } },
    ],
    nodeRegistry: registry,
    qualifiedNodePath: "root.alpha",
    input: undefined,
  });

  assert.equal(run.artifactExistence?.[0]?.exists, true);
  assert.deepEqual(run.flowEvents?.map((event) => [event.kind, event.qualifiedFlowPath]), [
    ["enter", "root"],
    ["exit", "root"],
  ]);
  const latestFlowEvents = JSON.parse(
    await readFile(path.join(workbenchLatestDir(tempRoot, "session-1", "root.alpha"), "flow-events.json"), "utf8"),
  ) as { schemaVersion: number; events: Array<{ kind: string; qualifiedFlowPath: string }> };
  assert.equal(latestFlowEvents.schemaVersion, 1);
  assert.deepEqual(latestFlowEvents.events.map((event) => [event.kind, event.qualifiedFlowPath]), [
    ["enter", "root"],
    ["exit", "root"],
  ]);

  await acceptFlowWorkbenchRun({ run, acceptedByKind: "user" });
  const acceptedDir = workbenchAcceptedDir(tempRoot, "session-1", "root.alpha");
  const acceptedArtifact = path.join(acceptedDir, "out.txt");
  assert.equal((await readFile(acceptedArtifact, "utf8")).trim(), "alpha");
  const acceptedFlowEvents = JSON.parse(await readFile(path.join(acceptedDir, "flow-events.json"), "utf8")) as {
    events: Array<{ kind: string; qualifiedFlowPath: string }>;
  };
  assert.deepEqual(acceptedFlowEvents.events.map((event) => [event.kind, event.qualifiedFlowPath]), [
    ["enter", "root"],
    ["exit", "root"],
  ]);
});


test("runFlowWorkbenchFlow executes a sequential Flow and accepts Node artifacts", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-flow-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.artifact",
      validateParams: (value: unknown) => value as { value: string; filePath: string },
      execute: async ({ params }) => {
        await writeFile(params.filePath, `${params.value}\n`, "utf8");
        return { status: "completed", payload: { filePath: params.filePath } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "out", label: "Output", relativePath: "out.txt" }] }),
      collectArtifacts: ({ payload }) => [{ key: "out", label: "Output", path: (payload as { filePath: string }).filePath, relativePath: "out.txt" }],
    },
  ]);
  const alphaFile = path.join(tempRoot, "alpha.txt");
  const betaFile = path.join(tempRoot, "beta.txt");

  const run = await runFlowWorkbenchFlow({
    workspaceRoot: tempRoot,
    sessionId: "session-flow",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "alpha",
      nodes: {
        alpha: { nodeId: "node.alpha" },
        beta: { nodeId: "node.beta", acceptedArtifacts: [{ from: "alpha", relativePath: "out.txt" }] },
      },
      edges: [{ from: "alpha", to: "beta", on: "completed" }],
    },
    configuredNodes: [
      { nodeId: "node.alpha", nodeType: "test.artifact", name: "Alpha", description: "a", createdAt: "2026-05-22", updatedAt: "2026-05-22", params: { value: "alpha", filePath: alphaFile } },
      { nodeId: "node.beta", nodeType: "test.artifact", name: "Beta", description: "b", createdAt: "2026-05-22", updatedAt: "2026-05-22", params: { value: "beta", filePath: betaFile } },
    ],
    nodeRegistry: registry,
    input: undefined,
  });

  assert.equal(run.runTree.status, "completed");
  assert.deepEqual(run.runTree.nodes.map((node) => node.qualifiedNodePath), ["root.alpha", "root.beta"]);
  assert.equal((await readFile(path.join(workbenchAcceptedDir(tempRoot, "session-flow", "root.alpha"), "out.txt"), "utf8")).trim(), "alpha");
  assert.equal((await readFile(path.join(workbenchAcceptedDir(tempRoot, "session-flow", "root.beta"), "out.txt"), "utf8")).trim(), "beta");
  const runTree = JSON.parse(await readFile(path.join(run.record.latestDir, "run-tree.json"), "utf8")) as { nodes: unknown[] };
  assert.equal(runTree.nodes.length, 2);
});

test("runFlowWorkbenchFlow runs static parallel Flow groups and records branch nodes", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-parallel-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { value: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.value, note: params.value }),
    },
  ]);
  const configuredNodes = ["start", "left", "right", "join"].map((name) => ({
    nodeId: `node.${name}`,
    nodeType: "test.echo",
    name,
    description: name,
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    params: { value: name },
  }));
  const flow = {
    flowId: "root",
    name: "Root",
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    initial: "start",
    nodes: {
      start: { nodeId: "node.start" },
      join: { nodeId: "node.join" },
    },
    flows: {
      left: { flowId: "left", name: "Left", createdAt: "2026-05-22", updatedAt: "2026-05-22", initial: "run", nodes: { run: { nodeId: "node.left" } }, edges: [] },
      right: { flowId: "right", name: "Right", createdAt: "2026-05-22", updatedAt: "2026-05-22", initial: "run", nodes: { run: { nodeId: "node.right" } }, edges: [] },
    },
    edges: [
      { from: "start", to: "left", on: "completed" as const },
      { from: "start", to: "right", on: "completed" as const },
      { from: "left", to: "join", on: "completed" as const },
      { from: "right", to: "join", on: "completed" as const },
    ],
  };

  const run = await runFlowWorkbenchFlow({
    workspaceRoot: tempRoot,
    sessionId: "session-parallel",
    flow,
    configuredNodes,
    nodeRegistry: registry,
    input: undefined,
    executionMode: {
      kind: "parallel-groups",
      parallelGroups: [{ after: "root.start", branches: ["root.left", "root.right"], join: "root.join" }],
    },
  });

  assert.equal(run.runTree.status, "completed");
  assert.deepEqual(run.runTree.parallelGroups[0]?.branches.map((branch) => branch.branchFlowPath), ["root.left", "root.right"]);
  assert.deepEqual(run.runTree.nodes.map((node) => node.qualifiedNodePath).sort(), ["root.join", "root.left.run", "root.right.run", "root.start"]);
  await acceptFlowWorkbenchRunTree({ run, acceptedByKind: "user", note: "idempotent bulk accept" });
});

test("runFlowWorkbenchFlow records aggregate controller artifacts", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-controller-${Date.now()}`), { recursive: true });
  const queueFile = path.join(tempRoot, "queue.json");
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.queue-controller",
      validateParams: (value: unknown) => value as { filePath: string },
      execute: async ({ params }) => {
        await writeFile(params.filePath, `${JSON.stringify({ completed: 7 })}\n`, "utf8");
        return { status: "completed", payload: { filePath: params.filePath } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "queue", label: "Queue", relativePath: "queue-result.json" }] }),
      collectArtifacts: ({ payload }) => [{ key: "queue", label: "Queue", path: (payload as { filePath: string }).filePath, relativePath: "queue-result.json" }],
    },
  ]);

  const run = await runFlowWorkbenchFlow({
    workspaceRoot: tempRoot,
    sessionId: "session-controller",
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "controller",
      nodes: { controller: { nodeId: "node.controller" } },
      edges: [],
    },
    configuredNodes: [
      { nodeId: "node.controller", nodeType: "test.queue-controller", name: "Controller", description: "c", createdAt: "2026-05-22", updatedAt: "2026-05-22", params: { filePath: queueFile } },
    ],
    nodeRegistry: registry,
    input: undefined,
  });

  assert.equal(run.runTree.status, "completed");
  assert.equal((await readFile(path.join(workbenchLatestDir(tempRoot, "session-controller", "root.controller"), "queue-result.json"), "utf8")).trim(), JSON.stringify({ completed: 7 }));
  assert.equal((await readFile(path.join(workbenchAcceptedDir(tempRoot, "session-controller", "root.controller"), "queue-result.json"), "utf8")).trim(), JSON.stringify({ completed: 7 }));
});


test("runFlowWorkbenchQueue records dynamic work items, supports rerun, and recompiles aggregate status", async () => {
  const tempRoot = await mkdir(path.join(os.tmpdir(), `flow-workbench-dynamic-${Date.now()}`), { recursive: true });
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.maybe-fail",
      validateParams: (value: unknown) => value as { value: string; filePath: string; fail?: boolean },
      execute: async ({ params }) => {
        if (params.fail) return { status: "failed", note: `planned failure ${params.value}` };
        await writeFile(params.filePath, `${params.value}\n`, "utf8");
        return { status: "completed", payload: { filePath: params.filePath } };
      },
      describeArtifacts: () => ({ outputs: [{ key: "out", label: "Output", relativePath: "out.txt" }] }),
      collectArtifacts: ({ payload }) => payload ? [{ key: "out", label: "Output", path: (payload as { filePath: string }).filePath, relativePath: "out.txt" }] : [],
    },
  ]);

  function workItem(index: number, fail = false) {
    const id = `work-item-${String(index + 1).padStart(3, "0")}`;
    const filePath = path.join(tempRoot, `${id}.txt`);
    return {
      id,
      item: { index },
      flow: {
        flowId: id,
        name: id,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        initial: "run",
        nodes: { run: { nodeId: `node.${id}` } },
        edges: [],
      },
      configuredNodes: [
        { nodeId: `node.${id}`, nodeType: "test.maybe-fail", name: id, description: id, createdAt: "2026-05-22", updatedAt: "2026-05-22", params: { value: id, filePath, fail } },
      ],
      nodeRegistry: registry,
      input: undefined,
    };
  }

  const workItems = Array.from({ length: 10 }, (_, index) => workItem(index, index === 4));
  const run = await runFlowWorkbenchQueue({
    workspaceRoot: tempRoot,
    sessionId: "session-dynamic",
    ownerQualifiedNodePath: "root.queue-controller",
    queueId: "comment-batches",
    workItems,
    concurrency: 2,
  });

  assert.equal(run.total, 10);
  assert.equal(run.status, "failed");
  assert.equal(run.completed, 9);
  assert.equal(run.failed, 1);
  assert.deepEqual(run.workItems.map((item) => item.id), workItems.map((item) => item.id));
  assert.equal(
    run.workItems[4]?.dynamicWorkItemPath,
    workbenchDynamicWorkItemRoot({ workspaceRoot: tempRoot, sessionId: "session-dynamic", ownerQualifiedNodePath: "root.queue-controller", queueId: "comment-batches", workItemId: "work-item-005" }),
  );

  const persisted = await readFlowWorkbenchQueueRun({
    workspaceRoot: tempRoot,
    sessionId: "session-dynamic",
    ownerQualifiedNodePath: "root.queue-controller",
    queueId: "comment-batches",
  });
  assert.equal(persisted.workItems.length, 10);

  const rerun = await rerunFlowWorkbenchQueueWorkItem({
    workspaceRoot: tempRoot,
    sessionId: "session-dynamic",
    ownerQualifiedNodePath: "root.queue-controller",
    queueId: "comment-batches",
    workItem: workItem(4, false),
  });
  assert.equal(rerun.status, "completed");

  const recompiled = await recompileFlowWorkbenchQueueRun({
    workspaceRoot: tempRoot,
    sessionId: "session-dynamic",
    ownerQualifiedNodePath: "root.queue-controller",
    queueId: "comment-batches",
  });
  assert.equal(recompiled.status, "completed");
  assert.equal(recompiled.completed, 10);
  assert.equal(recompiled.failed, 0);
});
