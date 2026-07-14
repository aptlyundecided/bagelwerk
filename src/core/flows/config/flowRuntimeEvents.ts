import { formatCoreRuntimeLine } from "../../terminal";
import type { ResolvedFlowGraph } from "./resolvedFlow";
import { resolveFlowNodePath } from "./compileConfiguredFlow";

export type FlowRuntimeEventKind = "enter" | "exit" | "transit";
export type FlowRuntimeEventReason = "run-start" | "resume-start" | "node-transition" | "run-end";

export type FlowRuntimeEvent = {
  schemaVersion: 1;
  kind: FlowRuntimeEventKind;
  flowPath: string[];
  qualifiedFlowPath: string;
  at: string;
  reason: FlowRuntimeEventReason;
  fromNodePath?: string;
  toNodePath?: string;
  fromFlowPath?: string;
  toFlowPath?: string;
};

export type FlowRuntimeEventSidecar = {
  schemaVersion: 1;
  events: FlowRuntimeEvent[];
};

function qualifiedFlowPath(flowPath: string[]): string {
  return flowPath.join(".");
}

function commonPrefixLength(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return max;
}

function flowPathPrefixes(flowPath: string[]): string[][] {
  return flowPath.map((_, index) => flowPath.slice(0, index + 1));
}

function event(params: {
  kind: FlowRuntimeEventKind;
  flowPath: string[];
  at: string;
  reason: FlowRuntimeEventReason;
  fromNodePath?: string;
  toNodePath?: string;
  fromFlowPath?: string;
  toFlowPath?: string;
}): FlowRuntimeEvent {
  return {
    schemaVersion: 1,
    kind: params.kind,
    flowPath: [...params.flowPath],
    qualifiedFlowPath: qualifiedFlowPath(params.flowPath),
    at: params.at,
    reason: params.reason,
    ...(params.fromNodePath ? { fromNodePath: params.fromNodePath } : {}),
    ...(params.toNodePath ? { toNodePath: params.toNodePath } : {}),
    ...(params.fromFlowPath ? { fromFlowPath: params.fromFlowPath } : {}),
    ...(params.toFlowPath ? { toFlowPath: params.toFlowPath } : {}),
  };
}

export function createFlowEnterEventsForNode(params: {
  resolved: ResolvedFlowGraph;
  nodePath: string;
  at: string;
  reason: Extract<FlowRuntimeEventReason, "run-start" | "resume-start">;
}): FlowRuntimeEvent[] {
  const node = resolveFlowNodePath(params.resolved, params.nodePath);
  return flowPathPrefixes(node.flowPath).map((flowPath) =>
    event({
      kind: "enter",
      flowPath,
      at: params.at,
      reason: params.reason,
      toNodePath: node.qualifiedPath,
      toFlowPath: qualifiedFlowPath(node.flowPath),
    }),
  );
}

export function createFlowTransitionEvents(params: {
  resolved: ResolvedFlowGraph;
  fromNodePath: string;
  toNodePath: string;
  at: string;
}): FlowRuntimeEvent[] {
  const fromNode = resolveFlowNodePath(params.resolved, params.fromNodePath);
  const toNode = resolveFlowNodePath(params.resolved, params.toNodePath);
  const fromFlowPath = fromNode.flowPath;
  const toFlowPath = toNode.flowPath;
  const common = commonPrefixLength(fromFlowPath, toFlowPath);

  if (common === fromFlowPath.length && common === toFlowPath.length) return [];

  const events: FlowRuntimeEvent[] = [];
  for (let index = fromFlowPath.length; index > common; index -= 1) {
    const flowPath = fromFlowPath.slice(0, index);
    events.push(event({
      kind: "exit",
      flowPath,
      at: params.at,
      reason: "node-transition",
      fromNodePath: fromNode.qualifiedPath,
      toNodePath: toNode.qualifiedPath,
      fromFlowPath: qualifiedFlowPath(fromFlowPath),
      toFlowPath: qualifiedFlowPath(toFlowPath),
    }));
  }

  events.push(event({
    kind: "transit",
    flowPath: fromFlowPath.slice(0, common),
    at: params.at,
    reason: "node-transition",
    fromNodePath: fromNode.qualifiedPath,
    toNodePath: toNode.qualifiedPath,
    fromFlowPath: qualifiedFlowPath(fromFlowPath),
    toFlowPath: qualifiedFlowPath(toFlowPath),
  }));

  for (let index = common + 1; index <= toFlowPath.length; index += 1) {
    const flowPath = toFlowPath.slice(0, index);
    events.push(event({
      kind: "enter",
      flowPath,
      at: params.at,
      reason: "node-transition",
      fromNodePath: fromNode.qualifiedPath,
      toNodePath: toNode.qualifiedPath,
      fromFlowPath: qualifiedFlowPath(fromFlowPath),
      toFlowPath: qualifiedFlowPath(toFlowPath),
    }));
  }

  return events;
}

export function createFlowExitEventsForNode(params: {
  resolved: ResolvedFlowGraph;
  nodePath: string;
  at: string;
  reason: Extract<FlowRuntimeEventReason, "run-end">;
}): FlowRuntimeEvent[] {
  const node = resolveFlowNodePath(params.resolved, params.nodePath);
  const events: FlowRuntimeEvent[] = [];
  for (let index = node.flowPath.length; index >= 1; index -= 1) {
    const flowPath = node.flowPath.slice(0, index);
    events.push(event({
      kind: "exit",
      flowPath,
      at: params.at,
      reason: params.reason,
      fromNodePath: node.qualifiedPath,
      fromFlowPath: qualifiedFlowPath(node.flowPath),
    }));
  }
  return events;
}

export function formatFlowRuntimeEvent(event: FlowRuntimeEvent): string {
  switch (event.kind) {
    case "enter":
      return formatCoreRuntimeLine("flow", `enter ${event.qualifiedFlowPath} reason=${event.reason}`);
    case "exit":
      return formatCoreRuntimeLine("flow", `exit ${event.qualifiedFlowPath} reason=${event.reason}`);
    case "transit":
      return formatCoreRuntimeLine("flow", `transit ${event.fromFlowPath ?? ""} -> ${event.toFlowPath ?? ""}`);
  }
}

export function createFlowRuntimeEventSidecar(events: FlowRuntimeEvent[]): FlowRuntimeEventSidecar {
  return { schemaVersion: 1, events };
}
