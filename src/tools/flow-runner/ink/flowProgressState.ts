import type { FlowRunnerEvent, FlowRunnerNodeProgress } from "../../../core/flow-runner/events";
import type { FlowRunnerExecutionPlan } from "../../../core/flow-runner";
import type { FlowProgressGraphInit } from "./flowProgressGraph";
import type { FlowRunnerNodeStatus } from "../../../core/flow-runner/runRecords";

export type FlowProgressEvent = FlowRunnerEvent;

export type FlowProgressMetadata = {
  title?: string;
  flowId?: string;
  flowName?: string;
  sessionId?: string;
  artifactRoot?: string;
  executionPlan?: FlowRunnerExecutionPlan;
};

export type FlowProgressNodeSnapshot = {
  qualifiedNodePath: string;
  nodeId?: string;
  label?: string;
  flowPath?: string;
  group?: "prefix" | "lane" | "join" | "flow";
  laneId?: string;
  status: FlowRunnerNodeStatus | "running" | "pending" | "skipped";
  runDir?: string;
  latestDir?: string;
  acceptedDir?: string;
  accepted?: boolean;
  note?: string;
  skipped?: boolean;
  skipReason?: string;
  progress?: FlowRunnerNodeProgress;
  startedAt?: string;
  completedAt?: string;
};

export type FlowProgressLaneSnapshot = {
  laneId: string;
  flowPath: string;
  status: FlowRunnerNodeStatus | "running" | "pending";
  startedAt?: string;
  completedAt?: string;
};

export type FlowProgressArtifactSnapshot = {
  qualifiedNodePath: string;
  nodeId: string;
  key?: string;
  label: string;
  relativePath: string;
  canonicalPath: string;
  exists: boolean;
  observedAt: string;
};

export type FlowProgressFailureSnapshot = {
  qualifiedNodePath: string;
  nodeId: string;
  status: FlowRunnerNodeStatus;
  disposition?: "recovered" | "hard_fail" | "ignored";
  note?: string;
  at: string;
};

export type FlowProgressRecentEvent = {
  at: string;
  type: FlowProgressEvent["type"];
  label: string;
  severity: "info" | "success" | "warning" | "error";
};

export type FlowProgressSnapshot = FlowProgressMetadata & {
  mode?: "whole-flow" | "prefix" | "lanes";
  status: FlowRunnerNodeStatus | "running" | "pending";
  runDir?: string;
  latestDir?: string;
  startedAt?: string;
  completedAt?: string;
  nodes: Record<string, FlowProgressNodeSnapshot>;
  nodeOrder: string[];
  lanes: Record<string, FlowProgressLaneSnapshot>;
  laneOrder: string[];
  artifacts: FlowProgressArtifactSnapshot[];
  accepted: Record<string, string>;
  failures: FlowProgressFailureSnapshot[];
  recent: FlowProgressRecentEvent[];
  eventCount: number;
  closed: boolean;
};

export function createInitialFlowProgressSnapshot(metadata: FlowProgressMetadata = {}): FlowProgressSnapshot {
  return {
    ...metadata,
    status: "pending",
    nodes: {},
    nodeOrder: [],
    lanes: {},
    laneOrder: [],
    artifacts: [],
    accepted: {},
    failures: [],
    recent: [],
    eventCount: 0,
    closed: false,
  };
}

export function initializeFlowProgressGraph(current: FlowProgressSnapshot, graph: FlowProgressGraphInit): FlowProgressSnapshot {
  const nodes = { ...current.nodes };
  const nodeOrder = [...current.nodeOrder];
  for (const planned of graph.nodes) {
    if (!nodes[planned.qualifiedNodePath]) {
      nodes[planned.qualifiedNodePath] = {
        qualifiedNodePath: planned.qualifiedNodePath,
        nodeId: planned.nodeId,
        label: planned.label,
        flowPath: planned.flowPath,
        ...(planned.group ? { group: planned.group } : {}),
        ...(planned.laneId ? { laneId: planned.laneId } : {}),
        status: "pending",
      };
    }
    if (!nodeOrder.includes(planned.qualifiedNodePath)) nodeOrder.push(planned.qualifiedNodePath);
  }

  const lanes = { ...current.lanes };
  const laneOrder = [...current.laneOrder];
  for (const planned of graph.lanes) {
    if (!lanes[planned.laneId]) {
      lanes[planned.laneId] = {
        laneId: planned.laneId,
        flowPath: planned.flowPath,
        status: "pending",
      };
    }
    if (!laneOrder.includes(planned.laneId)) laneOrder.push(planned.laneId);
  }

  return { ...current, nodes, nodeOrder, lanes, laneOrder };
}

export function reduceFlowProgressEvent(current: FlowProgressSnapshot, event: FlowProgressEvent): FlowProgressSnapshot {
  const next = { ...current, eventCount: current.eventCount + 1 };
  const recent = [recentEventFor(event), ...current.recent].slice(0, 12);

  if (event.type === "flow-start") {
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      mode: event.mode,
      status: "running",
      runDir: event.runDir,
      startedAt: event.at,
      recent,
    };
  }

  if (event.type === "flow-complete") {
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      status: event.status,
      runDir: event.runDir,
      latestDir: event.latestDir,
      completedAt: event.at,
      recent,
    };
  }

  if (event.type === "node-start") {
    return upsertNode(next, event.qualifiedNodePath, {
      qualifiedNodePath: event.qualifiedNodePath,
      nodeId: event.nodeId,
      label: event.label,
      status: "running",
      runDir: event.runDir,
      startedAt: event.at,
    }, recent);
  }

  if (event.type === "node-complete") {
    return upsertNode(next, event.qualifiedNodePath, {
      qualifiedNodePath: event.qualifiedNodePath,
      nodeId: event.nodeId,
      status: event.status,
      ...(event.note ? { note: event.note } : {}),
      runDir: event.runDir,
      latestDir: event.latestDir,
      acceptedDir: event.acceptedDir,
      accepted: event.accepted,
      completedAt: event.at,
    }, recent);
  }

  if (event.type === "node-skipped") {
    return upsertNode(next, event.qualifiedNodePath, {
      qualifiedNodePath: event.qualifiedNodePath,
      nodeId: event.nodeId,
      status: "skipped",
      skipped: true,
      skipReason: event.reason,
      acceptedDir: event.acceptedDir,
      accepted: true,
      completedAt: event.at,
    }, recent);
  }

  if (event.type === "node-progress") {
    return upsertNode(next, event.qualifiedNodePath, {
      qualifiedNodePath: event.qualifiedNodePath,
      ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      ...(event.label ? { label: event.label } : {}),
      status: current.nodes[event.qualifiedNodePath]?.status ?? "running",
      progress: event.progress,
    }, recent);
  }

  if (event.type === "lane-start") {
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      lanes: { ...current.lanes, [event.laneId]: { laneId: event.laneId, flowPath: event.flowPath, status: "running", startedAt: event.at } },
      laneOrder: appendOnce(current.laneOrder, event.laneId),
      recent,
    };
  }

  if (event.type === "lane-complete") {
    const existing = current.lanes[event.laneId];
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      lanes: { ...current.lanes, [event.laneId]: { laneId: event.laneId, flowPath: event.flowPath, status: event.status, startedAt: existing?.startedAt, completedAt: event.at } },
      laneOrder: appendOnce(current.laneOrder, event.laneId),
      recent,
    };
  }

  if (event.type === "artifact-observed") {
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      artifacts: [...current.artifacts, {
        qualifiedNodePath: event.qualifiedNodePath,
        nodeId: event.nodeId,
        ...(event.key ? { key: event.key } : {}),
        label: event.label,
        relativePath: event.relativePath,
        canonicalPath: event.canonicalPath,
        exists: event.exists,
        observedAt: event.at,
      }],
      recent,
    };
  }

  if (event.type === "accepted") {
    return {
      ...next,
      flowId: event.flowId,
      sessionId: event.sessionId,
      accepted: { ...current.accepted, [event.qualifiedNodePath]: event.acceptedDir },
      recent,
    };
  }

  if (event.type === "unhandled-failure-resolution-start") {
    return {
      ...next,
      failures: [...current.failures, { qualifiedNodePath: event.qualifiedNodePath, nodeId: event.nodeId, status: event.status, at: event.at }],
      recent,
    };
  }

  if (event.type === "unhandled-failure-resolution-complete") {
    return {
      ...next,
      failures: [...current.failures, {
        qualifiedNodePath: event.qualifiedNodePath,
        nodeId: event.nodeId,
        status: event.status,
        disposition: event.disposition,
        ...(event.note ? { note: event.note } : {}),
        at: event.at,
      }],
      recent,
    };
  }

  return { ...next, recent };
}

export function closeFlowProgressSnapshot(current: FlowProgressSnapshot): FlowProgressSnapshot {
  return { ...current, closed: true };
}

function upsertNode(current: FlowProgressSnapshot, qualifiedNodePath: string, patch: FlowProgressNodeSnapshot, recent: FlowProgressRecentEvent[]): FlowProgressSnapshot {
  const existing = current.nodes[qualifiedNodePath];
  return {
    ...current,
    nodes: { ...current.nodes, [qualifiedNodePath]: { ...existing, ...patch } },
    nodeOrder: appendOnce(current.nodeOrder, qualifiedNodePath),
    recent,
  };
}

function appendOnce(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function recentEventFor(event: FlowProgressEvent): FlowProgressRecentEvent {
  if (event.type === "flow-start") return { at: event.at, type: event.type, label: `Flow start ${event.flowId}`, severity: "info" };
  if (event.type === "flow-complete") return { at: event.at, type: event.type, label: `Flow complete ${event.flowId} status=${event.status}`, severity: event.status === "completed" ? "success" : "error" };
  if (event.type === "node-start") return { at: event.at, type: event.type, label: `Node start ${event.qualifiedNodePath}`, severity: "info" };
  if (event.type === "node-complete") return { at: event.at, type: event.type, label: `Node complete ${event.qualifiedNodePath} status=${event.status}`, severity: event.status === "completed" ? "success" : "error" };
  if (event.type === "node-skipped") return { at: event.at, type: event.type, label: `Node skipped ${event.qualifiedNodePath}`, severity: "warning" };
  if (event.type === "node-progress") return { at: event.at, type: event.type, label: nodeProgressLabel(event), severity: "info" };
  if (event.type === "lane-start") return { at: event.at, type: event.type, label: `Lane start ${event.laneId}`, severity: "info" };
  if (event.type === "lane-complete") return { at: event.at, type: event.type, label: `Lane complete ${event.laneId} status=${event.status}`, severity: event.status === "completed" ? "success" : "error" };
  if (event.type === "transition") return { at: event.at, type: event.type, label: `Transition ${event.fromQualifiedNodePath} -> ${event.toQualifiedNodePath ?? "<end>"}`, severity: "info" };
  if (event.type === "artifact-observed") return { at: event.at, type: event.type, label: `Artifact ${event.qualifiedNodePath}/${event.relativePath} exists=${event.exists}`, severity: event.exists ? "success" : "warning" };
  if (event.type === "accepted") return { at: event.at, type: event.type, label: `Accepted ${event.qualifiedNodePath}`, severity: "success" };
  if (event.type === "unhandled-failure-resolution-start") return { at: event.at, type: event.type, label: `Failure fallback start ${event.qualifiedNodePath}`, severity: "warning" };
  if (event.type === "unhandled-failure-resolution-complete") return { at: event.at, type: event.type, label: `Failure fallback ${event.qualifiedNodePath} disposition=${event.disposition}`, severity: event.disposition === "recovered" ? "success" : "error" };
  if (event.type === "iteration") return { at: event.at, type: event.type, label: `Iteration ${event.qualifiedNodePath} visit=${event.visit}${event.maxVisits ? `/${event.maxVisits}` : ""}`, severity: "info" };
  return { at: event.at, type: event.type, label: `Child event ${event.source}`, severity: "info" };
}

function nodeProgressLabel(event: Extract<FlowRunnerEvent, { type: "node-progress" }>): string {
  const progress = event.progress;
  if (progress.kind === "message") return `Node progress ${event.qualifiedNodePath}${progress.message ? `: ${progress.message}` : ""}`;
  const total = progress.total ?? 0;
  const completed = progress.completed ?? 0;
  const failed = progress.failed ?? 0;
  const running = progress.running ?? 0;
  return `Node progress ${event.qualifiedNodePath} ${completed}/${total} failed=${failed} running=${running}`;
}
