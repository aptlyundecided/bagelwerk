import assert from "node:assert/strict";
import test from "node:test";

import { artifactExistenceFromExpected } from "../node-run/nodeRun";
import { isFlowRunnerNodeResult } from "../results/resultValidation";

test("isFlowRunnerNodeResult rejects malformed node results", () => {
  assert.equal(isFlowRunnerNodeResult({ status: "completed" }), true);
  assert.equal(isFlowRunnerNodeResult({ status: "failed", note: "bad" }), true);
  assert.equal(isFlowRunnerNodeResult({ status: "unknown" }), false);
  assert.equal(isFlowRunnerNodeResult({ status: "completed", note: 123 }), false);
  assert.equal(isFlowRunnerNodeResult(null), false);
});

test("artifactExistenceFromExpected matches by key or relative path", () => {
  const verdicts = artifactExistenceFromExpected(
    [
      { key: "a", label: "Artifact A", relativePath: "a.json" },
      { key: "b", label: "Artifact B", relativePath: "nested/b.json", required: false },
    ],
    [
      { key: "x", label: "Artifact A", relativePath: "a.json", canonicalPath: "/tmp/a.json", exists: true, observedAt: "now" },
      { key: "b", label: "Artifact B", relativePath: "other.json", canonicalPath: "/tmp/b.json", exists: false, observedAt: "now" },
    ],
  );

  assert.deepEqual(verdicts, [
    { key: "a", label: "Artifact A", relativePath: "a.json", required: true, canonicalPath: "/tmp/a.json", exists: true },
    { key: "b", label: "Artifact B", relativePath: "nested/b.json", required: false, canonicalPath: "/tmp/b.json", exists: false },
  ]);
});
