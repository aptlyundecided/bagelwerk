import assert from "node:assert/strict";
import test from "node:test";

import { flowWithRunnerId } from "./flowRunner";

// Regression: when the external loader re-namespaces a flow's root flowId, nested cross-subflow
// acceptedArtifacts.from references (which are rooted at the OLD flowId) must be rewritten too,
// while flow-local short keys are left untouched. (Surfaced by supervising platform-tour: its
// draft-tour-graph failed because "platform-tour.context-handoff-demo.read-handoff-packet" no
// longer matched once the flow ran as "built-ins:platform-tour".)

test("flowWithRunnerId rewrites qualified cross-subflow from-refs but not short keys", () => {
  const flow = {
    flowId: "tour",
    initial: "a",
    nodes: {
      a: { nodeId: "tour.a" },
      b: {
        nodeId: "tour.b",
        acceptedArtifacts: [
          { from: "a", relativePath: "x.json" }, // flow-local short key
          { from: "tour.sub.inner", relativePath: "y.json" }, // qualified cross-subflow ref
        ],
      },
    },
    flows: {
      sub: {
        flowId: "tour.sub",
        nodes: {
          inner: { nodeId: "tour.sub.inner", acceptedArtifacts: [{ from: "tour.a", relativePath: "z.json" }] },
        },
      },
    },
    edges: [],
  };

  const out = flowWithRunnerId(flow, "ns:tour") as typeof flow;

  assert.equal(out.flowId, "ns:tour");
  assert.equal(out.nodes.b.acceptedArtifacts[0]!.from, "a", "short key unchanged");
  assert.equal(out.nodes.b.acceptedArtifacts[1]!.from, "ns:tour.sub.inner", "qualified cross-subflow ref re-namespaced");
  assert.equal(out.flows.sub.nodes.inner.acceptedArtifacts[0]!.from, "ns:tour.a", "nested ref re-namespaced");
  // Original input must not be mutated.
  assert.equal(flow.nodes.b.acceptedArtifacts[1]!.from, "tour.sub.inner");
});

test("flowWithRunnerId is a no-op rewrite when the id is unchanged", () => {
  const flow = { flowId: "x", nodes: { a: { nodeId: "x.a", acceptedArtifacts: [{ from: "x.a", relativePath: "r" }] } } };
  const out = flowWithRunnerId(flow, "x") as typeof flow;
  assert.equal(out.flowId, "x");
  assert.equal(out.nodes.a.acceptedArtifacts[0]!.from, "x.a");
});
