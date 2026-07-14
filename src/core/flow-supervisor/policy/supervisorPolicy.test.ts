import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FLOW_SUPERVISOR_POLICY, normalizeFlowSupervisorPolicy } from "./supervisorPolicy";

test("normalizeFlowSupervisorPolicy returns defaults without input", () => {
  assert.deepEqual(normalizeFlowSupervisorPolicy(undefined), DEFAULT_FLOW_SUPERVISOR_POLICY);
});

test("normalizeFlowSupervisorPolicy shallow-merges policy sections", () => {
  const policy = normalizeFlowSupervisorPolicy({
    workspace: { allowDirtyWorktree: true, forbiddenBranches: ["main", " main ", "release"] },
    health: { maxSilentMs: 30_000, maxRetrySignals: 2 },
    recovery: { mode: "resume-once", maxSupervisorAttempts: 2 },
  });

  assert.equal(policy.workspace.requireIsolatedWorktree, true);
  assert.equal(policy.workspace.allowDirtyWorktree, true);
  assert.deepEqual(policy.workspace.forbiddenBranches, ["main", "release"]);
  assert.equal(policy.health.maxSilentMs, 30_000);
  assert.equal(policy.health.maxRetrySignals, 2);
  assert.equal(policy.recovery.mode, "resume-once");
  assert.equal(policy.recovery.maxSupervisorAttempts, 2);
  assert.equal(policy.recovery.resumeAcceptedOnly, true);
});

test("normalizeFlowSupervisorPolicy repairs invalid numeric thresholds", () => {
  const policy = normalizeFlowSupervisorPolicy({
    health: { maxExpectedRunMs: 0, maxExpectedNodeMs: -1, maxSilentMs: Number.NaN, maxRetrySignals: -1 },
    recovery: { maxSupervisorAttempts: 0 },
  });

  assert.equal(policy.health.maxExpectedRunMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxExpectedRunMs);
  assert.equal(policy.health.maxExpectedNodeMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxExpectedNodeMs);
  assert.equal(policy.health.maxSilentMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxSilentMs);
  assert.equal(policy.health.maxRetrySignals, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxRetrySignals);
  assert.equal(policy.recovery.maxSupervisorAttempts, DEFAULT_FLOW_SUPERVISOR_POLICY.recovery.maxSupervisorAttempts);
});
