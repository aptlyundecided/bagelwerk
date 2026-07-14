import assert from "node:assert/strict";
import test from "node:test";

import { coreTimerNodeTypeEntry, type TimerNodePayload } from "../../nodes/generic";
import { createNodeRunner } from "../../nodes/runner";
import { createStaticNodeRegistry } from "../../nodes/config";
import { createStaticFlowNodeLibrary } from "./flowNodeLibrary";
import { runConfiguredFlowWithParallelFlows } from "./runParallelConfiguredFlow";

function timerNode(nodeId: string, message: string, delayMs: number) {
  return {
    nodeId,
    nodeType: "core.timer",
    name: message,
    description: `Timer for ${message}`,
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    params: { message, delayMs },
  };
}

function payload(result: Awaited<ReturnType<typeof runConfiguredFlowWithParallelFlows<undefined>>>, nodePath: string): TimerNodePayload {
  const nodePayload = result.working.outputsByNodeId[nodePath]?.payload as TimerNodePayload | undefined;
  assert.ok(nodePayload, `Expected payload for ${nodePath}`);
  return nodePayload;
}

test("runConfiguredFlowWithParallelFlows runs child Flow branches concurrently and joins after all finish", async () => {
  const registry = createStaticNodeRegistry([coreTimerNodeTypeEntry]);
  const nodeLibrary = createStaticFlowNodeLibrary([
    timerNode("timer.start", "setup complete", 5),
    timerNode("timer.one", "lane one message", 100),
    timerNode("timer.two", "lane two message", 100),
    timerNode("timer.three", "lane three message", 100),
    timerNode("timer.four.first", "lane four first message", 100),
    timerNode("timer.four.second", "lane four second message", 40),
    timerNode("timer.five.first", "lane five first message", 100),
    timerNode("timer.five.second", "lane five second message", 40),
    timerNode("timer.join", "joined parallel lanes", 5),
  ]);

  const oneTimerFlow = (nodeId: string) => ({
    flowId: "one-timer-lane",
    name: "One timer lane",
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    initial: "timer",
    nodes: { timer: { nodeId } },
    edges: [],
  });
  const twoTimerFlow = (firstNodeId: string, secondNodeId: string) => ({
    flowId: "two-timer-lane",
    name: "Two timer lane",
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    initial: "first",
    nodes: {
      first: { nodeId: firstNodeId },
      second: { nodeId: secondNodeId },
    },
    edges: [{ from: "first", to: "second", on: "completed" as const }],
  });

  const flow = {
    flowId: "parallel-timer-test",
    name: "Parallel Timer Test",
    createdAt: "2026-05-22",
    updatedAt: "2026-05-22",
    initial: "start",
    nodes: {
      start: { nodeId: "timer.start" },
      join: { nodeId: "timer.join" },
    },
    flows: {
      "lane-one": oneTimerFlow("timer.one"),
      "lane-two": oneTimerFlow("timer.two"),
      "lane-three": oneTimerFlow("timer.three"),
      "lane-four": twoTimerFlow("timer.four.first", "timer.four.second"),
      "lane-five": twoTimerFlow("timer.five.first", "timer.five.second"),
    },
    edges: [
      { from: "start", to: "lane-one", on: "completed" as const },
      { from: "start", to: "lane-two", on: "completed" as const },
      { from: "start", to: "lane-three", on: "completed" as const },
      { from: "start", to: "lane-four", on: "completed" as const },
      { from: "start", to: "lane-five", on: "completed" as const },
      { from: "lane-one", to: "join", on: "completed" as const },
      { from: "lane-two", to: "join", on: "completed" as const },
      { from: "lane-three", to: "join", on: "completed" as const },
      { from: "lane-four", to: "join", on: "completed" as const },
      { from: "lane-five", to: "join", on: "completed" as const },
    ],
  };

  const startedAt = Date.now();
  const result = await runConfiguredFlowWithParallelFlows(createNodeRunner({ log: () => undefined }), {
    flow,
    nodeLibrary,
    nodeRegistry: registry,
    parallelGroups: [{
      after: "parallel-timer-test.start",
      branches: [
        "parallel-timer-test.lane-one",
        "parallel-timer-test.lane-two",
        "parallel-timer-test.lane-three",
        "parallel-timer-test.lane-four",
        "parallel-timer-test.lane-five",
      ],
      join: "parallel-timer-test.join",
    }],
  }, undefined);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.working.outputsByNodeId["parallel-timer-test.join"]?.status, "completed");
  assert.deepEqual(result.parallelGroups[0]?.branches.map((branch) => branch.branchFlowPath), [
    "parallel-timer-test.lane-one",
    "parallel-timer-test.lane-two",
    "parallel-timer-test.lane-three",
    "parallel-timer-test.lane-four",
    "parallel-timer-test.lane-five",
  ]);

  assert.deepEqual(
    [
      payload(result, "parallel-timer-test.lane-one.timer").message,
      payload(result, "parallel-timer-test.lane-two.timer").message,
      payload(result, "parallel-timer-test.lane-three.timer").message,
      payload(result, "parallel-timer-test.lane-four.first").message,
      payload(result, "parallel-timer-test.lane-four.second").message,
      payload(result, "parallel-timer-test.lane-five.first").message,
      payload(result, "parallel-timer-test.lane-five.second").message,
    ],
    [
      "lane one message",
      "lane two message",
      "lane three message",
      "lane four first message",
      "lane four second message",
      "lane five first message",
      "lane five second message",
    ],
  );

  assert.ok(
    elapsedMs < 350,
    `Expected five timer Flows to run in parallel; elapsed ${elapsedMs}ms would be too close to sequential execution.`,
  );
});
