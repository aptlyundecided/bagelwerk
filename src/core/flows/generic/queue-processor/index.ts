import { formatCoreRuntimeLine } from "../../../terminal";
import type { NodeGraphRunResult } from "../../../nodes/graph";
import type { NodeRunner } from "../../../nodes/runner";
import type { NodeRegistry } from "../../../nodes/config";
import { createStaticFlowNodeLibrary, type FlowNodeLibrary } from "../../config/flowNodeLibrary";
import { runConfiguredFlow, type RunConfiguredFlowOptions } from "../../config/runConfiguredFlow";
import { runConfiguredFlowWithParallelFlows, type ParallelFlowGroup } from "../../config/runParallelConfiguredFlow";

export type QueueProcessorWorkItemStatus = "completed" | "failed" | "timed_out";

export type QueueProcessorWorkItem<TItem, TInput> = {
  id: string;
  item: TItem;
  flow: unknown;
  input?: TInput;
  nodeLibrary?: FlowNodeLibrary;
  parallelGroups?: [ParallelFlowGroup, ...ParallelFlowGroup[]];
};

export type QueueProcessorWorkItemResult<TItem, TInput> = {
  id: string;
  index: number;
  item: TItem;
  status: QueueProcessorWorkItemStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: NodeGraphRunResult<TInput>;
  errorMessage?: string;
};

export type QueueProcessorRunResult<TItem, TInput> = {
  queueId: string;
  status: QueueProcessorWorkItemStatus;
  total: number;
  completed: number;
  failed: number;
  timedOut: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: QueueProcessorWorkItemResult<TItem, TInput>[];
};

export type QueueProcessorProgressEvent<TItem> = {
  queueId: string;
  total: number;
  completed: number;
  failed: number;
  timedOut: number;
  running: number;
  currentWorkItemId?: string;
  currentItem?: TItem;
  at: string;
};

export type RunQueueProcessorFlowParams<TItem, TInput> = {
  queueId: string;
  workItems: QueueProcessorWorkItem<TItem, TInput>[];
  nodeLibrary?: FlowNodeLibrary | unknown[];
  nodeRegistry: NodeRegistry;
  input: TInput;
  concurrency: number;
  stopOnFirstFailure?: boolean;
  onProgress?: (event: QueueProcessorProgressEvent<TItem>) => void;
};

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`Queue processor concurrency must be a positive integer; got ${concurrency}.`);
  }
  return Math.floor(concurrency);
}

function normalizeNodeLibrary(nodeLibrary: FlowNodeLibrary | unknown[] | undefined): FlowNodeLibrary | undefined {
  if (!nodeLibrary) return undefined;
  return Array.isArray(nodeLibrary) ? createStaticFlowNodeLibrary(nodeLibrary) : nodeLibrary;
}

function resultStatus<TInput>(result: NodeGraphRunResult<TInput>): QueueProcessorWorkItemStatus {
  const last = result.history[result.history.length - 1];
  return last?.nodeStatus ?? "failed";
}

function queueStatus(results: Array<QueueProcessorWorkItemResult<unknown, unknown>>): QueueProcessorWorkItemStatus {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "timed_out")) return "timed_out";
  return "completed";
}

function countResults<TItem, TInput>(results: Array<QueueProcessorWorkItemResult<TItem, TInput> | undefined>): Pick<QueueProcessorProgressEvent<TItem>, "completed" | "failed" | "timedOut"> {
  return {
    completed: results.filter((result) => result?.status === "completed").length,
    failed: results.filter((result) => result?.status === "failed").length,
    timedOut: results.filter((result) => result?.status === "timed_out").length,
  };
}

function emitQueueProgress<TItem, TInput>(params: {
  queueId: string;
  total: number;
  results: Array<QueueProcessorWorkItemResult<TItem, TInput> | undefined>;
  running: number;
  currentWorkItem?: QueueProcessorWorkItem<TItem, TInput>;
  onProgress?: (event: QueueProcessorProgressEvent<TItem>) => void;
}): void {
  const counts = countResults(params.results);
  params.onProgress?.({
    queueId: params.queueId,
    total: params.total,
    completed: counts.completed,
    failed: counts.failed,
    timedOut: counts.timedOut,
    running: params.running,
    ...(params.currentWorkItem ? { currentWorkItemId: params.currentWorkItem.id, currentItem: params.currentWorkItem.item } : {}),
    at: new Date().toISOString(),
  });
}

export async function runQueueProcessorFlow<TItem, TInput>(
  runner: NodeRunner,
  params: RunQueueProcessorFlowParams<TItem, TInput>,
  options: RunConfiguredFlowOptions<TInput> = {},
): Promise<QueueProcessorRunResult<TItem, TInput>> {
  const concurrency = normalizeConcurrency(params.concurrency);
  const sharedNodeLibrary = normalizeNodeLibrary(params.nodeLibrary);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const results = new Array<QueueProcessorWorkItemResult<TItem, TInput> | undefined>(params.workItems.length);
  let nextIndex = 0;
  let running = 0;
  let stopRequested = false;

  runner.emitLine(formatCoreRuntimeLine("flow", `queue start id=${params.queueId} workItems=${params.workItems.length} concurrency=${concurrency}`));
  emitQueueProgress({ queueId: params.queueId, total: params.workItems.length, results, running, onProgress: params.onProgress });

  async function runOne(index: number): Promise<void> {
    const workItem = params.workItems[index]!;
    const workItemStartedAtMs = Date.now();
    const workItemStartedAt = new Date(workItemStartedAtMs).toISOString();
    runner.emitLine(formatCoreRuntimeLine("flow", `queue work-item start queue=${params.queueId} index=${index} id=${workItem.id}`));
    running += 1;
    emitQueueProgress({ queueId: params.queueId, total: params.workItems.length, results, running, currentWorkItem: workItem, onProgress: params.onProgress });

    try {
      const nodeLibrary = workItem.nodeLibrary ?? sharedNodeLibrary ?? createStaticFlowNodeLibrary([]);
      const result = workItem.parallelGroups
        ? await runConfiguredFlowWithParallelFlows(
            runner,
            {
              flow: workItem.flow,
              nodeLibrary,
              nodeRegistry: params.nodeRegistry,
              parallelGroups: workItem.parallelGroups,
            },
            workItem.input ?? params.input,
            options,
          )
        : await runConfiguredFlow(
            runner,
            {
              flow: workItem.flow,
              nodeLibrary,
              nodeRegistry: params.nodeRegistry,
            },
            workItem.input ?? params.input,
            options,
          );
      const finishedAtMs = Date.now();
      const status = resultStatus(result);
      results[index] = {
        id: workItem.id,
        index,
        item: workItem.item,
        status,
        startedAt: workItemStartedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - workItemStartedAtMs,
        result,
      };
      if (status !== "completed" && params.stopOnFirstFailure) stopRequested = true;
      runner.emitLine(formatCoreRuntimeLine("flow", `queue work-item done queue=${params.queueId} index=${index} id=${workItem.id} status=${status}`));
    } catch (error) {
      const finishedAtMs = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      results[index] = {
        id: workItem.id,
        index,
        item: workItem.item,
        status: "failed",
        startedAt: workItemStartedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - workItemStartedAtMs,
        errorMessage,
      };
      if (params.stopOnFirstFailure) stopRequested = true;
      runner.emitLine(formatCoreRuntimeLine("flow", `queue work-item fail queue=${params.queueId} index=${index} id=${workItem.id} error=${JSON.stringify(errorMessage)}`));
    } finally {
      running -= 1;
      emitQueueProgress({ queueId: params.queueId, total: params.workItems.length, results, running, onProgress: params.onProgress });
    }
  }

  async function worker(): Promise<void> {
    while (!stopRequested) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= params.workItems.length) return;
      await runOne(index);
    }
  }

  const workerCount = Math.min(concurrency, params.workItems.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (let index = 0; index < params.workItems.length; index += 1) {
    if (!results[index]) {
      const now = new Date().toISOString();
      const workItem = params.workItems[index]!;
      results[index] = {
        id: workItem.id,
        index,
        item: workItem.item,
        status: "failed",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        errorMessage: "Skipped because queue processor stopped after an earlier failure.",
      };
    }
  }

  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const finalResults = results as Array<QueueProcessorWorkItemResult<TItem, TInput>>;
  const status = queueStatus(finalResults as Array<QueueProcessorWorkItemResult<unknown, unknown>>);
  const completed = finalResults.filter((result) => result.status === "completed").length;
  const failed = finalResults.filter((result) => result.status === "failed").length;
  const timedOut = finalResults.filter((result) => result.status === "timed_out").length;
  runner.emitLine(formatCoreRuntimeLine("flow", `queue done id=${params.queueId} status=${status} completed=${completed} failed=${failed} timed_out=${timedOut}`));
  emitQueueProgress({ queueId: params.queueId, total: params.workItems.length, results: finalResults, running: 0, onProgress: params.onProgress });

  return {
    queueId: params.queueId,
    status,
    total: params.workItems.length,
    completed,
    failed,
    timedOut,
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    results: finalResults,
  };
}
