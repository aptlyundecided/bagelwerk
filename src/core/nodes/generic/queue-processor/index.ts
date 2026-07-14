export type QueuedNodeItemStatus = "completed" | "failed";

export type QueuedNodeProgressSnapshot = {
  active: number;
  completed: number;
  failed: number;
  remaining: number;
};

export type QueuedNodeProgressEvent<TResult = unknown> =
  | ({ type: "queue-start"; queueId: string; total: number; concurrency: number } & QueuedNodeProgressSnapshot)
  | ({ type: "queue-item-start"; queueId: string; itemId: string; index: number; total: number; label?: string } & QueuedNodeProgressSnapshot)
  | ({ type: "queue-item-complete"; queueId: string; itemId: string; index: number; total: number; label?: string; result?: TResult } & QueuedNodeProgressSnapshot)
  | ({ type: "queue-item-failed"; queueId: string; itemId: string; index: number; total: number; label?: string; message: string; result?: TResult } & QueuedNodeProgressSnapshot)
  | ({ type: "queue-complete"; queueId: string; total: number; concurrency: number } & QueuedNodeProgressSnapshot);

export type QueuedNodeItem<TItem> = {
  itemId: string;
  label?: string;
  item: TItem;
};

export type QueuedNodeItemResult<TItem, TResult> = {
  itemId: string;
  label?: string;
  index: number;
  item: TItem;
  status: QueuedNodeItemStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: TResult;
  errorMessage?: string;
};

export type QueuedNodeProcessorResult<TItem, TResult> = {
  queueId: string;
  status: "completed" | "partial" | "failed";
  total: number;
  completed: number;
  failed: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: Array<QueuedNodeItemResult<TItem, TResult>>;
};

export type RunQueuedNodeProcessorParams<TItem, TResult> = {
  queueId: string;
  items: Array<QueuedNodeItem<TItem>>;
  concurrency: number;
  stopOnFirstFailure?: boolean;
  onProgress?: (event: QueuedNodeProgressEvent<TResult>) => void;
  runItem: (args: { item: QueuedNodeItem<TItem>; index: number; total: number }) => Promise<TResult>;
  resultStatus?: (result: TResult) => QueuedNodeItemStatus;
};

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`Queue processor concurrency must be a positive integer; got ${concurrency}.`);
  }
  return Math.floor(concurrency);
}

function resultStatus<TResult>(params: RunQueuedNodeProcessorParams<unknown, TResult>, result: TResult): QueuedNodeItemStatus {
  return params.resultStatus?.(result) ?? "completed";
}

export async function runQueuedNodeProcessor<TItem, TResult>(
  params: RunQueuedNodeProcessorParams<TItem, TResult>,
): Promise<QueuedNodeProcessorResult<TItem, TResult>> {
  const concurrency = normalizeConcurrency(params.concurrency);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const results = new Array<QueuedNodeItemResult<TItem, TResult>>(params.items.length);
  let nextIndex = 0;
  let active = 0;
  let completed = 0;
  let failed = 0;
  let stopRequested = false;

  const snapshot = (): QueuedNodeProgressSnapshot => ({
    active,
    completed,
    failed,
    remaining: Math.max(0, params.items.length - completed - failed - active),
  });

  params.onProgress?.({ type: "queue-start", queueId: params.queueId, total: params.items.length, concurrency, ...snapshot() });

  async function runOne(index: number): Promise<void> {
    const item = params.items[index]!;
    active += 1;
    const itemStartedAtMs = Date.now();
    const itemStartedAt = new Date(itemStartedAtMs).toISOString();
    params.onProgress?.({ type: "queue-item-start", queueId: params.queueId, itemId: item.itemId, index, total: params.items.length, ...(item.label ? { label: item.label } : {}), ...snapshot() });

    try {
      const result = await params.runItem({ item, index, total: params.items.length });
      const status = resultStatus(params as RunQueuedNodeProcessorParams<unknown, TResult>, result);
      const finishedAtMs = Date.now();
      active -= 1;
      if (status === "completed") completed += 1;
      else failed += 1;
      results[index] = {
        itemId: item.itemId,
        ...(item.label ? { label: item.label } : {}),
        index,
        item: item.item,
        status,
        startedAt: itemStartedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - itemStartedAtMs,
        result,
      };
      if (status === "failed" && params.stopOnFirstFailure) stopRequested = true;
      const eventType = status === "completed" ? "queue-item-complete" : "queue-item-failed";
      params.onProgress?.({ type: eventType, queueId: params.queueId, itemId: item.itemId, index, total: params.items.length, ...(item.label ? { label: item.label } : {}), ...(status === "failed" ? { message: "Queue item returned failed status." } : {}), result, ...snapshot() } as QueuedNodeProgressEvent<TResult>);
    } catch (error) {
      const finishedAtMs = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      active -= 1;
      failed += 1;
      results[index] = {
        itemId: item.itemId,
        ...(item.label ? { label: item.label } : {}),
        index,
        item: item.item,
        status: "failed",
        startedAt: itemStartedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - itemStartedAtMs,
        errorMessage: message,
      };
      if (params.stopOnFirstFailure) stopRequested = true;
      params.onProgress?.({ type: "queue-item-failed", queueId: params.queueId, itemId: item.itemId, index, total: params.items.length, ...(item.label ? { label: item.label } : {}), message, ...snapshot() });
    }
  }

  async function worker(): Promise<void> {
    while (!stopRequested) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= params.items.length) return;
      await runOne(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, params.items.length) }, () => worker()));

  for (let index = 0; index < params.items.length; index += 1) {
    if (!results[index]) {
      const now = new Date().toISOString();
      const item = params.items[index]!;
      failed += 1;
      results[index] = {
        itemId: item.itemId,
        ...(item.label ? { label: item.label } : {}),
        index,
        item: item.item,
        status: "failed",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        errorMessage: "Skipped because queue processor stopped after an earlier failure.",
      };
    }
  }

  const finishedAtMs = Date.now();
  const total = params.items.length;
  const finalCompleted = results.filter((result) => result.status === "completed").length;
  const finalFailed = results.filter((result) => result.status === "failed").length;
  const status = finalFailed === 0 ? "completed" : finalCompleted > 0 ? "partial" : "failed";
  active = 0;
  completed = finalCompleted;
  failed = finalFailed;
  params.onProgress?.({ type: "queue-complete", queueId: params.queueId, total, concurrency, ...snapshot() });

  return {
    queueId: params.queueId,
    status,
    total,
    completed: finalCompleted,
    failed: finalFailed,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    results,
  };
}
