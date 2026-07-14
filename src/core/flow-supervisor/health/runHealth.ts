import type {
  FlowSupervisorFragilitySignal,
  FlowSupervisorHealthPolicy,
  FlowSupervisorHealthStatus,
  FlowSupervisorRecoveryAttempt,
  FlowSupervisorRunMetrics,
} from "../types";

export function buildFlowSupervisorFragilitySignals(args: {
  metrics: FlowSupervisorRunMetrics;
  healthPolicy: FlowSupervisorHealthPolicy;
  recoveryAttempts?: FlowSupervisorRecoveryAttempt[];
}): FlowSupervisorFragilitySignal[] {
  const signals: FlowSupervisorFragilitySignal[] = [];
  const { metrics, healthPolicy } = args;

  if (metrics.durationMs !== undefined && metrics.durationMs > healthPolicy.maxExpectedRunMs) {
    signals.push({ severity: "warning", code: "slow_run", message: `Run took ${metrics.durationMs}ms, above expected ${healthPolicy.maxExpectedRunMs}ms.` });
  }

  for (const node of metrics.nodes) {
    if (node.durationMs !== undefined && node.durationMs > healthPolicy.maxExpectedNodeMs) {
      signals.push({ severity: "warning", code: "slow_node", qualifiedNodePath: node.qualifiedNodePath, message: `Node took ${node.durationMs}ms, above expected ${healthPolicy.maxExpectedNodeMs}ms.` });
    }
    if (node.maxSilentMs !== undefined && node.maxSilentMs > healthPolicy.maxSilentMs) {
      signals.push({ severity: "warning", code: "long_silence", qualifiedNodePath: node.qualifiedNodePath, message: `Node had a ${node.maxSilentMs}ms event/progress silence window.` });
    }
    if (node.retrySignals > healthPolicy.maxRetrySignals) {
      signals.push({ severity: "high", code: "retry_heavy_node", qualifiedNodePath: node.qualifiedNodePath, message: `Node emitted ${node.retrySignals} retry signal(s).` });
    }
  }

  if (metrics.retrySignals > healthPolicy.maxRetrySignals) {
    signals.push({ severity: "high", code: "retry_heavy_run", message: `Run emitted ${metrics.retrySignals} retry signal(s).` });
  }
  if (metrics.fallbackResolutionCount > 0) {
    signals.push({ severity: "high", code: "failure_fallback_used", message: `Flow Runner used failure fallback ${metrics.fallbackResolutionCount} time(s).` });
  }
  if (metrics.missingArtifactObservations > 0) {
    signals.push({ severity: "high", code: "missing_artifact_observed", message: `${metrics.missingArtifactObservations} artifact observation(s) were missing.` });
  }
  if (metrics.skippedNodeCount > 0) {
    signals.push({ severity: "info", code: "resume_skip_used", message: `${metrics.skippedNodeCount} node(s) were skipped from accepted results.` });
  }
  if (metrics.failedNodeCount > 0) {
    signals.push({ severity: "high", code: "failed_nodes", message: `${metrics.failedNodeCount} node(s) ended in a non-completed status.` });
  }

  const successfulRecovery = (args.recoveryAttempts ?? []).some((attempt) => attempt.disposition === "succeeded");
  if (successfulRecovery) {
    signals.push({ severity: "warning", code: "supervisor_recovery_used", message: "Run completed after supervisor recovery." });
  }

  return signals;
}

export function classifyFlowSupervisorHealth(args: {
  metrics: FlowSupervisorRunMetrics;
  signals: FlowSupervisorFragilitySignal[];
  recoveryAttempts?: FlowSupervisorRecoveryAttempt[];
  workspaceOk?: boolean;
  aborted?: boolean;
  blocked?: boolean;
}): FlowSupervisorHealthStatus {
  if (args.aborted || args.workspaceOk === false) return "aborted";
  if (args.blocked) return "blocked";
  if (args.metrics.failedNodeCount > 0) return "failed";

  const successfulRecovery = (args.recoveryAttempts ?? []).some((attempt) => attempt.disposition === "succeeded");
  if (successfulRecovery) return "recovered-success";

  const nonInfoSignals = args.signals.filter((signal) => signal.severity !== "info");
  if (nonInfoSignals.length === 0) return "clean-success";

  const onlySlowSignals = nonInfoSignals.every((signal) => signal.code === "slow_run" || signal.code === "slow_node");
  return onlySlowSignals ? "slow-success" : "fragile-success";
}
