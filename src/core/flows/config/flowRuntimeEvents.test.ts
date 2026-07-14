import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedFlowGraph } from "./resolvedFlow";
import {
  createFlowEnterEventsForNode,
  createFlowExitEventsForNode,
  createFlowTransitionEvents,
} from "./flowRuntimeEvents";

function node(params: { qualifiedPath: string; flowPath: string[]; localNodeKey: string }) {
  return {
    qualifiedPath: params.qualifiedPath,
    localNodeKey: params.localNodeKey,
    flowPath: params.flowPath,
    flowId: params.flowPath.at(-1) ?? "root",
    node: {
      nodeId: params.qualifiedPath,
      nodeType: "test.echo",
      name: params.localNodeKey,
      description: params.localNodeKey,
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: {},
    },
    acceptedArtifacts: [],
    outgoing: [],
  };
}

function nestedFixture(): ResolvedFlowGraph {
  return {
    rootFlowId: "root",
    rootFlowPath: ["root"],
    initialNodePath: "root.left.alpha",
    nodesByPath: {
      "root.ready": node({ qualifiedPath: "root.ready", flowPath: ["root"], localNodeKey: "ready" }),
      "root.left.alpha": node({ qualifiedPath: "root.left.alpha", flowPath: ["root", "left"], localNodeKey: "alpha" }),
      "root.right.beta": node({ qualifiedPath: "root.right.beta", flowPath: ["root", "right"], localNodeKey: "beta" }),
    },
    edges: [],
  };
}

test("createFlowEnterEventsForNode enters root through child stack", () => {
  const resolved = nestedFixture();
  const events = createFlowEnterEventsForNode({
    resolved,
    nodePath: "root.left.alpha",
    at: "2026-05-22T00:00:00.000Z",
    reason: "run-start",
  });

  assert.deepEqual(events.map((event) => [event.kind, event.qualifiedFlowPath, event.reason]), [
    ["enter", "root", "run-start"],
    ["enter", "root.left", "run-start"],
  ]);
});

test("createFlowTransitionEvents exits child flow when moving to parent node", () => {
  const resolved = nestedFixture();
  const events = createFlowTransitionEvents({
    resolved,
    fromNodePath: "root.left.alpha",
    toNodePath: "root.ready",
    at: "2026-05-22T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => [event.kind, event.qualifiedFlowPath, event.fromFlowPath, event.toFlowPath]), [
    ["exit", "root.left", "root.left", "root"],
    ["transit", "root", "root.left", "root"],
  ]);
});

test("createFlowTransitionEvents enters child flow when moving from parent to child", () => {
  const resolved = nestedFixture();
  const events = createFlowTransitionEvents({
    resolved,
    fromNodePath: "root.ready",
    toNodePath: "root.right.beta",
    at: "2026-05-22T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => [event.kind, event.qualifiedFlowPath, event.fromFlowPath, event.toFlowPath]), [
    ["transit", "root", "root", "root.right"],
    ["enter", "root.right", "root", "root.right"],
  ]);
});

test("createFlowTransitionEvents exits old child and enters new child when moving between siblings", () => {
  const resolved = nestedFixture();
  const events = createFlowTransitionEvents({
    resolved,
    fromNodePath: "root.left.alpha",
    toNodePath: "root.right.beta",
    at: "2026-05-22T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => [event.kind, event.qualifiedFlowPath, event.fromFlowPath, event.toFlowPath]), [
    ["exit", "root.left", "root.left", "root.right"],
    ["transit", "root", "root.left", "root.right"],
    ["enter", "root.right", "root.left", "root.right"],
  ]);
});

test("createFlowExitEventsForNode exits child through root stack", () => {
  const resolved = nestedFixture();
  const events = createFlowExitEventsForNode({
    resolved,
    nodePath: "root.right.beta",
    at: "2026-05-22T00:00:00.000Z",
    reason: "run-end",
  });

  assert.deepEqual(events.map((event) => [event.kind, event.qualifiedFlowPath, event.reason]), [
    ["exit", "root.right", "run-end"],
    ["exit", "root", "run-end"],
  ]);
});
