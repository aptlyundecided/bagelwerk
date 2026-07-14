import type { FlowSupervisorReport } from "../types";

export function renderFlowSupervisorSummary(report: FlowSupervisorReport): string {
  const lines = [
    `# Flow Supervisor Summary`,
    "",
    `**Status:** ${report.status}`,
    `**Flow:** ${report.metrics.flowId}`,
    `**Session:** ${report.metrics.sessionId}`,
    `**Workspace:** ${report.workspace.targetWorkspace}`,
    "",
    "## Runtime",
    `- Duration: ${formatDuration(report.metrics.durationMs)}`,
    `- Nodes: ${report.metrics.completedNodeCount}/${report.metrics.nodeCount} completed (${report.metrics.failedNodeCount} failed, ${report.metrics.skippedNodeCount} skipped/resumed)`,
    `- Retry signals: ${report.metrics.retrySignals}`,
    `- Failure fallback events: ${report.metrics.fallbackResolutionCount}`,
    `- Artifact observations: ${report.metrics.artifactObservedCount} (${report.metrics.missingArtifactObservations} missing)`,
    ...(report.metrics.longestNode ? [`- Longest Node: ${report.metrics.longestNode.qualifiedNodePath} (${formatDuration(report.metrics.longestNode.durationMs)})`] : []),
    "",
    "## Workspace Guard",
    `- OK: ${report.workspace.ok}`,
    `- Branch: ${report.workspace.branch ?? "unknown"}`,
    `- Dirty: ${report.workspace.isDirty === undefined ? "unknown" : String(report.workspace.isDirty)}`,
    ...(report.workspace.issues.length > 0 ? report.workspace.issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`) : ["- No workspace issues recorded."]),
    "",
    "## Fragility Signals",
    ...(report.fragilitySignals.length > 0
      ? report.fragilitySignals.map((signal) => `- ${signal.severity.toUpperCase()} ${signal.code}${signal.qualifiedNodePath ? ` (${signal.qualifiedNodePath})` : ""}: ${signal.message}`)
      : ["- None."]),
    "",
    "## Recommended Remedies",
    ...(report.recommendations.length > 0
      ? report.recommendations.map((recommendation) => `- **${recommendation.title}**${recommendation.qualifiedNodePath ? ` (${recommendation.qualifiedNodePath})` : ""}: ${recommendation.detail}`)
      : ["- None."]),
    "",
    "## Artifact Paths",
    `- Metrics: ${report.artifacts.metricsPath}`,
    `- Health: ${report.artifacts.healthPath}`,
    `- Fragility signals: ${report.artifacts.fragilitySignalsPath}`,
    `- Recovery attempts: ${report.artifacts.recoveryAttemptsPath}`,
    `- Remedy recommendations: ${report.artifacts.remedyRecommendationsPath}`,
    `- Ledger: ${report.artifacts.ledgerPath}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "unknown";
  if (ms < 1_000) return `${ms}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
