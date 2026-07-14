import type { FlowRunnerEvent, FlowRunnerNodeProgress, FlowRunnerRunTree } from "../../flow-runner";
import type { FlowSupervisorNodeMetric, FlowSupervisorRunMetrics } from "../types";

export function buildFlowSupervisorRunMetrics(args: {
  flowId: string;
  sessionId: string;
  events: FlowRunnerEvent[];
  runTree?: FlowRunnerRunTree;
}): FlowSupervisorRunMetrics {
  const nodeMetrics = new Map<string, MutableNodeMetric>();
  let startedAt: string | undefined;
  let finishedAt: string | undefined;
  let artifactObservedCount = 0;
  let missingArtifactObservations = 0;
  let acceptedCount = 0;
  let retrySignals = 0;
  let fallbackResolutionCount = 0;

  for (const event of args.events) {
    if (event.type === "flow-start") startedAt = event.at;
    if (event.type === "flow-complete") finishedAt = event.at;

    if ("qualifiedNodePath" in event && typeof event.qualifiedNodePath === "string") {
      touchNodeEvent(nodeMetrics, event.qualifiedNodePath, event.at, "nodeId" in event ? event.nodeId : undefined);
    }

    switch (event.type) {
      case "node-start": {
        const node = ensureNode(nodeMetrics, event.qualifiedNodePath);
        node.nodeId = event.nodeId;
        node.startedAt = event.at;
        break;
      }
      case "node-progress": {
        const node = ensureNode(nodeMetrics, event.qualifiedNodePath);
        if (event.nodeId) node.nodeId = event.nodeId;
        node.progressEvents += 1;
        const retrySignal = isRetryProgress(event.progress);
        if (retrySignal) {
          node.retrySignals += 1;
          retrySignals += 1;
        }
        break;
      }
      case "node-complete": {
        const node = ensureNode(nodeMetrics, event.qualifiedNodePath);
        node.nodeId = event.nodeId;
        node.status = event.status;
        node.completedAt = event.at;
        break;
      }
      case "node-skipped": {
        const node = ensureNode(nodeMetrics, event.qualifiedNodePath);
        node.nodeId = event.nodeId;
        node.status = "completed";
        break;
      }
      case "artifact-observed":
        artifactObservedCount += 1;
        if (!event.exists) missingArtifactObservations += 1;
        break;
      case "accepted":
        acceptedCount += 1;
        break;
      case "unhandled-failure-resolution-complete":
        fallbackResolutionCount += 1;
        break;
    }
  }

  for (const treeNode of args.runTree?.nodes ?? []) {
    const node = ensureNode(nodeMetrics, treeNode.qualifiedNodePath);
    node.nodeId = treeNode.nodeId;
    node.status = treeNode.status;
    node.skipped = treeNode.skipped === true;
  }

  const nodes = Array.from(nodeMetrics.values()).map(finalizeNodeMetric);
  const longestNode = nodes
    .filter((node): node is FlowSupervisorNodeMetric & { durationMs: number } => node.durationMs !== undefined)
    .sort((a, b) => b.durationMs - a.durationMs)[0];
  const maxSilentMs = maxDefined(nodes.map((node) => node.maxSilentMs));

  return {
    flowId: args.flowId,
    sessionId: args.sessionId,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(startedAt && finishedAt ? { durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) } : {}),
    nodeCount: nodes.length,
    completedNodeCount: nodes.filter((node) => node.status === "completed").length,
    failedNodeCount: nodes.filter((node) => node.status !== undefined && node.status !== "completed").length,
    skippedNodeCount: Array.from(nodeMetrics.values()).filter((node) => node.skipped).length,
    artifactObservedCount,
    missingArtifactObservations,
    acceptedCount,
    retrySignals,
    fallbackResolutionCount,
    ...(maxSilentMs !== undefined ? { maxSilentMs } : {}),
    ...(longestNode ? { longestNode } : {}),
    nodes,
  };
}

type MutableNodeMetric = FlowSupervisorNodeMetric & {
  lastEventAt?: string;
  skipped?: boolean;
};

function ensureNode(nodes: Map<string, MutableNodeMetric>, qualifiedNodePath: string): MutableNodeMetric {
  let node = nodes.get(qualifiedNodePath);
  if (!node) {
    node = { qualifiedNodePath, progressEvents: 0, retrySignals: 0 };
    nodes.set(qualifiedNodePath, node);
  }
  return node;
}

function touchNodeEvent(nodes: Map<string, MutableNodeMetric>, qualifiedNodePath: string, at: string, nodeId: string | undefined): void {
  const node = ensureNode(nodes, qualifiedNodePath);
  if (nodeId) node.nodeId = nodeId;
  if (node.lastEventAt) {
    const gap = Math.max(0, Date.parse(at) - Date.parse(node.lastEventAt));
    node.maxSilentMs = Math.max(node.maxSilentMs ?? 0, gap);
  }
  node.lastEventAt = at;
}

function finalizeNodeMetric(node: MutableNodeMetric): FlowSupervisorNodeMetric {
  const durationMs = node.startedAt && node.completedAt ? Math.max(0, Date.parse(node.completedAt) - Date.parse(node.startedAt)) : undefined;
  return {
    qualifiedNodePath: node.qualifiedNodePath,
    ...(node.nodeId ? { nodeId: node.nodeId } : {}),
    ...(node.status ? { status: node.status } : {}),
    ...(node.startedAt ? { startedAt: node.startedAt } : {}),
    ...(node.completedAt ? { completedAt: node.completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    progressEvents: node.progressEvents,
    ...(node.maxSilentMs !== undefined ? { maxSilentMs: node.maxSilentMs } : {}),
    retrySignals: node.retrySignals,
  };
}

function isRetryProgress(progress: FlowRunnerNodeProgress): boolean {
  return (progress.attempt ?? 1) > 1 || Boolean(progress.retryOfWorkItemId) || /retry/i.test(progress.reason ?? "") || /retry/i.test(progress.message ?? "");
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  if (defined.length === 0) return undefined;
  return Math.max(...defined);
}
