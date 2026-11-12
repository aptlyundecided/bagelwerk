import assert from "node:assert/strict";
import test from "node:test";

import { createNodeRunner } from "../runner";
import { runNodeGraph } from "./runNodeGraph";
import type { NodeFailureResolver, NodeRunnerSpec } from "./nodeGraphTypes";

function singleNodeSpec(status: "completed" | "failed" = "failed"): NodeRunnerSpec<{ value: string }> {
  return {
    graph: {
      initial: "node.alpha",
      nodes: {
        "node.alpha": {
          nodeKey: "node.alpha",
          label: "Alpha",
          edges: [
            { to: "success", when: (input) => input.nodeStatus === "completed" },
            { to: "failure", when: (input) => input.nodeStatus === "failed" || input.nodeStatus === "timed_out" },
          ],
        },
        success: { final: true },
        failure: { final: true },
      },
    },
    handlers: {
      "node.alpha": async () => ({ status, note: status === "failed" ? "original failure" : "ok" }),
    },
  };
}

test("runNodeGraph lets a failure resolver replace a failed Node result before transition resolution", async () => {
  const resolver: NodeFailureResolver<{ value: string }> = {
    async resolveFailure(input) {
      assert.equal(input.failurePacket.status, "failed");
      assert.equal(input.failurePacket.note, "original failure");
      assert.equal(input.input.value, "seed");
      return {
        disposition: "doctor_artifacts",
        replacementResult: { status: "completed", note: "resolved failure" },
        rationale: "test resolver recovered the node",
      };
    },
  };

  const result = await runNodeGraph(createNodeRunner({ emitNodeLines: false }), singleNodeSpec(), { value: "seed" }, { failureResolver: resolver });

  assert.equal(result.finalNodeId, "success");
  assert.equal(result.working.outputsByNodeId["node.alpha"]?.status, "completed");
  assert.equal(result.working.outputsByNodeId["node.alpha"]?.note, "resolved failure");
  assert.equal(result.history[0]?.nodeStatus, "completed");
  assert.equal(result.history[0]?.nextNodeId, "success");
});

test("runNodeGraph preserves the failed result when the resolver hard-fails", async () => {
  const resolver: NodeFailureResolver<{ value: string }> = {
    async resolveFailure() {
      return { disposition: "hard_fail", rationale: "not safe to doctor" };
    },
  };

  const result = await runNodeGraph(createNodeRunner({ emitNodeLines: false }), singleNodeSpec(), { value: "seed" }, { failureResolver: resolver });

  assert.equal(result.finalNodeId, "failure");
  assert.equal(result.working.outputsByNodeId["node.alpha"]?.status, "failed");
  assert.equal(result.working.outputsByNodeId["node.alpha"]?.note, "original failure");
});

test("runNodeGraph preserves the original failed status when the resolver throws", async () => {
  const resolver: NodeFailureResolver<{ value: string }> = {
    async resolveFailure() {
      throw new Error("resolver bug");
    },
  };

  const result = await runNodeGraph(createNodeRunner({ emitNodeLines: false }), singleNodeSpec(), { value: "seed" }, { failureResolver: resolver });

  assert.equal(result.finalNodeId, "failure");
  assert.equal(result.working.outputsByNodeId["node.alpha"]?.status, "failed");
  assert.match(result.working.outputsByNodeId["node.alpha"]?.note ?? "", /original failure/);
  assert.match(result.working.outputsByNodeId["node.alpha"]?.note ?? "", /resolver bug/);
});


test("recovery retains the unsuccessful result and reason without blocking partial continuation", async () => {
  const spec = singleNodeSpec();
  spec.handlers["node.alpha"] = async () => ({ status: "failed", note: "one source unavailable", payload: { available: ["A", "B"] } });
  const result = await runNodeGraph(createNodeRunner({ log: () => undefined }), spec, { value: "seed" }, {
    failureResolver: { resolveFailure: async () => ({ disposition: "continue_partial", replacementResult: { status: "completed", payload: { available: ["A", "B"] } }, rationale: "Two sources are enough for this comparison" }) },
  });
  assert.equal(result.finalNodeId, "success");
  assert.deepEqual(result.history[0].originalResult, { status: "failed", note: "one source unavailable", payload: { available: ["A", "B"] } });
  assert.deepEqual(result.history[0].recovery, { disposition: "continue_partial", rationale: "Two sources are enough for this comparison" });
});

test("retry_node is retained as a request, not reported as an executed retry or hard failure", async () => {
  const lines: string[] = [];
  const result = await runNodeGraph(createNodeRunner({ log: line => lines.push(line) }), singleNodeSpec(), { value: "seed" }, {
    failureResolver: { resolveFailure: async () => ({ disposition: "retry_node", retryInstructions: "Try again", rationale: "Temporary issue" }) },
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].recovery?.disposition, "retry_node");
  assert.equal(result.finalNodeId, "failure");
  assert.ok(lines.every(line => !line.includes("Retry in progress") && !line.includes("resolver hard-fail")));
});
