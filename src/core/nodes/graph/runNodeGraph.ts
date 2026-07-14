import { formatCoreRuntimeLine } from "../../terminal";
import { NodeGraphNavigator } from "./nodeGraphNavigator";
import type {
  NodeFailurePacket,
  NodeFailureResolver,
  NodeGraphRunResult,
  NodeResult,
  NodeRunHistoryEntry,
  NodeRunnerSpec,
  NodeRunnerWorkingContext,
  NodeStatus,
  NodeTransitionInput,
} from "./nodeGraphTypes";
import type { NodeRunMeta, NodeRunner } from "../runner";

class NodeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeTimeoutError";
  }
}

function isNodeStatus(value: unknown): value is NodeStatus {
  return value === "completed" || value === "failed" || value === "timed_out";
}

function isNodeResult(value: unknown): value is NodeResult<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!isNodeStatus(record.status)) return false;
  return record.note === undefined || typeof record.note === "string";
}

async function withTimeout<T>(work: () => Promise<T>, timeoutMs: number | undefined, nodeId: string): Promise<T> {
  if (timeoutMs === undefined) return work();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new NodeTimeoutError(`Node ${nodeId} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createWorkingContext<TInput>(input: TInput): NodeRunnerWorkingContext<TInput> {
  return { input, outputsByNodeId: {}, attemptsByNodeId: {} };
}

function incrementAttempt<TInput>(working: NodeRunnerWorkingContext<TInput>, nodeId: string): NodeRunnerWorkingContext<TInput> {
  return {
    ...working,
    attemptsByNodeId: {
      ...working.attemptsByNodeId,
      [nodeId]: (working.attemptsByNodeId[nodeId] ?? 0) + 1,
    },
  };
}

function storeNodeResult<TInput>(working: NodeRunnerWorkingContext<TInput>, nodeId: string, result: NodeResult<unknown>): NodeRunnerWorkingContext<TInput> {
  return {
    ...working,
    outputsByNodeId: {
      ...working.outputsByNodeId,
      [nodeId]: result,
    },
    lastNodeId: nodeId,
  };
}

function buildTransitionInput(
  nodeId: string,
  attemptCount: number,
  retryBudget: number | undefined,
  nodeResult: NodeResult<unknown>,
  threw: boolean,
  errorMessage: string | undefined,
): NodeTransitionInput<unknown> {
  return {
    nodeId,
    attemptCount,
    ...(retryBudget !== undefined ? { retryBudget } : {}),
    nodeStatus: nodeResult.status,
    ...(nodeResult.payload !== undefined ? { nodePayload: nodeResult.payload } : {}),
    ...(nodeResult.note !== undefined ? { note: nodeResult.note } : {}),
    ...(threw ? { threw: true } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

export type RunNodeGraphOptions<TInput = unknown> = {
  nodeNavigator?: NodeGraphNavigator;
  emitGraphLines?: boolean;
  initialWorking?: NodeRunnerWorkingContext<TInput>;
  failureResolver?: NodeFailureResolver<TInput>;
};

function countWorkingNodes<TInput>(spec: NodeRunnerSpec<TInput>): number {
  return Object.values(spec.graph.nodes).filter((node) => !node.final).length;
}

function buildFailurePacket<TInput>(args: {
  nodeId: string;
  nodeKey: string;
  label?: string;
  attemptCount: number;
  retryBudget?: number;
  input: TInput;
  nodeResult: NodeResult<unknown>;
  threw: boolean;
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
}): NodeFailurePacket<TInput> {
  return {
    nodeId: args.nodeId,
    nodeKey: args.nodeKey,
    ...(args.label ? { label: args.label } : {}),
    attemptCount: args.attemptCount,
    ...(args.retryBudget !== undefined ? { retryBudget: args.retryBudget } : {}),
    status: args.nodeResult.status as Exclude<NodeStatus, "completed">,
    ...(args.nodeResult.note ? { note: args.nodeResult.note } : {}),
    ...(args.nodeResult.payload !== undefined ? { payload: args.nodeResult.payload } : {}),
    threw: args.threw,
    ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    input: args.input,
  };
}

export async function runNodeGraph<TInput>(
  runner: NodeRunner,
  spec: NodeRunnerSpec<TInput>,
  input: TInput,
  options: RunNodeGraphOptions<TInput> = {},
): Promise<NodeGraphRunResult<TInput>> {
  const nodeNavigator = options.nodeNavigator ?? new NodeGraphNavigator();
  const emitGraphLines = options.emitGraphLines ?? true;
  const totalWorkingNodes = countWorkingNodes(spec);
  if (emitGraphLines) {
    runner.emitLine(formatCoreRuntimeLine("node", `graph start initial=${spec.graph.initial} nodes=${totalWorkingNodes}`));
  }

  const history: NodeRunHistoryEntry[] = [];
  let currentNodeId = spec.graph.initial;
  let working = options.initialWorking ?? createWorkingContext(input);

  try {
    while (true) {
      const nodeDef = spec.graph.nodes[currentNodeId];
      if (!nodeDef) throw new Error(`Node graph has no node definition for id ${currentNodeId}`);

      if (nodeDef.final) {
        if (emitGraphLines) runner.emitLine(formatCoreRuntimeLine("node", `graph done final=${currentNodeId}`));
        return { finalNodeId: currentNodeId, working, history };
      }

      const handler = spec.handlers[currentNodeId];
      if (!handler) throw new Error(`Missing node handler for graph node ${currentNodeId}`);

      working = incrementAttempt(working, currentNodeId);
      const attemptCount = working.attemptsByNodeId[currentNodeId]!;
      const nodeMeta: NodeRunMeta = {
        nodeId: nodeDef.nodeKey ?? currentNodeId,
        ...(nodeDef.label ? { label: nodeDef.label } : {}),
      };
      if (emitGraphLines) {
        runner.emitLine(formatCoreRuntimeLine("node", `enter node=${currentNodeId} visit=${history.length + 1}/${totalWorkingNodes}`));
      }

      const startedAt = new Date().toISOString();
      let rawResult: NodeResult<unknown> | undefined;
      let nodeResult: NodeResult<unknown>;
      let threw = false;
      let errorMessage: string | undefined;

      try {
        rawResult = await runner.run(nodeMeta, () =>
          withTimeout(() => handler({ nodeId: currentNodeId, working }), spec.timeoutMs, nodeMeta.nodeId),
        );
      } catch (error) {
        threw = true;
        errorMessage = error instanceof Error ? error.message : String(error);
        nodeResult = error instanceof NodeTimeoutError ? { status: "timed_out", note: errorMessage } : { status: "failed", note: errorMessage };
      }

      if (rawResult !== undefined) {
        if (!isNodeResult(rawResult)) throw new Error(`Node ${currentNodeId} returned malformed NodeResult.`);
        nodeResult = rawResult;
      }

      const finishedAt = new Date().toISOString();

      if (nodeResult!.status !== "completed" && options.failureResolver) {
        const failurePacket = buildFailurePacket({
          nodeId: currentNodeId,
          nodeKey: nodeMeta.nodeId,
          ...(nodeMeta.label ? { label: nodeMeta.label } : {}),
          attemptCount,
          ...(nodeDef.retryBudget !== undefined ? { retryBudget: nodeDef.retryBudget } : {}),
          input,
          nodeResult: nodeResult!,
          threw,
          ...(errorMessage ? { errorMessage } : {}),
          startedAt,
          finishedAt,
        });
        try {
          if (emitGraphLines) runner.emitLine(formatCoreRuntimeLine("node", `resolver enter node=${currentNodeId} status=${nodeResult!.status}`));
          const resolution = await options.failureResolver.resolveFailure({
            nodeId: currentNodeId,
            nodeKey: nodeMeta.nodeId,
            ...(nodeMeta.label ? { label: nodeMeta.label } : {}),
            attemptCount,
            ...(nodeDef.retryBudget !== undefined ? { retryBudget: nodeDef.retryBudget } : {}),
            input,
            working,
            failedResult: nodeResult!,
            threw,
            ...(errorMessage ? { errorMessage } : {}),
            startedAt,
            finishedAt,
            failurePacket,
          });
          if (resolution.disposition === "doctor_artifacts" || resolution.disposition === "continue_partial") {
            nodeResult = resolution.replacementResult;
            if (emitGraphLines) runner.emitLine(formatCoreRuntimeLine("node", `resolver recovered node=${currentNodeId} disposition=${resolution.disposition} status=${nodeResult.status}`));
          } else {
            if (emitGraphLines) runner.emitLine(formatCoreRuntimeLine("node", `resolver hard-fail node=${currentNodeId} disposition=${resolution.disposition}`));
          }
        } catch (resolverError) {
          const resolverMessage = resolverError instanceof Error ? resolverError.message : String(resolverError);
          nodeResult = {
            ...nodeResult!,
            note: [nodeResult!.note, `Failure resolver errored; preserving original result: ${resolverMessage}`].filter(Boolean).join(" "),
          };
          if (emitGraphLines) runner.emitLine(formatCoreRuntimeLine("node", `resolver error node=${currentNodeId}`));
        }
      }

      working = storeNodeResult(working, currentNodeId, nodeResult!);
      const transitionInput = buildTransitionInput(currentNodeId, attemptCount, nodeDef.retryBudget, nodeResult!, threw, errorMessage);
      const nextNodeId = nodeNavigator.resolveNext(currentNodeId, transitionInput, spec.graph);

      history.push({
        nodeId: currentNodeId,
        nodeStatus: nodeResult!.status,
        attemptCount,
        nextNodeId,
        ...(nodeResult!.note !== undefined ? { note: nodeResult!.note } : {}),
        startedAt,
        finishedAt,
      });
      if (emitGraphLines) {
        runner.emitLine(formatCoreRuntimeLine("node", `advance ${currentNodeId} -> ${nextNodeId} status=${nodeResult!.status}${threw ? " threw=true" : ""}`));
      }

      currentNodeId = nextNodeId;
    }
  } catch (error) {
    if (options.emitGraphLines ?? true) runner.emitLine(formatCoreRuntimeLine("node", `graph fail node=${currentNodeId}`));
    throw error;
  }
}
