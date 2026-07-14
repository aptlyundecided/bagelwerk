import type { NodeGraphRunResult, NodeRunnerSpec } from "../graph";
import { runNodeGraph, type RunNodeGraphOptions } from "../graph";
import type { NodeRunner } from "../runner";
import type { NodeRegistry } from "./nodeRegistry";
import { requireNodeTypeEntry } from "./nodeRegistry";
import type { ConfiguredNodeSpec } from "./configuredNode";
import { parseConfiguredNodeSpec } from "./configuredNode";

export type CompileConfiguredNodeSpecOptions = {
  timeoutMs?: number;
};

export type RunConfiguredNodeOptions<TInput = unknown> = RunNodeGraphOptions<TInput> & CompileConfiguredNodeSpecOptions;

export function compileConfiguredNodeSpec<TInput>(
  configuredNodeInput: unknown,
  registry: NodeRegistry,
  options: CompileConfiguredNodeSpecOptions = {},
): NodeRunnerSpec<TInput> {
  const configuredNode = parseConfiguredNodeSpec(configuredNodeInput);
  const entry = requireNodeTypeEntry(registry, configuredNode.nodeType);
  const params = entry.validateParams(configuredNode.params);
  return {
    graph: {
      initial: configuredNode.nodeId,
      nodes: {
        [configuredNode.nodeId]: {
          nodeKey: configuredNode.nodeId,
          label: configuredNode.name,
          edges: [{ to: "done", when: (input) => input.nodeStatus === "completed" || input.nodeStatus === "failed" || input.nodeStatus === "timed_out" }],
        },
        done: { final: true, label: "done" },
      },
    },
    handlers: {
      [configuredNode.nodeId]: async ({ working }) =>
        entry.execute({
          nodeId: configuredNode.nodeId,
          instanceId: configuredNode.nodeId,
          params,
          working,
        }),
    },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

export async function runConfiguredNode<TInput>(
  runner: NodeRunner,
  configuredNodeInput: unknown,
  registry: NodeRegistry,
  input: TInput,
  options: RunConfiguredNodeOptions<TInput> = {},
): Promise<NodeGraphRunResult<TInput>> {
  return runNodeGraph(runner, compileConfiguredNodeSpec<TInput>(configuredNodeInput, registry, options), input, options);
}

export function configuredNodeLabel(configuredNodeInput: unknown): string {
  const configuredNode = parseConfiguredNodeSpec(configuredNodeInput as ConfiguredNodeSpec);
  return configuredNode.name;
}
