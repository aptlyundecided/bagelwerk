import type { FlowRunnerEvent, RunExternalFlowParams, RunExternalFlowResult } from "../flow-runner";

export type FlowSupervisorHealthStatus =
  | "clean-success"
  | "slow-success"
  | "recovered-success"
  | "fragile-success"
  | "blocked"
  | "failed"
  | "aborted";

export type FlowSupervisorRecoveryMode = "observe-only" | "resume-once" | "bounded-retry";

export type FlowSupervisorWorkspacePolicy = {
  requireIsolatedWorktree: boolean;
  forbiddenBranches: string[];
  allowDirtyWorktree: boolean;
  allowMainWorktreeOverride: boolean;
  /**
   * Allow the Flow's `cwd` (where its config/binding is loaded from) to live outside the target
   * worktree. Needed when a generic/external Flow operates on a target worktree via Node input
   * rather than by being colocated with it (e.g. a Work Orchestrator's shared Coding Task Flow).
   *
   * Still enforced even with this flag on: `targetWorkspace` must be an isolated worktree, and
   * `cwd` must NOT resolve into the target's OWN repository (a sibling worktree/main checkout of
   * the target repo) — that is rejected with `cwd_in_target_repository`. Only a cwd fully outside
   * the target repo is permitted.
   */
  allowCwdOutsideWorktree: boolean;
};

export type FlowSupervisorHealthPolicy = {
  maxExpectedRunMs: number;
  maxExpectedNodeMs: number;
  maxSilentMs: number;
  maxRetrySignals: number;
};

export type FlowSupervisorRecoveryPolicy = {
  mode: FlowSupervisorRecoveryMode;
  maxSupervisorAttempts: number;
  resumeAcceptedOnly: boolean;
};

export type FlowSupervisorReportingPolicy = {
  writeSummaryMarkdown: boolean;
  includeRawEvents: boolean;
};

export type FlowSupervisorPolicy = {
  workspace: FlowSupervisorWorkspacePolicy;
  health: FlowSupervisorHealthPolicy;
  recovery: FlowSupervisorRecoveryPolicy;
  reporting: FlowSupervisorReportingPolicy;
};

export type FlowSupervisorPolicyInput = Partial<{
  workspace: Partial<FlowSupervisorWorkspacePolicy>;
  health: Partial<FlowSupervisorHealthPolicy>;
  recovery: Partial<FlowSupervisorRecoveryPolicy>;
  reporting: Partial<FlowSupervisorReportingPolicy>;
}>;

export type FlowSupervisorWorkspaceIssueSeverity = "error" | "warning";

export type FlowSupervisorWorkspaceIssue = {
  severity: FlowSupervisorWorkspaceIssueSeverity;
  code: string;
  message: string;
};

export type FlowSupervisorWorkspaceReport = {
  targetWorkspace: string;
  ok: boolean;
  isGitWorktree: boolean;
  isIsolatedWorktree: boolean;
  branch?: string;
  isDirty?: boolean;
  issues: FlowSupervisorWorkspaceIssue[];
};

export type FlowSupervisorNodeMetric = {
  qualifiedNodePath: string;
  nodeId?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  progressEvents: number;
  maxSilentMs?: number;
  retrySignals: number;
};

export type FlowSupervisorRunMetrics = {
  flowId: string;
  sessionId: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  nodeCount: number;
  completedNodeCount: number;
  failedNodeCount: number;
  skippedNodeCount: number;
  artifactObservedCount: number;
  missingArtifactObservations: number;
  acceptedCount: number;
  retrySignals: number;
  fallbackResolutionCount: number;
  maxSilentMs?: number;
  longestNode?: FlowSupervisorNodeMetric;
  nodes: FlowSupervisorNodeMetric[];
};

export type FlowSupervisorFragilitySignal = {
  severity: "info" | "warning" | "high";
  code: string;
  message: string;
  qualifiedNodePath?: string;
};

export type FlowSupervisorRecoveryAttempt = {
  attempt: number;
  mode: FlowSupervisorRecoveryMode;
  startedAt: string;
  finishedAt?: string;
  disposition: "not-needed" | "attempted" | "skipped-policy" | "succeeded" | "failed";
  reason: string;
};

export type FlowSupervisorRemedyRecommendation = {
  code: string;
  title: string;
  detail: string;
  qualifiedNodePath?: string;
};

export type FlowSupervisorArtifactPaths = {
  rootDir: string;
  ledgerPath: string;
  metricsPath: string;
  healthPath: string;
  fragilitySignalsPath: string;
  recoveryAttemptsPath: string;
  remedyRecommendationsPath: string;
  summaryPath: string;
};

export type FlowSupervisorLedgerEntry = {
  at: string;
  type: "supervisor" | "flow-runner-event" | "middleware";
  message: string;
  event?: FlowRunnerEvent;
  data?: unknown;
};

export type FlowSupervisorRecordedEvents = {
  events: FlowRunnerEvent[];
  ledger: FlowSupervisorLedgerEntry[];
};

export type FlowSupervisorReport = {
  schemaVersion: 1;
  status: FlowSupervisorHealthStatus;
  workspace: FlowSupervisorWorkspaceReport;
  metrics: FlowSupervisorRunMetrics;
  fragilitySignals: FlowSupervisorFragilitySignal[];
  recoveryAttempts: FlowSupervisorRecoveryAttempt[];
  recommendations: FlowSupervisorRemedyRecommendation[];
  artifacts: FlowSupervisorArtifactPaths;
};

export type RunSupervisedExternalFlowParams<TInput = Record<string, unknown>> = Omit<RunExternalFlowParams<TInput>, "cwd"> & {
  cwd?: string;
  targetWorkspace: string;
  supervisorPolicy?: FlowSupervisorPolicyInput;
};

export type FlowSupervisorRunResult<TInput = Record<string, unknown>> = {
  flowResult?: RunExternalFlowResult<TInput>;
  supervisor: FlowSupervisorReport;
};
