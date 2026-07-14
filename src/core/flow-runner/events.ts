import type { FlowRunnerNodeStatus } from "./runRecords";

export type FlowRunnerEventBase = {
  at: string;
};

export type FlowRunnerNodeProgress = {
  kind: "queue" | "count" | "message";
  total?: number;
  completed?: number;
  failed?: number;
  timedOut?: number;
  running?: number;
  queueId?: string;
  currentWorkItemId?: string;
  currentItem?: string;
  attempt?: number;
  maxAttempts?: number;
  retryOfWorkItemId?: string;
  reason?: string;
  message?: string;
};

export type FlowRunnerEvent = FlowRunnerEventBase & (
  | { type: "flow-start"; flowId: string; sessionId: string; mode: "whole-flow" | "prefix" | "lanes"; runDir: string }
  | { type: "flow-complete"; flowId: string; sessionId: string; status: FlowRunnerNodeStatus; runDir: string; latestDir: string }
  | { type: "node-start"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; label: string; runDir: string }
  | { type: "node-complete"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; status: FlowRunnerNodeStatus; note?: string; runDir: string; latestDir: string; acceptedDir: string; accepted: boolean }
  | { type: "node-progress"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId?: string; label?: string; progress: FlowRunnerNodeProgress }
  | { type: "node-skipped"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; reason: "resume-accepted"; acceptedDir: string }
  | { type: "transition"; flowId: string; sessionId: string; fromQualifiedNodePath: string; toQualifiedNodePath?: string; status: FlowRunnerNodeStatus }
  | { type: "artifact-observed"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; key?: string; label: string; relativePath: string; canonicalPath: string; exists: boolean }
  | { type: "accepted"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; acceptedDir: string }
  | { type: "unhandled-failure-resolution-start"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; status: Exclude<FlowRunnerNodeStatus, "completed"> }
  | { type: "unhandled-failure-resolution-complete"; flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; disposition: "recovered" | "hard_fail" | "ignored"; status: FlowRunnerNodeStatus; note?: string }
  | { type: "iteration"; flowId: string; sessionId: string; qualifiedNodePath: string; visit: number; maxVisits?: number }
  | { type: "lane-start"; flowId: string; sessionId: string; laneId: string; flowPath: string }
  | { type: "lane-complete"; flowId: string; sessionId: string; laneId: string; flowPath: string; status: FlowRunnerNodeStatus }
  | { type: "child-event"; flowId: string; sessionId: string; source: string; event: unknown }
);

export type FlowRunnerEventSink = (event: FlowRunnerEvent) => void;

export function flowRunnerEventLine(event: FlowRunnerEvent): string {
  switch (event.type) {
    case "flow-start":
      return `⬢ FLOW start ${event.flowId} mode=${event.mode}`;
    case "flow-complete":
      return `⬢ FLOW complete ${event.flowId} status=${event.status}`;
    case "node-start":
      return `◉ NODE start ${event.qualifiedNodePath}`;
    case "node-complete":
      return `◉ NODE complete ${event.qualifiedNodePath} status=${event.status}${event.accepted ? " accepted=true" : ""}`;
    case "node-progress":
      return `↻ NODE progress ${event.qualifiedNodePath} ${flowRunnerNodeProgressLine(event.progress)}`;
    case "node-skipped":
      return `◌ NODE skipped ${event.qualifiedNodePath} reason=${event.reason}`;
    case "transition":
      return `↳ TRANSITION ${event.fromQualifiedNodePath} -> ${event.toQualifiedNodePath ?? "<end>"} status=${event.status}`;
    case "artifact-observed":
      return `◈ ARTIFACT ${event.qualifiedNodePath}/${event.relativePath} exists=${event.exists}`;
    case "accepted":
      return `✓ ACCEPTED ${event.qualifiedNodePath}`;
    case "unhandled-failure-resolution-start":
      return `⚕ FAILURE fallback start ${event.qualifiedNodePath} status=${event.status}`;
    case "unhandled-failure-resolution-complete":
      return `⚕ FAILURE fallback complete ${event.qualifiedNodePath} disposition=${event.disposition} status=${event.status}`;
    case "iteration":
      return `↻ ITERATION ${event.qualifiedNodePath} visit=${event.visit}${event.maxVisits ? `/${event.maxVisits}` : ""}`;
    case "lane-start":
      return `⇉ LANE start ${event.laneId}`;
    case "lane-complete":
      return `⇇ LANE complete ${event.laneId} status=${event.status}`;
    case "child-event":
      return `↳ CHILD ${event.source}`;
  }
}

function flowRunnerNodeProgressLine(progress: FlowRunnerNodeProgress): string {
  if (progress.kind === "message") return progress.message ?? "message";
  const total = progress.total ?? 0;
  const completed = progress.completed ?? 0;
  const failed = progress.failed ?? 0;
  const running = progress.running ?? 0;
  return `${progress.queueId ? `${progress.queueId} ` : ""}${completed}/${total} failed=${failed} running=${running}`;
}
