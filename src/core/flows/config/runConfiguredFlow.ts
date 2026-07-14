import type { NodeGraphRunResult } from "../../nodes/graph";
import { runNodeGraph, type RunNodeGraphOptions } from "../../nodes/graph";
import type { NodeRunner } from "../../nodes/runner";
import type { NodeRegistry } from "../../nodes/config";
import { requireNodeTypeEntry, runConfiguredNode } from "../../nodes/config";
import type { FlowNodeLibrary } from "./flowNodeLibrary";
import { compileConfiguredFlowSpec, resolveFlowNodePath, type CompileConfiguredFlowSpecOptions } from "./compileConfiguredFlow";

export type RunConfiguredFlowOptions<TInput = unknown> = RunNodeGraphOptions<TInput> & CompileConfiguredFlowSpecOptions;

export async function runConfiguredFlow<TInput>(
  runner: NodeRunner,
  params: {
    flow: unknown;
    nodeLibrary: FlowNodeLibrary;
    nodeRegistry: NodeRegistry;
  },
  input: TInput,
  options: RunConfiguredFlowOptions<TInput> = {},
): Promise<NodeGraphRunResult<TInput>> {
  const compiled = compileConfiguredFlowSpec<TInput>({
    flow: params.flow,
    nodeLibrary: params.nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options,
  });
  return runNodeGraph(runner, compiled.runnerSpec, input, options);
}

export async function runConfiguredFlowFromNode<TInput>(
  runner: NodeRunner,
  params: {
    flow: unknown;
    nodeLibrary: FlowNodeLibrary;
    nodeRegistry: NodeRegistry;
    qualifiedStartNodePath: string;
  },
  input: TInput,
  options: RunConfiguredFlowOptions<TInput> = {},
): Promise<NodeGraphRunResult<TInput>> {
  const compiled = compileConfiguredFlowSpec<TInput>({
    flow: params.flow,
    nodeLibrary: params.nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options,
  });
  resolveFlowNodePath(compiled.resolved, params.qualifiedStartNodePath);
  return runNodeGraph(
    runner,
    {
      ...compiled.runnerSpec,
      graph: {
        ...compiled.runnerSpec.graph,
        initial: params.qualifiedStartNodePath,
      },
    },
    input,
    options,
  );
}

export async function runConfiguredFlowNode<TInput>(
  runner: NodeRunner,
  params: {
    flow: unknown;
    nodeLibrary: FlowNodeLibrary;
    nodeRegistry: NodeRegistry;
    qualifiedNodePath: string;
  },
  input: TInput,
  options: RunConfiguredFlowOptions<TInput> = {},
): Promise<NodeGraphRunResult<TInput>> {
  const compiled = compileConfiguredFlowSpec<TInput>({
    flow: params.flow,
    nodeLibrary: params.nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options,
  });
  const target = resolveFlowNodePath(compiled.resolved, params.qualifiedNodePath);
  const entry = requireNodeTypeEntry(params.nodeRegistry, target.node.nodeType);
  const nodeParams = entry.validateParams(target.node.params);
  return runNodeGraph(
    runner,
    {
      graph: {
        initial: target.node.nodeId,
        nodes: {
          [target.node.nodeId]: {
            nodeKey: target.node.nodeId,
            label: target.node.name,
            edges: [{ to: "done", when: (transition) => transition.nodeStatus === "completed" || transition.nodeStatus === "failed" || transition.nodeStatus === "timed_out" }],
          },
          done: { final: true, label: "done" },
        },
      },
      handlers: {
        [target.node.nodeId]: async ({ working }) => entry.execute({
          nodeId: target.node.nodeId,
          instanceId: target.node.nodeId,
          params: nodeParams,
          working,
          ...(target.executionPolicy ? { executionPolicy: target.executionPolicy } : {}),
        }),
      },
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    },
    input,
    options,
  );
}
