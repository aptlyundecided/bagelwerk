import type { FlowSupervisorPolicy, FlowSupervisorPolicyInput } from "../types";

export const DEFAULT_FLOW_SUPERVISOR_POLICY: FlowSupervisorPolicy = {
  workspace: {
    requireIsolatedWorktree: true,
    forbiddenBranches: ["main", "master", "trunk"],
    allowDirtyWorktree: false,
    allowMainWorktreeOverride: false,
    allowCwdOutsideWorktree: false,
  },
  health: {
    maxExpectedRunMs: 30 * 60_000,
    maxExpectedNodeMs: 10 * 60_000,
    maxSilentMs: 2 * 60_000,
    maxRetrySignals: 0,
  },
  recovery: {
    mode: "observe-only",
    maxSupervisorAttempts: 1,
    resumeAcceptedOnly: true,
  },
  reporting: {
    writeSummaryMarkdown: true,
    includeRawEvents: false,
  },
};

export function normalizeFlowSupervisorPolicy(input: FlowSupervisorPolicyInput | undefined): FlowSupervisorPolicy {
  const merged: FlowSupervisorPolicy = {
    workspace: {
      ...DEFAULT_FLOW_SUPERVISOR_POLICY.workspace,
      ...input?.workspace,
    },
    health: {
      ...DEFAULT_FLOW_SUPERVISOR_POLICY.health,
      ...input?.health,
    },
    recovery: {
      ...DEFAULT_FLOW_SUPERVISOR_POLICY.recovery,
      ...input?.recovery,
    },
    reporting: {
      ...DEFAULT_FLOW_SUPERVISOR_POLICY.reporting,
      ...input?.reporting,
    },
  };

  return {
    ...merged,
    workspace: {
      ...merged.workspace,
      forbiddenBranches: normalizeForbiddenBranches(merged.workspace.forbiddenBranches),
    },
    health: {
      ...merged.health,
      maxExpectedRunMs: positiveIntegerOrDefault(merged.health.maxExpectedRunMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxExpectedRunMs),
      maxExpectedNodeMs: positiveIntegerOrDefault(merged.health.maxExpectedNodeMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxExpectedNodeMs),
      maxSilentMs: positiveIntegerOrDefault(merged.health.maxSilentMs, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxSilentMs),
      maxRetrySignals: nonNegativeIntegerOrDefault(merged.health.maxRetrySignals, DEFAULT_FLOW_SUPERVISOR_POLICY.health.maxRetrySignals),
    },
    recovery: {
      ...merged.recovery,
      maxSupervisorAttempts: positiveIntegerOrDefault(merged.recovery.maxSupervisorAttempts, DEFAULT_FLOW_SUPERVISOR_POLICY.recovery.maxSupervisorAttempts),
    },
  };
}

function normalizeForbiddenBranches(branches: string[]): string[] {
  const normalized = branches.map((branch) => branch.trim()).filter(Boolean);
  return Array.from(new Set(normalized));
}

function positiveIntegerOrDefault(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerOrDefault(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
