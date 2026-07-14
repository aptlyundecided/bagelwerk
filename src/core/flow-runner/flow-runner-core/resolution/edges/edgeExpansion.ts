import { resolveRefAsSources, resolveRefAsTarget } from "../boundaries/flowBoundaries";
import { joinPath, requireBoundary } from "../refs/pathRefs";
import type { ResolveState } from "../state/resolveState";

export function expandRawEdges(state: ResolveState): void {
  for (const edge of state.rawEdges) {
    const ownerBoundary = requireBoundary(state, joinPath(edge.ownerFlowPath));
    const fromTargets = resolveRefAsSources({ ref: edge.from, boundary: ownerBoundary, state });
    const toQualifiedPath = resolveRefAsTarget({ ref: edge.to, boundary: ownerBoundary, state });
    for (const fromQualifiedPath of fromTargets) {
      state.edges.push({ ...edge, fromQualifiedPath, toQualifiedPath });
    }
  }
}
