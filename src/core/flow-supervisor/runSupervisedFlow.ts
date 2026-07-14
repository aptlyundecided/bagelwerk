import path from "node:path";

import { runExternalFlow, type FlowRunnerResumePolicy } from "../flow-runner";
import { flowSupervisorArtifactPaths, supervisorArtifactRoot, writeFlowSupervisorArtifacts } from "./artifacts/supervisorArtifacts";
import { buildFlowSupervisorFragilitySignals, classifyFlowSupervisorHealth } from "./health/runHealth";
import { normalizeFlowSupervisorPolicy } from "./policy/supervisorPolicy";
import { recommendFlowSupervisorRemedies } from "./reporting/remedyRecommendations";
import { createFlowSupervisorEventRecorder } from "./telemetry/supervisorEventRecorder";
import { buildFlowSupervisorRunMetrics } from "./telemetry/runMetrics";
import type {
  FlowSupervisorFragilitySignal,
  FlowSupervisorHealthStatus,
  FlowSupervisorLedgerEntry,
  FlowSupervisorRecoveryAttempt,
  FlowSupervisorReport,
  FlowSupervisorRunMetrics,
  FlowSupervisorRunResult,
  RunSupervisedExternalFlowParams,
} from "./types";
import { validateTargetWorkspace } from "./workspace/targetWorkspaceGuard";

export async function runSupervisedExternalFlow<TInput = Record<string, unknown>>(
  params: RunSupervisedExternalFlowParams<TInput>,
): Promise<FlowSupervisorRunResult<TInput>> {
  const policy = normalizeFlowSupervisorPolicy(params.supervisorPolicy);
  const targetWorkspace = path.resolve(params.targetWorkspace);
  const cwd = path.resolve(params.cwd ?? targetWorkspace);
  const recorder = createFlowSupervisorEventRecorder<TInput>({ onEvent: params.onEvent });
  recorder.recordSupervisorMessage("supervision-start", { flowId: params.flowId, sessionId: params.sessionId, targetWorkspace, cwd });

  const workspace = await validateTargetWorkspace({ targetWorkspace, cwd, policy: policy.workspace });
  if (!workspace.ok) {
    recorder.recordSupervisorMessage("workspace-guard-failed", { issues: workspace.issues });
    const metrics = emptyMetrics(params.flowId, params.sessionId);
    const report = await buildAndWriteReport({
      flowId: params.flowId,
      sessionId: params.sessionId,
      targetWorkspace,
      workspace,
      metrics,
      recoveryAttempts: [],
      extraSignals: [],
      flowRunDir: undefined,
      fallbackArtifactRoot: fallbackSupervisorArtifactRoot(targetWorkspace),
      ledger: recorder.snapshot().ledger,
      statusOverride: "aborted",
      policy,
    });
    return { supervisor: report };
  }

  let flowResult: FlowSupervisorRunResult<TInput>["flowResult"];
  let flowError: unknown;
  const recoveryAttempts: FlowSupervisorRecoveryAttempt[] = [];

  ({ flowResult, flowError } = await runFlowRunnerAttempt({ params, cwd, recorder }));

  const maxAttempts = policy.recovery.mode === "observe-only" ? 1 : policy.recovery.maxSupervisorAttempts;
  for (let attemptNumber = 2; attemptNumber <= maxAttempts && shouldAttemptRecovery(flowResult, flowError); attemptNumber += 1) {
    const recoveryAttempt: FlowSupervisorRecoveryAttempt = {
      attempt: attemptNumber - 1,
      mode: policy.recovery.mode,
      startedAt: new Date().toISOString(),
      disposition: "attempted",
      reason: policy.recovery.resumeAcceptedOnly ? "Retrying with accepted-only resume from prior successful Nodes." : "Retrying Flow run under bounded supervisor policy.",
    };
    recoveryAttempts.push(recoveryAttempt);
    recorder.recordSupervisorMessage("supervisor-recovery-attempt", recoveryAttempt);

    ({ flowResult, flowError } = await runFlowRunnerAttempt({
      params,
      cwd,
      recorder,
      resume: policy.recovery.resumeAcceptedOnly ? "accepted-only" : params.resume,
    }));

    recoveryAttempt.finishedAt = new Date().toISOString();
    recoveryAttempt.disposition = shouldAttemptRecovery(flowResult, flowError) ? "failed" : "succeeded";
  }

  const snapshot = recorder.snapshot();
  const metrics = buildFlowSupervisorRunMetrics({
    flowId: params.flowId,
    sessionId: params.sessionId,
    events: snapshot.events,
    ...(flowResult ? { runTree: flowResult.run.runTree } : {}),
  });
  const extraSignals: FlowSupervisorFragilitySignal[] = flowError
    ? [{ severity: "high", code: "flow_runner_threw", message: flowError instanceof Error ? flowError.message : String(flowError) }]
    : [];

  const report = await buildAndWriteReport({
    flowId: params.flowId,
    sessionId: params.sessionId,
    targetWorkspace,
    workspace,
    metrics,
    recoveryAttempts,
    extraSignals,
    flowRunDir: flowResult?.run.record.runDir,
    fallbackArtifactRoot: fallbackSupervisorArtifactRoot(targetWorkspace),
    ledger: snapshot.ledger,
    statusOverride: flowError ? "failed" : undefined,
    policy,
  });

  return { ...(flowResult ? { flowResult } : {}), supervisor: report };
}

type RunFlowRunnerAttemptParams<TInput> = {
  params: RunSupervisedExternalFlowParams<TInput>;
  cwd: string;
  recorder: ReturnType<typeof createFlowSupervisorEventRecorder<TInput>>;
  resume?: FlowRunnerResumePolicy;
};

async function runFlowRunnerAttempt<TInput>(args: RunFlowRunnerAttemptParams<TInput>): Promise<{
  flowResult?: FlowSupervisorRunResult<TInput>["flowResult"];
  flowError?: unknown;
}> {
  try {
    const flowResult = await runExternalFlow<TInput>({
      cwd: args.cwd,
      flowId: args.params.flowId,
      sessionId: args.params.sessionId,
      ...(args.params.input !== undefined ? { input: args.params.input } : {}),
      ...(args.params.artifactRoot ? { artifactRoot: args.params.artifactRoot } : {}),
      ...(args.params.acceptedByKind ? { acceptedByKind: args.params.acceptedByKind } : {}),
      ...(args.params.acceptedById ? { acceptedById: args.params.acceptedById } : {}),
      ...((args.resume ?? args.params.resume) ? { resume: args.resume ?? args.params.resume } : {}),
      ...(args.params.executionPlan ? { executionPlan: args.params.executionPlan } : {}),
      ...(args.params.executionPolicyOverlay ? { executionPolicyOverlay: args.params.executionPolicyOverlay } : {}),
      ...(args.params.unhandledFailureResolver ? { unhandledFailureResolver: args.params.unhandledFailureResolver } : {}),
      ...(args.params.log ? { log: args.params.log } : {}),
      onEvent: args.recorder.onEvent,
      middlewares: [args.recorder.middleware, ...(args.params.middlewares ?? [])],
    });
    args.recorder.recordSupervisorMessage("flow-runner-complete", { status: flowResult.run.runTree.status, runDir: flowResult.run.record.runDir });
    return { flowResult };
  } catch (error) {
    args.recorder.recordSupervisorMessage("flow-runner-threw", { error: error instanceof Error ? error.message : String(error) });
    return { flowError: error };
  }
}

function shouldAttemptRecovery<TInput>(flowResult: FlowSupervisorRunResult<TInput>["flowResult"] | undefined, flowError: unknown): boolean {
  return Boolean(flowError) || (flowResult !== undefined && flowResult.run.runTree.status !== "completed");
}

type BuildAndWriteReportParams = {
  flowId: string;
  sessionId: string;
  targetWorkspace: string;
  workspace: Awaited<ReturnType<typeof validateTargetWorkspace>>;
  metrics: FlowSupervisorRunMetrics;
  recoveryAttempts: FlowSupervisorRecoveryAttempt[];
  extraSignals: FlowSupervisorFragilitySignal[];
  flowRunDir?: string;
  fallbackArtifactRoot: string;
  ledger: FlowSupervisorLedgerEntry[];
  statusOverride?: FlowSupervisorHealthStatus;
  policy: ReturnType<typeof normalizeFlowSupervisorPolicy>;
};

async function buildAndWriteReport(args: BuildAndWriteReportParams): Promise<FlowSupervisorReport> {
  const baseSignals = buildFlowSupervisorFragilitySignals({ metrics: args.metrics, healthPolicy: args.policy.health, recoveryAttempts: args.recoveryAttempts });
  const fragilitySignals = [...baseSignals, ...args.extraSignals];
  const recommendations = recommendFlowSupervisorRemedies({ metrics: args.metrics, signals: fragilitySignals });
  const artifacts = flowSupervisorArtifactPaths(supervisorArtifactRoot({
    flowRunDir: args.flowRunDir,
    fallbackArtifactRoot: args.fallbackArtifactRoot,
    flowId: args.flowId,
    sessionId: args.sessionId,
  }));
  const status = args.statusOverride ?? classifyFlowSupervisorHealth({
    metrics: args.metrics,
    signals: fragilitySignals,
    recoveryAttempts: args.recoveryAttempts,
    workspaceOk: args.workspace.ok,
  });
  const report = {
    schemaVersion: 1 as const,
    status,
    workspace: args.workspace,
    metrics: args.metrics,
    fragilitySignals,
    recoveryAttempts: args.recoveryAttempts,
    recommendations,
    artifacts,
  };
  await writeFlowSupervisorArtifacts({ report, ledger: args.ledger });
  return report;
}

function emptyMetrics(flowId: string, sessionId: string): FlowSupervisorRunMetrics {
  return {
    flowId,
    sessionId,
    nodeCount: 0,
    completedNodeCount: 0,
    failedNodeCount: 0,
    skippedNodeCount: 0,
    artifactObservedCount: 0,
    missingArtifactObservations: 0,
    acceptedCount: 0,
    retrySignals: 0,
    fallbackResolutionCount: 0,
    nodes: [],
  };
}

function fallbackSupervisorArtifactRoot(targetWorkspace: string): string {
  return path.join(targetWorkspace, ".artifacts", "flow-supervisor");
}
