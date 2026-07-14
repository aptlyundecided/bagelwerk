import assert from "node:assert/strict";
import test from "node:test";

import { createNodeRunner } from "../../nodes";
import { createStaticNodeRegistry } from "../../nodes/config";
import { createStaticFlowNodeLibrary } from "./flowNodeLibrary";
import { compileConfiguredFlowSpec, listResolvedFlowNodeTargets, resolveFlowNodeTarget } from "./compileConfiguredFlow";
import { runConfiguredFlowFromNode, runConfiguredFlowNode } from "./runConfiguredFlow";

test("compileConfiguredFlowSpec flattens nested flow authoring into qualified node paths", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.alpha",
      nodeType: "test.echo",
      name: "Alpha",
      description: "Alpha node",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      params: { note: "alpha" },
    },
    {
      nodeId: "node.beta",
      nodeType: "test.echo",
      name: "Beta",
      description: "Beta node",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      params: { note: "beta" },
    },
  ]);

  const compiled = compileConfiguredFlowSpec<undefined>({
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      initial: "alpha",
      nodes: {
        alpha: {
          nodeId: "node.alpha",
        },
      },
      flows: {
        nested: {
          flowId: "nested",
          name: "Nested",
          createdAt: "2026-05-15",
          updatedAt: "2026-05-15",
          initial: "beta",
          nodes: {
            beta: {
              nodeId: "node.beta",
              acceptedArtifacts: [{ from: "root.alpha", relativePath: "alpha.json" }],
            },
          },
          edges: [],
        },
      },
      edges: [{ from: "alpha", to: "root.nested.beta", on: "completed" }],
    },
    nodeLibrary,
    nodeRegistry: registry,
  });

  assert.deepEqual(Object.keys(compiled.resolved.nodesByPath).sort(), ["root.alpha", "root.nested.beta"]);
  assert.equal(compiled.resolved.initialNodePath, "root.alpha");
  assert.equal(compiled.resolved.nodesByPath["root.nested.beta"]?.acceptedArtifacts[0]?.fromQualifiedPath, "root.alpha");
});

test("compileConfiguredFlowSpec resolves Flow executionPolicy inheritance and overlays", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.leaf",
      nodeType: "test.echo",
      name: "Leaf",
      description: "Leaf node",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      params: { note: "leaf" },
    },
  ]);

  const compiled = compileConfiguredFlowSpec<undefined>({
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
          initial: "leaf",
          executionPolicy: { agent: { model: "lane-model" } },
          nodes: { leaf: { nodeId: "node.leaf" } },
          edges: [],
        },
      },
      edges: [],
    },
    nodeLibrary,
    nodeRegistry: registry,
    options: {
      executionPolicyOverlay: {
        agent: { provider: "opencode" },
        paths: {
          "root.lane": { agent: { runtime: "opencode", model: "gemma" } },
        },
      },
    },
  });

  assert.deepEqual(compiled.resolved.nodesByPath["root.lane.leaf"]?.executionPolicy, {
    agent: { runtime: "opencode", provider: "opencode", model: "gemma" },
  });
  assert.deepEqual(compiled.resolved.nodesByPath["root.lane.leaf"]?.executionPolicySources, [
    { kind: "flow", path: "root" },
    { kind: "flow", path: "root.lane" },
    { kind: "run-overlay", path: "<global>" },
    { kind: "run-overlay", path: "root.lane" },
  ]);
});

test("compileConfiguredFlowSpec rejects unknown executionPolicy overlay Flow paths", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.alpha",
      nodeType: "test.echo",
      name: "Alpha",
      description: "Alpha node",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      params: { note: "alpha" },
    },
  ]);

  assert.throws(
    () => compileConfiguredFlowSpec<undefined>({
      flow: {
        flowId: "root",
        name: "Root",
        createdAt: "2026-05-23",
        updatedAt: "2026-05-23",
        initial: "alpha",
        nodes: { alpha: { nodeId: "node.alpha" } },
        edges: [],
      },
      nodeLibrary,
      nodeRegistry: registry,
      options: { executionPolicyOverlay: { paths: { "root.missing": { agent: { runtime: "opencode" } } } } },
    }),
    /unknown Flow path: root\.missing/,
  );
});

test("runConfiguredFlowNode passes resolved executionPolicy to Node execution", async () => {
  let observedRuntime: string | undefined;
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.observe-policy",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ executionPolicy }) => {
        observedRuntime = executionPolicy?.agent?.runtime;
        return { status: "completed", payload: observedRuntime };
      },
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.observe",
      nodeType: "test.observe-policy",
      name: "Observe",
      description: "Observe policy",
      createdAt: "2026-05-23",
      updatedAt: "2026-05-23",
      params: { note: "observe" },
    },
  ]);

  await runConfiguredFlowNode(
    createNodeRunner(),
    {
      flow: {
        flowId: "root",
        name: "Root",
        createdAt: "2026-05-23",
        updatedAt: "2026-05-23",
        initial: "observe",
        executionPolicy: { agent: { runtime: "cursor" } },
        nodes: { observe: { nodeId: "node.observe" } },
        edges: [],
      },
      nodeLibrary,
      nodeRegistry: registry,
      qualifiedNodePath: "root.observe",
    },
    undefined,
    { executionPolicyOverlay: { agent: { runtime: "opencode" } } },
  );

  assert.equal(observedRuntime, "opencode");
});

test("compileConfiguredFlowSpec treats child flow keys as boundary aliases", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.a1",
      nodeType: "test.echo",
      name: "A1",
      description: "A1 node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "a1" },
    },
    {
      nodeId: "node.a2",
      nodeType: "test.echo",
      name: "A2",
      description: "A2 node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "a2" },
    },
    {
      nodeId: "node.transition",
      nodeType: "test.echo",
      name: "Transition",
      description: "Transition node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "transition" },
    },
    {
      nodeId: "node.b1",
      nodeType: "test.echo",
      name: "B1",
      description: "B1 node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "b1" },
    },
  ]);

  const compiled = compileConfiguredFlowSpec<undefined>({
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "child-a",
      nodes: {
        transition: { nodeId: "node.transition" },
      },
      flows: {
        "child-a": {
          flowId: "child-a",
          name: "Child A",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "a1",
          nodes: {
            a1: { nodeId: "node.a1" },
            a2: { nodeId: "node.a2" },
          },
          edges: [{ from: "a1", to: "a2", on: "completed" }],
        },
        "child-b": {
          flowId: "child-b",
          name: "Child B",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "b1",
          nodes: {
            b1: { nodeId: "node.b1" },
          },
          edges: [],
        },
      },
      edges: [
        { from: "child-a", to: "transition", on: "completed" },
        { from: "transition", to: "child-b", on: "completed" },
      ],
    },
    nodeLibrary,
    nodeRegistry: registry,
  });

  assert.equal(compiled.resolved.initialNodePath, "root.child-a.a1");
  assert.deepEqual(
    compiled.resolved.edges.map((edge) => [edge.fromQualifiedPath, edge.toQualifiedPath, edge.on]).sort(),
    [
      ["root.child-a.a1", "root.child-a.a2", "completed"],
      ["root.child-a.a2", "root.transition", "completed"],
      ["root.transition", "root.child-b.b1", "completed"],
    ],
  );
});

test("compileConfiguredFlowSpec expands direct Flow-to-Flow edges from child exits to child initial nodes", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.left-start",
      nodeType: "test.echo",
      name: "Left Start",
      description: "Left start node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "left-start" },
    },
    {
      nodeId: "node.left-end",
      nodeType: "test.echo",
      name: "Left End",
      description: "Left end node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "left-end" },
    },
    {
      nodeId: "node.right-start",
      nodeType: "test.echo",
      name: "Right Start",
      description: "Right start node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "right-start" },
    },
  ]);

  const compiled = compileConfiguredFlowSpec<undefined>({
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "left",
      flows: {
        left: {
          flowId: "left",
          name: "Left",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "start",
          nodes: {
            start: { nodeId: "node.left-start" },
            end: { nodeId: "node.left-end" },
          },
          edges: [{ from: "start", to: "end", on: "completed" }],
        },
        right: {
          flowId: "right",
          name: "Right",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "start",
          nodes: {
            start: { nodeId: "node.right-start" },
          },
          edges: [],
        },
      },
      edges: [{ from: "left", to: "right", on: "completed" }],
    },
    nodeLibrary,
    nodeRegistry: registry,
  });

  assert.deepEqual(
    compiled.resolved.edges.map((edge) => [edge.fromQualifiedPath, edge.toQualifiedPath, edge.on]).sort(),
    [
      ["root.left.end", "root.right.start", "completed"],
      ["root.left.start", "root.left.end", "completed"],
    ],
  );
});

test("compileConfiguredFlowSpec rejects Flow boundary accepted-artifact sources", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.source",
      nodeType: "test.echo",
      name: "Source",
      description: "Source node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "source" },
    },
    {
      nodeId: "node.sink",
      nodeType: "test.echo",
      name: "Sink",
      description: "Sink node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "sink" },
    },
  ]);

  assert.throws(
    () =>
      compileConfiguredFlowSpec<undefined>({
        flow: {
          flowId: "root",
          name: "Root",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "source-flow",
          nodes: {
            sink: {
              nodeId: "node.sink",
              acceptedArtifacts: [{ from: "source-flow", relativePath: "result.json" }],
            },
          },
          flows: {
            "source-flow": {
              flowId: "source-flow",
              name: "Source Flow",
              createdAt: "2026-05-22",
              updatedAt: "2026-05-22",
              initial: "source",
              nodes: {
                source: { nodeId: "node.source" },
              },
              edges: [],
            },
          },
          edges: [],
        },
        nodeLibrary,
        nodeRegistry: registry,
      }),
    /Artifacts are Node-scoped/,
  );
});

test("resolved flow node target helpers list and resolve human-selectable re-entry points", () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.alpha",
      nodeType: "test.echo",
      name: "Alpha",
      description: "Alpha node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "alpha" },
    },
    {
      nodeId: "node.beta",
      nodeType: "test.echo",
      name: "Beta",
      description: "Beta node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "beta" },
    },
  ]);

  const compiled = compileConfiguredFlowSpec<undefined>({
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "alpha",
      nodes: {
        alpha: { nodeId: "node.alpha" },
      },
      flows: {
        nested: {
          flowId: "nested",
          name: "Nested",
          createdAt: "2026-05-22",
          updatedAt: "2026-05-22",
          initial: "beta",
          nodes: {
            beta: { nodeId: "node.beta" },
          },
          edges: [],
        },
      },
      edges: [{ from: "alpha", to: "nested", on: "completed" }],
    },
    nodeLibrary,
    nodeRegistry: registry,
  });

  assert.deepEqual(listResolvedFlowNodeTargets(compiled.resolved), [
    {
      qualifiedPath: "root.alpha",
      flowPath: ["root"],
      flowId: "root",
      localNodeKey: "alpha",
      nodeId: "node.alpha",
      nodeName: "Alpha",
      nodeDescription: "Alpha node",
    },
    {
      qualifiedPath: "root.nested.beta",
      flowPath: ["root", "nested"],
      flowId: "nested",
      localNodeKey: "beta",
      nodeId: "node.beta",
      nodeName: "Beta",
      nodeDescription: "Beta node",
    },
  ]);
  assert.equal(resolveFlowNodeTarget(compiled.resolved, "root.nested.beta").qualifiedPath, "root.nested.beta");
  assert.equal(resolveFlowNodeTarget(compiled.resolved, "node.beta").qualifiedPath, "root.nested.beta");
  assert.equal(resolveFlowNodeTarget(compiled.resolved, "beta").qualifiedPath, "root.nested.beta");
  assert.throws(() => resolveFlowNodeTarget(compiled.resolved, "missing"), /Unknown flow node selector/);
});

test("runConfiguredFlowFromNode starts at a resolved node path and continues downstream", async () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ params }) => ({ status: "completed", payload: params.note }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.alpha",
      nodeType: "test.echo",
      name: "Alpha",
      description: "Alpha node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "alpha" },
    },
    {
      nodeId: "node.beta",
      nodeType: "test.echo",
      name: "Beta",
      description: "Beta node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "beta" },
    },
    {
      nodeId: "node.gamma",
      nodeType: "test.echo",
      name: "Gamma",
      description: "Gamma node",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: { note: "gamma" },
    },
  ]);

  const runner = createNodeRunner({ runId: "flow-resume-test" });
  const result = await runConfiguredFlowFromNode(runner, {
    flow: {
      flowId: "root",
      name: "Root",
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      initial: "alpha",
      nodes: {
        alpha: { nodeId: "node.alpha" },
        beta: { nodeId: "node.beta" },
        gamma: { nodeId: "node.gamma" },
      },
      edges: [
        { from: "alpha", to: "beta", on: "completed" },
        { from: "beta", to: "gamma", on: "completed" },
      ],
    },
    nodeLibrary,
    nodeRegistry: registry,
    qualifiedStartNodePath: "root.beta",
  }, undefined, { emitGraphLines: false });

  assert.deepEqual(result.history.map((entry) => entry.nodeId), ["root.beta", "root.gamma"]);
  assert.equal(result.working.outputsByNodeId["root.beta"]?.payload, "beta");
  assert.equal(result.working.outputsByNodeId["root.gamma"]?.payload, "gamma");
});

test("runConfiguredFlowNode executes one targeted node through the configured node seam", async () => {
  const registry = createStaticNodeRegistry([
    {
      nodeType: "test.echo",
      validateParams: (value: unknown) => value as { note: string },
      execute: async ({ nodeId, params }) => ({ status: "completed", payload: `${nodeId}:${params.note}` }),
    },
  ]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    {
      nodeId: "node.alpha",
      nodeType: "test.echo",
      name: "Alpha",
      description: "Alpha node",
      createdAt: "2026-05-15",
      updatedAt: "2026-05-15",
      params: { note: "alpha" },
    },
  ]);

  const runner = createNodeRunner({ runId: "flow-node-test" });
  const result = await runConfiguredFlowNode(runner, {
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
    nodeLibrary,
    nodeRegistry: registry,
    qualifiedNodePath: "root.alpha",
  }, undefined);

  assert.equal(result.working.outputsByNodeId["node.alpha"]?.payload, "node.alpha:alpha");
});
