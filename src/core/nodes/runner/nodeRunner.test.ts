import assert from "node:assert/strict";
import test from "node:test";

import { createNodeRunner, type NodeRunEvent } from "./nodeRunner";

test("NodeRunner emits Node run events for async success", async () => {
  const events: NodeRunEvent[] = [];
  const runner = createNodeRunner({
    runId: "run-1",
    log: () => undefined,
    onNodeRunEvent: (event) => events.push(event),
  });

  const result = await runner.run({ nodeId: "node.alpha", label: "Alpha" }, async () => "ok");

  assert.equal(result, "ok");
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { phase: "start", nodeId: "node.alpha", label: "Alpha", runId: "run-1" });
  assert.equal(events[1]?.phase, "ok");
  assert.equal(events[1]?.nodeId, "node.alpha");
  assert.equal(events[1]?.label, "Alpha");
  assert.equal(events[1]?.runId, "run-1");
  assert.equal(typeof events[1]?.durationMs, "number");
});

test("NodeRunner emits Node run events for sync failure", () => {
  const events: NodeRunEvent[] = [];
  const runner = createNodeRunner({
    log: () => undefined,
    onNodeRunEvent: (event) => events.push(event),
  });

  assert.throws(
    () => runner.runSync({ nodeId: "node.fail" }, () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { phase: "start", nodeId: "node.fail", label: "node.fail" });
  assert.equal(events[1]?.phase, "fail");
  assert.equal(events[1]?.nodeId, "node.fail");
  assert.equal(events[1]?.label, "node.fail");
  assert.equal(events[1]?.errorMessage, "boom");
  assert.equal(typeof events[1]?.durationMs, "number");
});
