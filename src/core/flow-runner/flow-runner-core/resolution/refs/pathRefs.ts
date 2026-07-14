import type { FlowBoundary, ResolveState } from "../state/resolveState";

export function joinPath(parts: string[]): string {
  return parts.join(".");
}

export function isPathPrefix(prefix: string[], candidate: string[]): boolean {
  return prefix.length <= candidate.length && prefix.every((part, index) => candidate[index] === part);
}

export function refToQualifiedPath(ref: string, boundary: FlowBoundary): string {
  if (ref.includes(".")) return ref;
  if (boundary.localNodeKeys.has(ref) || boundary.localFlowKeys.has(ref)) {
    return joinPath([...boundary.flowPath, ref]);
  }
  throw new Error(`Unable to qualify flow ref '${ref}' under '${boundary.qualifiedPath}'.`);
}

export function requireBoundary(state: ResolveState, qualifiedPath: string): FlowBoundary {
  const boundary = state.flowsByPath[qualifiedPath];
  if (!boundary) throw new Error(`Unknown flow boundary path: ${qualifiedPath}`);
  return boundary;
}

export function resolveRefKind(params: {
  ref: string;
  boundary: FlowBoundary;
  state: ResolveState;
}): { kind: "node" | "flow"; qualifiedPath: string } {
  const qualifiedPath = refToQualifiedPath(params.ref, params.boundary);
  if (params.state.nodesByPath[qualifiedPath]) return { kind: "node", qualifiedPath };
  if (params.state.flowsByPath[qualifiedPath]) return { kind: "flow", qualifiedPath };
  throw new Error(`Configured flow ref does not resolve to a node or child flow boundary: ${qualifiedPath}`);
}
