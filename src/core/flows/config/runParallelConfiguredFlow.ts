import type { NodeGraphRunResult, NodeRunnerSpec, NodeRunnerWorkingContext } from "../../nodes/graph";
import { runNodeGraph } from "../../nodes/graph";
import type { NodeRunner } from "../../nodes/runner";
import type { NodeRegistry } from "../../nodes/config";
import { compileConfiguredFlowSpec, resolveFlowNodePath, type CompileConfiguredFlowSpecOptions } from "./compileConfiguredFlow";
import type { FlowNodeLibrary } from "./flowNodeLibrary";
import type { CompiledConfiguredFlowSpec, ResolvedFlowBoundary } from "./resolvedFlow";

export type ParallelFlowGroup = {
  /** Qualified Node path that completes before branches start. */
  after: string;
  /** Qualified child Flow boundary paths to run concurrently. */
  branches: string[];
  /** Qualified Node path to start after all branches complete. */
  join: string;
};

export type ParallelFlowBranchRun<TInput = unknown> = {
  branchFlowPath: string;
  initialNodePath: string;
  exitNodePaths: string[];
  result: NodeGraphRunResult<TInput>;
};

export type ParallelConfiguredFlowRunResult<TInput = unknown> = NodeGraphRunResult<TInput> & {
  parallelGroups: Array<{
    after: string;
    join: string;
    branches: ParallelFlowBranchRun<TInput>[];
  }>;
};

export type RunParallelConfiguredFlowOptions<TInput = unknown> = CompileConfiguredFlowSpecOptions & {
  emitGraphLines?: boolean;
  initialWorking?: NodeRunnerWorkingContext<TInput>;
};

function cloneRunnerSpecWithInitial<TInput>(
  spec: NodeRunnerSpec<TInput>,
  initial: string,
  stopNodeIds: string[],
): NodeRunnerSpec<TInput> {
  const stopSet = new Set(stopNodeIds);
  const nodes: NodeRunnerSpec<TInput>["graph"]["nodes"] = Object.fromEntries(
    Object.entries(spec.graph.nodes).map(([nodeId, node]) => [
      nodeId,
      stopSet.has(nodeId)
        ? {
            ...node,
            edges: [
              { to: "done", when: (input) => input.nodeStatus === "completed" },
              { to: "done", when: (input) => input.nodeStatus === "failed" },
              { to: "done", when: (input) => input.nodeStatus === "timed_out" },
            ],
          }
        : { ...node, edges: node.edges ? [...node.edges] : undefined },
    ]),
  );

  return {
    ...spec,
    graph: {
      ...spec.graph,
      initial,
      nodes,
    },
  };
}

function requireFlowBoundary<TInput>(compiled: CompiledConfiguredFlowSpec<TInput>, flowPath: string): ResolvedFlowBoundary {
  const boundary = compiled.resolved.flowsByPath[flowPath];
  if (!boundary) {
    const available = Object.keys(compiled.resolved.flowsByPath).sort().join(", ");
    throw new Error(`Unknown parallel branch Flow '${flowPath}'. Available Flow boundaries: ${available}`);
  }
  return boundary;
}

function mergeWorkingContexts<TInput>(
  input: TInput,
  base: NodeRunnerWorkingContext<TInput>,
  branchResults: Array<NodeGraphRunResult<TInput>>,
): NodeRunnerWorkingContext<TInput> {
  const outputsByNodeId = { ...base.outputsByNodeId };
  const attemptsByNodeId = { ...base.attemptsByNodeId };
  let lastNodeId = base.lastNodeId;

  for (const result of branchResults) {
    for (const [nodeId, output] of Object.entries(result.working.outputsByNodeId)) {
      outputsByNodeId[nodeId] = output;
      lastNodeId = nodeId;
    }
    for (const [nodeId, attempts] of Object.entries(result.working.attemptsByNodeId)) {
      attemptsByNodeId[nodeId] = Math.max(attemptsByNodeId[nodeId] ?? 0, attempts);
    }
  }

  return {
    input,
    outputsByNodeId,
    attemptsByNodeId,
    ...(lastNodeId ? { lastNodeId } : {}),
  };
}

export async function runConfiguredFlowWithParallelFlows<TInput>(
  runner: NodeRunner,
  params: {
    flow: unknown;
    nodeLibrary: FlowNodeLibrary;
    nodeRegistry: NodeRegistry;
    parallelGroups: [ParallelFlowGroup, ...ParallelFlowGroup[]];
  },
  input: TInput,
  options: RunParallelConfiguredFlowOptions<TInput> = {},
): Promise<ParallelConfiguredFlowRunResult<TInput>> {
  if (params.parallelGroups.length !== 1) {
    throw new Error("runConfiguredFlowWithParallelFlows currently supports exactly one parallel Flow group.");
  }

  const compiled = compileConfiguredFlowSpec<TInput>({
    flow: params.flow,
    nodeLibrary: params.nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options,
  });
  const group = params.parallelGroups[0]!;
  resolveFlowNodePath(compiled.resolved, group.after);
  resolveFlowNodePath(compiled.resolved, group.join);

  const prefixSpec = cloneRunnerSpecWithInitial(compiled.runnerSpec, compiled.resolved.initialNodePath, [group.after]);
  const prefixResult = await runNodeGraph(runner, prefixSpec, input, options);
  const afterStatus = prefixResult.working.outputsByNodeId[group.after]?.status;
  if (afterStatus !== "completed") {
    throw new Error(`Parallel Flow group prerequisite '${group.after}' ended with status ${afterStatus ?? "unknown"}.`);
  }

  const branchRuns = await Promise.all(group.branches.map(async (branchFlowPath): Promise<ParallelFlowBranchRun<TInput>> => {
    const boundary = requireFlowBoundary(compiled, branchFlowPath);
    const branchSpec = cloneRunnerSpecWithInitial(compiled.runnerSpec, boundary.initialNodePath, boundary.exitNodePaths);
    const result = await runNodeGraph(runner, branchSpec, input, {
      ...options,
      initialWorking: prefixResult.working,
    });
    return {
      branchFlowPath,
      initialNodePath: boundary.initialNodePath,
      exitNodePaths: [...boundary.exitNodePaths],
      result,
    };
  }));

  const mergedWorking = mergeWorkingContexts(input, prefixResult.working, branchRuns.map((branch) => branch.result));
  const joinSpec = cloneRunnerSpecWithInitial(compiled.runnerSpec, group.join, []);
  const joinResult = await runNodeGraph(runner, joinSpec, input, {
    ...options,
    initialWorking: mergedWorking,
  });

  return {
    ...joinResult,
    history: [
      ...prefixResult.history,
      ...branchRuns.flatMap((branch) => branch.result.history),
      ...joinResult.history,
    ],
    parallelGroups: [{
      after: group.after,
      join: group.join,
      branches: branchRuns,
    }],
  };
}
