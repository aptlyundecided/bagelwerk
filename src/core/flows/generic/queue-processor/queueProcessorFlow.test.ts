import assert from "node:assert/strict";
import test from "node:test";

import { coreTimerNodeTypeEntry, type TimerNodePayload } from "../../../nodes/generic";
import { createStaticNodeRegistry } from "../../../nodes/config";
import { createNodeRunner } from "../../../nodes/runner";
import { createStaticFlowNodeLibrary } from "../../config";
import { runQueueProcessorFlow } from ".";

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

test("runQueueProcessorFlow dynamically spins up parallel Flow work items and waits for completion", async () => {
  const changedFiles = Array.from({ length: 14 }, (_, index) => `src/file-${String(index + 1).padStart(2, "0")}.ts`);
  const batches = chunks(changedFiles, 2);
  assert.equal(batches.length, 7);

  const nodeLibrary = createStaticFlowNodeLibrary(
    batches.map((batch, index) => ({
      nodeId: `timer.comment-batch-${String(index + 1).padStart(3, "0")}`,
      nodeType: "core.timer",
      name: `Comment batch ${index + 1}`,
      description: `Timer proving comment batch ${index + 1}`,
      createdAt: "2026-05-22",
      updatedAt: "2026-05-22",
      params: {
        delayMs: 90,
        message: `checked ${batch.join(", ")}`,
      },
    })),
  );
  const registry = createStaticNodeRegistry([coreTimerNodeTypeEntry]);
  const workItems = batches.map((batch, index) => {
    const batchId = `comment-batch-${String(index + 1).padStart(3, "0")}`;
    return {
      id: batchId,
      item: { files: batch },
      flow: {
        flowId: batchId,
        name: `Comment Batch ${index + 1}`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        initial: "timer",
        nodes: {
          timer: { nodeId: `timer.${batchId}` },
        },
        edges: [],
      },
    };
  });

  const startedAt = Date.now();
  const result = await runQueueProcessorFlow(createNodeRunner({ log: () => undefined }), {
    queueId: "comment-nit-pick-batches",
    workItems,
    nodeLibrary,
    nodeRegistry: registry,
    input: undefined,
    concurrency: 7,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.status, "completed");
  assert.equal(result.total, 7);
  assert.equal(result.completed, 7);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.results.map((workItemResult) => workItemResult.id), workItems.map((workItem) => workItem.id));
  assert.deepEqual(result.results.map((workItemResult) => workItemResult.item.files), batches);

  const messages = result.results.map((workItemResult) => {
    const payload = workItemResult.result?.working.outputsByNodeId[`${workItemResult.id}.timer`]?.payload as TimerNodePayload | undefined;
    assert.ok(payload, `Expected timer payload for ${workItemResult.id}`);
    return payload.message;
  });
  assert.deepEqual(messages, batches.map((batch) => `checked ${batch.join(", ")}`));
  assert.ok(elapsedMs < 260, `Expected 7 batch Flow work items to run in parallel; elapsed ${elapsedMs}ms was too slow.`);
});

test("runQueueProcessorFlow emits generic queue progress snapshots", async () => {
  const registry = createStaticNodeRegistry([coreTimerNodeTypeEntry]);
  const items = ["one", "two", "three"];
  const configuredNodes = items.map((item) => ({
    nodeId: `timer.${item}`,
    nodeType: "core.timer",
    name: `Timer ${item}`,
    description: `Timer ${item}`,
    createdAt: "2026-05-27",
    updatedAt: "2026-05-27",
    params: { delayMs: 1, message: item },
  }));
  const progress: Array<{ total: number; completed: number; failed: number; timedOut: number; running: number; currentWorkItemId?: string }> = [];

  const result = await runQueueProcessorFlow(createNodeRunner({ log: () => undefined }), {
    queueId: "progress-test",
    workItems: items.map((item) => ({
      id: item,
      item,
      flow: {
        flowId: item,
        name: item,
        createdAt: "2026-05-27",
        updatedAt: "2026-05-27",
        initial: "timer",
        nodes: { timer: { nodeId: `timer.${item}` } },
        edges: [],
      },
    })),
    nodeLibrary: createStaticFlowNodeLibrary(configuredNodes),
    nodeRegistry: registry,
    input: undefined,
    concurrency: 1,
    onProgress: (event) => progress.push({
      total: event.total,
      completed: event.completed,
      failed: event.failed,
      timedOut: event.timedOut,
      running: event.running,
      ...(event.currentWorkItemId ? { currentWorkItemId: event.currentWorkItemId } : {}),
    }),
  });

  assert.equal(result.status, "completed");
  assert.equal(progress[0]?.total, 3);
  assert.equal(progress[0]?.completed, 0);
  assert.equal(progress[0]?.running, 0);
  assert.ok(progress.some((event) => event.currentWorkItemId === "one" && event.running === 1));
  assert.ok(progress.some((event) => event.completed === 2 && event.running === 1 && event.currentWorkItemId === "three"));
  assert.deepEqual(progress.at(-1), { total: 3, completed: 3, failed: 0, timedOut: 0, running: 0 });
});

test("runQueueProcessorFlow enforces queue concurrency while queued work items run internal parallel Flow branches", async () => {
  const items = Array.from({ length: 10 }, (_, index) => `work-item-${String(index + 1).padStart(2, "0")}`);
  const registry = createStaticNodeRegistry([coreTimerNodeTypeEntry]);
  const configuredNodes = items.flatMap((item, index) => {
    const workItemId = `parallel-work-item-${String(index + 1).padStart(3, "0")}`;
    return [
      {
        nodeId: `timer.${workItemId}.start`,
        nodeType: "core.timer",
        name: `${workItemId} start`,
        description: `${workItemId} start timer`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        params: { delayMs: 0, message: `${item} start` },
      },
      {
        nodeId: `timer.${workItemId}.left`,
        nodeType: "core.timer",
        name: `${workItemId} left`,
        description: `${workItemId} left timer`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        params: { delayMs: 500, message: `${item} left done` },
      },
      {
        nodeId: `timer.${workItemId}.right`,
        nodeType: "core.timer",
        name: `${workItemId} right`,
        description: `${workItemId} right timer`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        params: { delayMs: 500, message: `${item} right done` },
      },
      {
        nodeId: `timer.${workItemId}.join`,
        nodeType: "core.timer",
        name: `${workItemId} join`,
        description: `${workItemId} join timer`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        params: { delayMs: 0, message: `${item} joined` },
      },
    ];
  });
  const nodeLibrary = createStaticFlowNodeLibrary(configuredNodes);
  const workItems = items.map((item, index) => {
    const workItemId = `parallel-work-item-${String(index + 1).padStart(3, "0")}`;
    return {
      id: workItemId,
      item,
      flow: {
        flowId: workItemId,
        name: `Parallel Work item ${index + 1}`,
        createdAt: "2026-05-22",
        updatedAt: "2026-05-22",
        initial: "start",
        nodes: {
          start: { nodeId: `timer.${workItemId}.start` },
          join: { nodeId: `timer.${workItemId}.join` },
        },
        flows: {
          left: {
            flowId: "left",
            name: "Left branch",
            createdAt: "2026-05-22",
            updatedAt: "2026-05-22",
            initial: "timer",
            nodes: { timer: { nodeId: `timer.${workItemId}.left` } },
            edges: [],
          },
          right: {
            flowId: "right",
            name: "Right branch",
            createdAt: "2026-05-22",
            updatedAt: "2026-05-22",
            initial: "timer",
            nodes: { timer: { nodeId: `timer.${workItemId}.right` } },
            edges: [],
          },
        },
        edges: [
          { from: "start", to: "left", on: "completed" as const },
          { from: "start", to: "right", on: "completed" as const },
          { from: "left", to: "join", on: "completed" as const },
          { from: "right", to: "join", on: "completed" as const },
        ],
      },
      parallelGroups: [{
        after: `${workItemId}.start`,
        branches: [`${workItemId}.left`, `${workItemId}.right`],
        join: `${workItemId}.join`,
      }] as const,
    };
  });

  const startedAt = Date.now();
  const result = await runQueueProcessorFlow(createNodeRunner({ log: () => undefined }), {
    queueId: "parallel-work-items-two-at-a-time",
    workItems,
    nodeLibrary,
    nodeRegistry: registry,
    input: undefined,
    concurrency: 2,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.status, "completed");
  assert.equal(result.total, 10);
  assert.equal(result.completed, 10);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.results.map((workItemResult) => workItemResult.id), workItems.map((workItem) => workItem.id));

  const joinMessages = result.results.map((workItemResult) => {
    const payload = workItemResult.result?.working.outputsByNodeId[`${workItemResult.id}.join`]?.payload as TimerNodePayload | undefined;
    assert.ok(payload, `Expected join payload for ${workItemResult.id}`);
    return payload.message;
  });
  assert.deepEqual(joinMessages, items.map((item) => `${item} joined`));

  assert.ok(elapsedMs >= 2_300, `Expected queue concurrency=2 to take about five 500ms waves; elapsed ${elapsedMs}ms was too fast.`);
  assert.ok(elapsedMs < 3_800, `Expected each queued work item's internal branches to run in parallel; elapsed ${elapsedMs}ms was too slow.`);
});
