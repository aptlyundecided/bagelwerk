import { isPathPrefix, joinPath, requireBoundary, resolveRefKind } from "../refs/pathRefs";
import type { FlowBoundary, ResolveState } from "../state/resolveState";

export function resolveRefAsTarget(params: {
  ref: string;
  boundary: FlowBoundary;
  state: ResolveState;
}): string {
  const resolved = resolveRefKind(params);
  if (resolved.kind === "node") return resolved.qualifiedPath;

  const flow = requireBoundary(params.state, resolved.qualifiedPath);
  computeFlowBoundaryExits(params.state, flow.qualifiedPath);
  if (!flow.initialNodePath) {
    throw new Error(`Configured flow boundary has no resolved initial node: ${flow.qualifiedPath}`);
  }
  return flow.initialNodePath;
}

export function resolveRefAsSources(params: {
  ref: string;
  boundary: FlowBoundary;
  state: ResolveState;
}): string[] {
  const resolved = resolveRefKind(params);
  if (resolved.kind === "node") return [resolved.qualifiedPath];

  const flow = requireBoundary(params.state, resolved.qualifiedPath);
  computeFlowBoundaryExits(params.state, flow.qualifiedPath);
  return [...flow.exitNodePaths];
}

export function computeFlowBoundaryExits(state: ResolveState, boundaryPath: string): void {
  const boundary = requireBoundary(state, boundaryPath);
  if (boundary.exitsComputed) return;

  for (const childPath of boundary.childFlowPaths) computeFlowBoundaryExits(state, childPath);

  boundary.initialNodePath = resolveRefAsTarget({ ref: boundary.initialRef, boundary, state });
  const childNodePaths = boundary.childFlowPaths.flatMap((childPath) => requireBoundary(state, childPath).nodePaths);
  boundary.nodePaths = [...boundary.immediateNodePaths, ...childNodePaths];

  const internalOutgoing = new Set<string>();
  for (const edge of state.rawEdges) {
    if (!isPathPrefix(boundary.flowPath, edge.ownerFlowPath)) continue;
    const ownerBoundary = requireBoundary(state, joinPath(edge.ownerFlowPath));
    for (const source of resolveRefAsSources({ ref: edge.from, boundary: ownerBoundary, state })) {
      if (boundary.nodePaths.includes(source)) internalOutgoing.add(source);
    }
  }

  boundary.exitNodePaths = boundary.nodePaths.filter((nodePath) => !internalOutgoing.has(nodePath));
  boundary.exitsComputed = true;
}
