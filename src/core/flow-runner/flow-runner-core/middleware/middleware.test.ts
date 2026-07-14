import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createStaticNodeRegistry, type EmittedNodeArtifactRecord, type NodeTypeEntry } from "../../../nodes/config";
import { runFlowRunnerFlow, type FlowRunnerMiddleware, type FlowRunnerNodeExecutionInput } from "../../index";

type Input = { order: string[] };
type Payload = { artifactFiles: EmittedNodeArtifactRecord[] };

const entry: NodeTypeEntry<{ artifact: string }, FlowRunnerNodeExecutionInput<Input>, Payload> = {
  nodeType: "test.middleware-node",
  validateParams: (value) => value as { artifact: string },
  describeArtifacts: ({ params }) => ({ outputs: [{ key: params.artifact, label: params.artifact, relativePath: params.artifact, required: true }] }),
  async execute({ params, working }) {
    const artifactPath = path.join(working.input.runtime.record.runDir, params.artifact);
    await writeFile(artifactPath, "ok\n", "utf8");
    return {
      status: "completed",
      payload: { artifactFiles: [{ key: params.artifact, label: params.artifact, path: artifactPath, relativePath: params.artifact }] },
    };
  },
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

function configuredNode(nodeId: string, artifact: string) {
  return { nodeId, nodeType: entry.nodeType, name: nodeId, description: nodeId, createdAt: "2026-05-29", updatedAt: "2026-05-29", params: { artifact } };
}

test("Flow Runner middleware observes flow, node, and transition lifecycle", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "flow-runner-middleware-"));
  const input: Input = { order: [] };
  const middleware: FlowRunnerMiddleware<Input> = {
    name: "recorder",
    beforeFlow: (context) => input.order.push(`beforeFlow:${context.flowId}`),
    beforeNode: (context) => input.order.push(`beforeNode:${context.qualifiedNodePath}`),
    afterNode: (context) => input.order.push(`afterNode:${context.qualifiedNodePath}:${context.result?.status}:${context.accepted}`),
    afterTransition: (context) => input.order.push(`afterTransition:${context.fromQualifiedNodePath}->${context.toQualifiedNodePath ?? "<end>"}`),
    afterFlow: (context) => input.order.push(`afterFlow:${context.runTree.status}`),
  };

  await runFlowRunnerFlow({
    artifactRoot,
    sessionId: "middleware-test",
    input,
    middlewares: [middleware],
    nodeRegistry: createStaticNodeRegistry([entry]),
    configuredNodes: [configuredNode("first", "first.txt"), configuredNode("second", "second.txt")],
    flow: {
      flowId: "middleware-flow",
      name: "Middleware flow",
      createdAt: "2026-05-29",
      updatedAt: "2026-05-29",
      initial: "first",
      nodes: {
        first: { nodeId: "first" },
        second: { nodeId: "second" },
      },
      edges: [{ from: "first", to: "second", on: "completed" }],
    },
  });

  assert.deepEqual(input.order, [
    "beforeFlow:middleware-flow",
    "beforeNode:middleware-flow.first",
    "afterNode:middleware-flow.first:completed:true",
    "afterTransition:middleware-flow.first->middleware-flow.second",
    "beforeNode:middleware-flow.second",
    "afterNode:middleware-flow.second:completed:true",
    "afterTransition:middleware-flow.second-><end>",
    "afterFlow:completed",
  ]);
});
