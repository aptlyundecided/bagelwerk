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
