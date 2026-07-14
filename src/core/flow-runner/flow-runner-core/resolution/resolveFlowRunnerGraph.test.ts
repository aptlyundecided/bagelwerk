import assert from "node:assert/strict";
import test from "node:test";

import { createStaticFlowNodeLibrary } from "../../../flows/config";
import { resolveFlowRunnerGraph } from "./resolveFlowRunnerGraph";

const node = (nodeId: string) => ({
  nodeId,
  nodeType: "test.node",
  name: nodeId,
  description: `${nodeId} node`,
  createdAt: "2026-05-29",
  updatedAt: "2026-05-29",
  params: {},
});

const nodes = ["setup", "a", "b", "join"].map(node);

test("resolveFlowRunnerGraph flattens nested flows and expands child-flow edges from exits", () => {
  const resolved = resolveFlowRunnerGraph({
    nodeLibrary: createStaticFlowNodeLibrary(nodes),
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-29",
      updatedAt: "2026-05-29",
      initial: "setup",
      nodes: {
        setup: { nodeId: "setup" },
        join: { nodeId: "join" },
      },
      flows: {
        lane: {
          flowId: "lane",
          name: "Lane",
          createdAt: "2026-05-29",
          updatedAt: "2026-05-29",
          initial: "a",
          nodes: {
            a: { nodeId: "a" },
            b: { nodeId: "b" },
          },
          edges: [{ from: "a", to: "b", on: "completed" }],
        },
      },
      edges: [
        { from: "setup", to: "lane", on: "completed" },
        { from: "lane", to: "join", on: "completed" },
      ],
    },
  });

  assert.equal(resolved.initialNodePath, "root.setup");
  assert.deepEqual(Object.keys(resolved.nodesByPath).sort(), ["root.join", "root.lane.a", "root.lane.b", "root.setup"]);
  assert.equal(resolved.flowsByPath["root.lane"]?.initialNodePath, "root.lane.a");
  assert.deepEqual(resolved.flowsByPath["root.lane"]?.exitNodePaths, ["root.lane.b"]);
  assert.deepEqual(
    resolved.edges.map((edge) => [edge.fromQualifiedPath, edge.on, edge.toQualifiedPath]),
    [
      ["root.lane.a", "completed", "root.lane.b"],
      ["root.setup", "completed", "root.lane.a"],
      ["root.lane.b", "completed", "root.join"],
    ],
  );
});

test("resolveFlowRunnerGraph applies global and path execution-policy overlays to resolved nodes", () => {
  const resolved = resolveFlowRunnerGraph({
    nodeLibrary: createStaticFlowNodeLibrary(nodes),
    options: {
      executionPolicyOverlay: {
        agent: { provider: "global-provider" },
        paths: {
          "root.lane": { agent: { model: "lane-model" } },
        },
      },
    },
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-29",
      updatedAt: "2026-05-29",
      initial: "setup",
      nodes: { setup: { nodeId: "setup" } },
      flows: {
        lane: {
          flowId: "lane",
          name: "Lane",
          createdAt: "2026-05-29",
          updatedAt: "2026-05-29",
          initial: "a",
          nodes: { a: { nodeId: "a" } },
        },
      },
    },
  });

  assert.deepEqual(resolved.nodesByPath["root.setup"]?.executionPolicy, { agent: { provider: "global-provider" } });
  assert.deepEqual(resolved.nodesByPath["root.lane.a"]?.executionPolicy, { agent: { provider: "global-provider", model: "lane-model" } });
  assert.deepEqual(resolved.nodesByPath["root.lane.a"]?.executionPolicySources, [
    { kind: "run-overlay", path: "<global>" },
    { kind: "run-overlay", path: "root.lane" },
  ]);
});
