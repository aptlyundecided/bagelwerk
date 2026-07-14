import type { FlowRunnerExecutionPlan, FlowRunnerResolvedFlow } from "../../../core/flow-runner";

export type FlowProgressGraphInit = {
  nodes: FlowProgressNodeInit[];
  lanes: FlowProgressLaneInit[];
};

export type FlowProgressNodeInit = {
  qualifiedNodePath: string;
  nodeId: string;
  label: string;
  flowPath: string;
  group?: "prefix" | "lane" | "join" | "flow";
  laneId?: string;
};

export type FlowProgressLaneInit = {
  laneId: string;
  flowPath: string;
  nodePaths: string[];
};

export function describeFlowProgressGraph<TInput>(args: {
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  executionPlan?: FlowRunnerExecutionPlan;
}): FlowProgressGraphInit {
  const resolved = args.resolvedFlow.resolved;
  const plan = args.executionPlan;
  const nodes: FlowProgressNodeInit[] = [];
  const lanes: FlowProgressLaneInit[] = [];
  const addNode = (qualifiedNodePath: string, options: { group?: FlowProgressNodeInit["group"]; laneId?: string } = {}) => {
    const target = resolved.nodesByPath[qualifiedNodePath];
    if (!target || nodes.some((node) => node.qualifiedNodePath === qualifiedNodePath)) return;
    nodes.push({
      qualifiedNodePath,
      nodeId: target.node.nodeId,
      label: target.node.name,
      flowPath: target.flowPath.join("."),
      ...(options.group ? { group: options.group } : {}),
      ...(options.laneId ? { laneId: options.laneId } : {}),
    });
  };

  if (!plan || plan.kind === undefined || plan.kind === "whole-flow") {
    for (const nodePath of orderedNodePathsForFlow(args.resolvedFlow, resolved.rootFlowId)) addNode(nodePath, { group: "flow" });
    return { nodes, lanes };
  }

  if (plan.kind === "prefix") {
    for (const nodePath of prefixNodePaths(args.resolvedFlow, plan.stopAfter)) addNode(nodePath, { group: "prefix" });
    return { nodes, lanes };
  }

  if (plan.kind !== "lanes") return { nodes, lanes };

  if (plan.prefix && plan.prefix.run !== false) {
    for (const nodePath of prefixNodePaths(args.resolvedFlow, plan.prefix.stopAfter)) addNode(nodePath, { group: "prefix" });
  }

  for (const lane of plan.lanes) {
    const nodePaths = orderedNodePathsForFlow(args.resolvedFlow, lane.flowPath);
    lanes.push({ laneId: lane.id, flowPath: lane.flowPath, nodePaths });
    for (const nodePath of nodePaths) addNode(nodePath, { group: "lane", laneId: lane.id });
  }

  if (plan.join) addNode(plan.join, { group: "join" });

  return { nodes, lanes };
}

function orderedNodePathsForFlow<TInput>(resolvedFlow: FlowRunnerResolvedFlow<TInput>, flowPath: string): string[] {
  const resolved = resolvedFlow.resolved;
  const boundary = resolved.flowsByPath[flowPath];
  const known = boundary?.nodePaths ?? Object.keys(resolved.nodesByPath).filter((nodePath) => resolved.nodesByPath[nodePath]?.flowPath.join(".") === flowPath);
  if (known.length === 0) return [];
  const knownSet = new Set(known);
  const initial = boundary?.initialNodePath ?? known[0]!;
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (nodePath: string) => {
    if (visited.has(nodePath) || !knownSet.has(nodePath)) return;
    visited.add(nodePath);
    ordered.push(nodePath);
    for (const edge of resolved.edges.filter((candidate) => candidate.fromQualifiedPath === nodePath)) {
      visit(edge.toQualifiedPath);
    }
  };
  visit(initial);
  for (const nodePath of known) visit(nodePath);
  return ordered;
}

function prefixNodePaths<TInput>(resolvedFlow: FlowRunnerResolvedFlow<TInput>, stopAfter: string): string[] {
  const resolved = resolvedFlow.resolved;
  const output: string[] = [];
  let current: string | undefined = resolved.initialNodePath;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    output.push(current);
    if (current === stopAfter) break;
    const next = resolved.edges.find((edge) => edge.fromQualifiedPath === current)?.toQualifiedPath;
    current = next;
  }
  if (!output.includes(stopAfter) && resolved.nodesByPath[stopAfter]) output.push(stopAfter);
  return output;
}
