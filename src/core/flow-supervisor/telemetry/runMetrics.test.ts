import assert from "node:assert/strict";
import test from "node:test";

import type { FlowRunnerEvent, FlowRunnerRunTree } from "../../flow-runner";
import { buildFlowSupervisorRunMetrics } from "./runMetrics";

test("buildFlowSupervisorRunMetrics derives timing, status, retry, and artifact counts", () => {
  const events: FlowRunnerEvent[] = [
    { type: "flow-start", at: iso(0), flowId: "demo", sessionId: "s1", mode: "whole-flow", runDir: "/run" },
    { type: "node-start", at: iso(1_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.a", nodeId: "a", label: "A", runDir: "/run/a" },
    { type: "node-progress", at: iso(3_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.a", nodeId: "a", progress: { kind: "message", message: "retrying provider call", attempt: 2 } },
    { type: "artifact-observed", at: iso(4_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.a", nodeId: "a", label: "out", relativePath: "out.json", canonicalPath: "/run/a/out.json", exists: false },
    { type: "node-complete", at: iso(6_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.a", nodeId: "a", status: "completed", runDir: "/run/a", latestDir: "/latest/a", acceptedDir: "/accepted/a", accepted: true },
    { type: "accepted", at: iso(6_100), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.a", nodeId: "a", acceptedDir: "/accepted/a" },
    { type: "node-skipped", at: iso(7_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.b", nodeId: "b", reason: "resume-accepted", acceptedDir: "/accepted/b" },
    { type: "unhandled-failure-resolution-complete", at: iso(8_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.c", nodeId: "c", disposition: "hard_fail", status: "failed" },
    { type: "node-complete", at: iso(9_000), flowId: "demo", sessionId: "s1", qualifiedNodePath: "root.c", nodeId: "c", status: "failed", runDir: "/run/c", latestDir: "/latest/c", acceptedDir: "/accepted/c", accepted: false },
    { type: "flow-complete", at: iso(10_000), flowId: "demo", sessionId: "s1", status: "failed", runDir: "/run", latestDir: "/latest" },
  ];

  const runTree: FlowRunnerRunTree = {
    schemaVersion: 1,
    flowId: "demo",
    sessionId: "s1",
    mode: "whole-flow",
    startedAt: iso(0),
    finishedAt: iso(10_000),
    status: "failed",
    nodes: [
      { qualifiedNodePath: "root.a", nodeId: "a", status: "completed", runDir: "/run/a", latestDir: "/latest/a", acceptedDir: "/accepted/a", accepted: true },
      { qualifiedNodePath: "root.b", nodeId: "b", status: "completed", runDir: "/accepted/b", latestDir: "/latest/b", acceptedDir: "/accepted/b", accepted: true, skipped: true, skipReason: "resume-accepted" },
      { qualifiedNodePath: "root.c", nodeId: "c", status: "failed", runDir: "/run/c", latestDir: "/latest/c", acceptedDir: "/accepted/c", accepted: false },
    ],
    lanes: [],
  };

  const metrics = buildFlowSupervisorRunMetrics({ flowId: "demo", sessionId: "s1", events, runTree });

  assert.equal(metrics.durationMs, 10_000);
  assert.equal(metrics.nodeCount, 3);
  assert.equal(metrics.completedNodeCount, 2);
  assert.equal(metrics.failedNodeCount, 1);
  assert.equal(metrics.skippedNodeCount, 1);
  assert.equal(metrics.artifactObservedCount, 1);
  assert.equal(metrics.missingArtifactObservations, 1);
  assert.equal(metrics.acceptedCount, 1);
  assert.equal(metrics.retrySignals, 1);
  assert.equal(metrics.fallbackResolutionCount, 1);
  assert.equal(metrics.longestNode?.qualifiedNodePath, "root.a");
  assert.equal(metrics.longestNode?.durationMs, 5_000);
  assert.ok((metrics.maxSilentMs ?? 0) >= 2_000);
});

function iso(ms: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString();
}
