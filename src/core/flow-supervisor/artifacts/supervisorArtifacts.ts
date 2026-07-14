import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FlowSupervisorArtifactPaths, FlowSupervisorLedgerEntry, FlowSupervisorReport } from "../types";
import { renderFlowSupervisorSummary } from "../reporting/renderSupervisorSummary";

export function flowSupervisorArtifactPaths(rootDir: string): FlowSupervisorArtifactPaths {
  return {
    rootDir,
    ledgerPath: path.join(rootDir, "ledger.jsonl"),
    metricsPath: path.join(rootDir, "metrics.json"),
    healthPath: path.join(rootDir, "health.json"),
    fragilitySignalsPath: path.join(rootDir, "fragility-signals.json"),
    recoveryAttemptsPath: path.join(rootDir, "recovery-attempts.json"),
    remedyRecommendationsPath: path.join(rootDir, "remedy-recommendations.json"),
    summaryPath: path.join(rootDir, "summary.md"),
  };
}

export function supervisorArtifactRoot(args: {
  flowRunDir?: string;
  fallbackArtifactRoot: string;
  flowId: string;
  sessionId: string;
}): string {
  if (args.flowRunDir) return path.join(args.flowRunDir, "supervisor");
  return path.join(args.fallbackArtifactRoot, sanitizePathPart(args.flowId), sanitizePathPart(args.sessionId));
}

export async function writeFlowSupervisorArtifacts(args: {
  report: FlowSupervisorReport;
  ledger: FlowSupervisorLedgerEntry[];
}): Promise<void> {
  const { report } = args;
  await mkdir(report.artifacts.rootDir, { recursive: true });
  await writeFile(report.artifacts.ledgerPath, renderJsonl(args.ledger), "utf8");
  await writeJson(report.artifacts.metricsPath, report.metrics);
  await writeJson(report.artifacts.healthPath, { schemaVersion: report.schemaVersion, status: report.status });
  await writeJson(report.artifacts.fragilitySignalsPath, { schemaVersion: report.schemaVersion, signals: report.fragilitySignals });
  await writeJson(report.artifacts.recoveryAttemptsPath, { schemaVersion: report.schemaVersion, attempts: report.recoveryAttempts });
  await writeJson(report.artifacts.remedyRecommendationsPath, { schemaVersion: report.schemaVersion, recommendations: report.recommendations });
  await writeFile(report.artifacts.summaryPath, renderFlowSupervisorSummary(report), "utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderJsonl(entries: FlowSupervisorLedgerEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}
