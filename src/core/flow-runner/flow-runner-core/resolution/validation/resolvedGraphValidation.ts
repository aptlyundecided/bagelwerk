import type { ResolvedFlowBoundary, ResolvedFlowGraph } from "../../../../flows/config";
import type { ResolveState } from "../state/resolveState";

export function validateAndAttachResolvedEdges(state: ResolveState): void {
  for (const edge of state.edges) {
    if (!state.nodesByPath[edge.fromQualifiedPath]) {
      throw new Error(`Configured flow edge source does not resolve to a node path: ${edge.fromQualifiedPath}`);
    }
    if (!state.nodesByPath[edge.toQualifiedPath]) {
      throw new Error(`Configured flow edge target does not resolve to a node path: ${edge.toQualifiedPath}`);
    }
    state.nodesByPath[edge.fromQualifiedPath]!.outgoing.push(edge);
  }
}

export function requireResolvedInitialNode(state: ResolveState, initialNodePath: string | undefined, fallbackRef: string): string {
  if (!initialNodePath || !state.nodesByPath[initialNodePath]) {
    throw new Error(`Configured flow initial does not resolve to a node path: ${initialNodePath ?? fallbackRef}`);
  }
  return initialNodePath;
}

export function buildResolvedFlowBoundaries(state: ResolveState): Record<string, ResolvedFlowBoundary> {
  return Object.fromEntries(
    Object.entries(state.flowsByPath).map(([qualifiedPath, boundary]): [string, ResolvedFlowBoundary] => {
      if (!boundary.initialNodePath) {
        throw new Error(`Configured flow boundary has no resolved initial node: ${qualifiedPath}`);
      }
      return [qualifiedPath, {
        qualifiedPath,
        flowPath: [...boundary.flowPath],
        flowId: boundary.flowId,
        initialNodePath: boundary.initialNodePath,
        nodePaths: [...boundary.nodePaths],
        exitNodePaths: [...boundary.exitNodePaths],
        ...(boundary.executionPolicy ? { executionPolicy: boundary.executionPolicy } : {}),
        ...(boundary.executionPolicySources ? { executionPolicySources: [...boundary.executionPolicySources] } : {}),
      }];
    }),
  );
}

export function buildResolvedFlowGraph(params: {
  rootFlowId: string;
  initialNodePath: string;
  state: ResolveState;
}): ResolvedFlowGraph {
  return {
    rootFlowId: params.rootFlowId,
    rootFlowPath: [params.rootFlowId],
    initialNodePath: params.initialNodePath,
    nodesByPath: params.state.nodesByPath,
    flowsByPath: buildResolvedFlowBoundaries(params.state),
    edges: params.state.edges,
  };
}
