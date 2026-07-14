import type { NodeRunnerSpec } from "../../nodes/graph";
import type { NodeRegistry } from "../../nodes/config";
import { requireNodeTypeEntry } from "../../nodes/config";
import type { ConfiguredNodeSpec } from "../../nodes/config";
import type { ConfiguredFlowEdge, ConfiguredFlowNodeAcceptedArtifactRef, ConfiguredFlowSpec } from "./configuredFlow";
import { parseConfiguredFlowSpec } from "./configuredFlow";
import {
  hasExecutionPolicy,
  mergeExecutionPolicy,
  policyWithoutOverlayPaths,
  type ExecutionPolicy,
  type ExecutionPolicyRunOverlay,
  type ExecutionPolicySource,
} from "./executionPolicy";
import type { FlowNodeLibrary } from "./flowNodeLibrary";
import { requireConfiguredNode } from "./flowNodeLibrary";
import type { CompiledConfiguredFlowSpec, ResolvedFlowBoundary, ResolvedFlowGraph, ResolvedFlowNode, ResolvedFlowNodeTarget } from "./resolvedFlow";

export type CompileConfiguredFlowSpecOptions = {
  timeoutMs?: number;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
};

type FlowBoundary = {
  qualifiedPath: string;
  flowPath: string[];
  flowId: string;
  initialRef: string;
  localNodeKeys: Set<string>;
  localFlowKeys: Set<string>;
  immediateNodePaths: string[];
  childFlowPaths: string[];
  nodePaths: string[];
  exitNodePaths: string[];
  initialNodePath?: string;
  exitsComputed: boolean;
  executionPolicy?: ExecutionPolicy;
  executionPolicySources?: ExecutionPolicySource[];
};

type RawFlowEdge = ConfiguredFlowEdge & {
  ownerFlowPath: string[];
};

type FlattenState = {
  nodesByPath: Record<string, ResolvedFlowNode>;
  rawEdges: RawFlowEdge[];
  edges: Array<ConfiguredFlowEdge & { fromQualifiedPath: string; toQualifiedPath: string }>;
  flowsByPath: Record<string, FlowBoundary>;
};

function joinPath(parts: string[]): string {
  return parts.join(".");
}

function isPathPrefix(prefix: string[], candidate: string[]): boolean {
  return prefix.length <= candidate.length && prefix.every((part, index) => candidate[index] === part);
}

function refToQualifiedPath(ref: string, boundary: FlowBoundary): string {
  if (ref.includes(".")) return ref;
  if (boundary.localNodeKeys.has(ref) || boundary.localFlowKeys.has(ref)) {
    return joinPath([...boundary.flowPath, ref]);
  }
  throw new Error(`Unable to qualify flow ref '${ref}' under '${boundary.qualifiedPath}'.`);
}

function requireBoundary(state: FlattenState, qualifiedPath: string): FlowBoundary {
  const boundary = state.flowsByPath[qualifiedPath];
  if (!boundary) {
    throw new Error(`Unknown flow boundary path: ${qualifiedPath}`);
  }
  return boundary;
}

function resolveRefKind(params: {
  ref: string;
  boundary: FlowBoundary;
  state: FlattenState;
}): { kind: "node" | "flow"; qualifiedPath: string } {
  const qualifiedPath = refToQualifiedPath(params.ref, params.boundary);
  if (params.state.nodesByPath[qualifiedPath]) return { kind: "node", qualifiedPath };
  if (params.state.flowsByPath[qualifiedPath]) return { kind: "flow", qualifiedPath };
  throw new Error(`Configured flow ref does not resolve to a node or child flow boundary: ${qualifiedPath}`);
}

function resolveRefAsTarget(params: {
  ref: string;
  boundary: FlowBoundary;
  state: FlattenState;
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

function resolveRefAsSources(params: {
  ref: string;
  boundary: FlowBoundary;
  state: FlattenState;
}): string[] {
  const resolved = resolveRefKind(params);
  if (resolved.kind === "node") return [resolved.qualifiedPath];

  const flow = requireBoundary(params.state, resolved.qualifiedPath);
  computeFlowBoundaryExits(params.state, flow.qualifiedPath);
  return [...flow.exitNodePaths];
}

function resolveAcceptedArtifactSource(params: {
  artifact: ConfiguredFlowNodeAcceptedArtifactRef;
  boundary: FlowBoundary;
  state: FlattenState;
}): string {
  const from = params.artifact.from;
  if (!from.includes(".")) {
    if (params.boundary.localFlowKeys.has(from)) {
      throw new Error(
        `Configured flow accepted-artifact source '${from}' resolves to flow boundary '${joinPath([...params.boundary.flowPath, from])}'. Artifacts are Node-scoped; use a Transition Node to adapt Flow handoffs.`,
      );
    }
    if (params.boundary.localNodeKeys.has(from)) {
      return joinPath([...params.boundary.flowPath, from]);
    }
    throw new Error(`Unable to qualify accepted-artifact source '${from}' under '${params.boundary.qualifiedPath}'.`);
  }

  if (params.state.flowsByPath[from]) {
    throw new Error(
      `Configured flow accepted-artifact source '${from}' resolves to flow boundary '${from}'. Artifacts are Node-scoped; use a Transition Node to adapt Flow handoffs.`,
    );
  }
  return from;
}

function flattenFlow(params: {
  flow: ConfiguredFlowSpec;
  flowPath: string[];
  state: FlattenState;
  nodeLibrary: FlowNodeLibrary;
  inheritedExecutionPolicy?: ExecutionPolicy;
  inheritedExecutionPolicySources?: ExecutionPolicySource[];
}): void {
  const localNodeKeys = new Set(Object.keys(params.flow.nodes ?? {}));
  const localFlowKeys = new Set(Object.keys(params.flow.flows ?? {}));
  const qualifiedPath = joinPath(params.flowPath);
  const ownExecutionPolicy = params.flow.executionPolicy;
  const executionPolicy = mergeExecutionPolicy(params.inheritedExecutionPolicy, ownExecutionPolicy);
  const executionPolicySources = [
    ...(params.inheritedExecutionPolicySources ?? []),
    ...(hasExecutionPolicy(ownExecutionPolicy) ? [{ kind: "flow" as const, path: qualifiedPath }] : []),
  ];
  const boundary: FlowBoundary = {
    qualifiedPath,
    flowPath: [...params.flowPath],
    flowId: params.flow.flowId,
    initialRef: params.flow.initial,
    localNodeKeys,
    localFlowKeys,
    immediateNodePaths: [],
    childFlowPaths: [],
    nodePaths: [],
    exitNodePaths: [],
    exitsComputed: false,
    ...(executionPolicy ? { executionPolicy } : {}),
    ...(executionPolicySources.length > 0 ? { executionPolicySources } : {}),
  };

  if (params.state.flowsByPath[qualifiedPath]) {
    throw new Error(`Duplicate configured flow boundary path: ${qualifiedPath}`);
  }
  params.state.flowsByPath[qualifiedPath] = boundary;

  for (const [nodeKey, nodeRef] of Object.entries(params.flow.nodes ?? {})) {
    const nodeQualifiedPath = joinPath([...params.flowPath, nodeKey]);
    const configuredNode = requireConfiguredNode(params.nodeLibrary, nodeRef.nodeId);
    const acceptedArtifacts = (nodeRef.acceptedArtifacts ?? []).map((artifact): ConfiguredFlowNodeAcceptedArtifactRef & { fromQualifiedPath: string } => ({
      ...artifact,
      required: artifact.required ?? true,
      fromQualifiedPath: resolveAcceptedArtifactSource({ artifact, boundary, state: params.state }),
    }));
    params.state.nodesByPath[nodeQualifiedPath] = {
      qualifiedPath: nodeQualifiedPath,
      localNodeKey: nodeKey,
      flowPath: [...params.flowPath],
      flowId: params.flow.flowId,
      node: configuredNode,
      acceptedArtifacts,
      outgoing: [],
      ...(executionPolicy ? { executionPolicy } : {}),
      ...(executionPolicySources.length > 0 ? { executionPolicySources: [...executionPolicySources] } : {}),
    };
    boundary.immediateNodePaths.push(nodeQualifiedPath);
  }

  for (const [childKey, childFlow] of Object.entries(params.flow.flows ?? {})) {
    const childFlowPath = [...params.flowPath, childKey];
    boundary.childFlowPaths.push(joinPath(childFlowPath));
    flattenFlow({
      flow: childFlow,
      flowPath: childFlowPath,
      state: params.state,
      nodeLibrary: params.nodeLibrary,
      inheritedExecutionPolicy: executionPolicy,
      inheritedExecutionPolicySources: executionPolicySources,
    });
  }

  for (const edge of params.flow.edges ?? []) {
    params.state.rawEdges.push({ ...edge, ownerFlowPath: [...params.flowPath] });
  }
}

function computeFlowBoundaryExits(state: FlattenState, boundaryPath: string): void {
  const boundary = requireBoundary(state, boundaryPath);
  if (boundary.exitsComputed) return;

  for (const childPath of boundary.childFlowPaths) {
    computeFlowBoundaryExits(state, childPath);
  }

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

function expandRawEdges(state: FlattenState): void {
  for (const edge of state.rawEdges) {
    const ownerBoundary = requireBoundary(state, joinPath(edge.ownerFlowPath));
    const fromTargets = resolveRefAsSources({ ref: edge.from, boundary: ownerBoundary, state });
    const toQualifiedPath = resolveRefAsTarget({ ref: edge.to, boundary: ownerBoundary, state });
    for (const fromQualifiedPath of fromTargets) {
      state.edges.push({ ...edge, fromQualifiedPath, toQualifiedPath });
    }
  }
}

function validateExecutionPolicyOverlayPaths(state: FlattenState, overlay: ExecutionPolicyRunOverlay | undefined): void {
  for (const flowPath of Object.keys(overlay?.paths ?? {})) {
    if (!state.flowsByPath[flowPath]) {
      throw new Error(`Execution policy overlay references unknown Flow path: ${flowPath}`);
    }
  }
}

function overlayPoliciesForFlowPath(overlay: ExecutionPolicyRunOverlay | undefined, flowPath: string[]): Array<{ path: string; policy: ExecutionPolicy }> {
  if (!overlay) return [];
  const policies: Array<{ path: string; policy: ExecutionPolicy }> = [];
  const globalPolicy = policyWithoutOverlayPaths(overlay);
  if (globalPolicy) policies.push({ path: "<global>", policy: globalPolicy });
  for (let index = 1; index <= flowPath.length; index += 1) {
    const qualifiedPath = joinPath(flowPath.slice(0, index));
    const policy = overlay.paths?.[qualifiedPath];
    if (policy && hasExecutionPolicy(policy)) policies.push({ path: qualifiedPath, policy });
  }
  return policies;
}

function applyExecutionPolicyOverlay(state: FlattenState, overlay: ExecutionPolicyRunOverlay | undefined): void {
  validateExecutionPolicyOverlayPaths(state, overlay);
  if (!overlay) return;

  for (const boundary of Object.values(state.flowsByPath)) {
    let executionPolicy = boundary.executionPolicy;
    const executionPolicySources = [...(boundary.executionPolicySources ?? [])];
    for (const item of overlayPoliciesForFlowPath(overlay, boundary.flowPath)) {
      executionPolicy = mergeExecutionPolicy(executionPolicy, item.policy);
      executionPolicySources.push({ kind: "run-overlay", path: item.path });
    }
    if (executionPolicy) boundary.executionPolicy = executionPolicy;
    if (executionPolicySources.length > 0) boundary.executionPolicySources = executionPolicySources;
  }

  for (const node of Object.values(state.nodesByPath)) {
    const boundary = requireBoundary(state, joinPath(node.flowPath));
    if (boundary.executionPolicy) node.executionPolicy = boundary.executionPolicy;
    if (boundary.executionPolicySources) node.executionPolicySources = [...boundary.executionPolicySources];
  }
}

function buildRunnerSpec<TInput>(resolved: ResolvedFlowGraph, registry: NodeRegistry, options: CompileConfiguredFlowSpecOptions): NodeRunnerSpec<TInput> {
  const nodes: NodeRunnerSpec<TInput>["graph"]["nodes"] = {};
  const handlers: NodeRunnerSpec<TInput>["handlers"] = {};

  for (const [qualifiedPath, resolvedNode] of Object.entries(resolved.nodesByPath)) {
    const entry = requireNodeTypeEntry(registry, resolvedNode.node.nodeType);
    const params = entry.validateParams(resolvedNode.node.params);
    nodes[qualifiedPath] = {
      nodeKey: qualifiedPath,
      label: resolvedNode.node.name,
      edges: resolved.edges
        .filter((edge) => edge.fromQualifiedPath === qualifiedPath)
        .map((edge) => ({
          to: edge.toQualifiedPath,
          label: edge.label,
          when: (input) => input.nodeStatus === edge.on,
        })),
    };

    handlers[qualifiedPath] = async ({ working }) =>
      entry.execute({
        nodeId: resolvedNode.node.nodeId,
        instanceId: resolvedNode.node.nodeId,
        params,
        working,
        ...(resolvedNode.executionPolicy ? { executionPolicy: resolvedNode.executionPolicy } : {}),
      });
  }

  for (const [qualifiedPath, node] of Object.entries(nodes)) {
    if ((node.edges?.length ?? 0) === 0) {
      node.edges = [
        { to: "done", when: (input) => input.nodeStatus === "completed" },
        { to: "done", when: (input) => input.nodeStatus === "failed" },
        { to: "done", when: (input) => input.nodeStatus === "timed_out" },
      ];
    }
  }

  nodes.done = { final: true, label: "done" };

  return {
    graph: {
      initial: resolved.initialNodePath,
      nodes,
    },
    handlers,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

export function compileConfiguredFlowSpec<TInput>(params: {
  flow: unknown;
  nodeLibrary: FlowNodeLibrary;
  nodeRegistry: NodeRegistry;
  options?: CompileConfiguredFlowSpecOptions;
}): CompiledConfiguredFlowSpec<TInput> {
  const flow = parseConfiguredFlowSpec(params.flow);
  const state: FlattenState = { nodesByPath: {}, rawEdges: [], edges: [], flowsByPath: {} };
  flattenFlow({
    flow,
    flowPath: [flow.flowId],
    state,
    nodeLibrary: params.nodeLibrary,
  });

  const rootBoundary = requireBoundary(state, flow.flowId);
  computeFlowBoundaryExits(state, rootBoundary.qualifiedPath);
  expandRawEdges(state);
  applyExecutionPolicyOverlay(state, params.options?.executionPolicyOverlay);

  for (const edge of state.edges) {
    if (!state.nodesByPath[edge.fromQualifiedPath]) {
      throw new Error(`Configured flow edge source does not resolve to a node path: ${edge.fromQualifiedPath}`);
    }
    if (!state.nodesByPath[edge.toQualifiedPath]) {
      throw new Error(`Configured flow edge target does not resolve to a node path: ${edge.toQualifiedPath}`);
    }
    state.nodesByPath[edge.fromQualifiedPath]!.outgoing.push(edge);
  }

  const initialNodePath = rootBoundary.initialNodePath;
  if (!initialNodePath || !state.nodesByPath[initialNodePath]) {
    throw new Error(`Configured flow initial does not resolve to a node path: ${initialNodePath ?? flow.initial}`);
  }

  const flowsByPath = Object.fromEntries(
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

  const resolved: ResolvedFlowGraph = {
    rootFlowId: flow.flowId,
    rootFlowPath: [flow.flowId],
    initialNodePath,
    nodesByPath: state.nodesByPath,
    flowsByPath,
    edges: state.edges,
  };

  return {
    resolved,
    runnerSpec: buildRunnerSpec<TInput>(resolved, params.nodeRegistry, params.options ?? {}),
  };
}

export function resolveFlowNodePath(resolved: ResolvedFlowGraph, qualifiedPath: string): ResolvedFlowNode {
  const node = resolved.nodesByPath[qualifiedPath];
  if (!node) {
    throw new Error(`Unknown qualified flow node path: ${qualifiedPath}`);
  }
  return node;
}

export function listUpstreamAcceptedArtifacts(node: ResolvedFlowNode): Array<ConfiguredFlowNodeAcceptedArtifactRef & { fromQualifiedPath: string }> {
  return [...node.acceptedArtifacts];
}

export function listConfiguredNodes(resolved: ResolvedFlowGraph): ConfiguredNodeSpec[] {
  return Object.values(resolved.nodesByPath).map((entry) => entry.node);
}

export function listResolvedFlowNodeTargets(resolved: ResolvedFlowGraph): ResolvedFlowNodeTarget[] {
  return Object.values(resolved.nodesByPath)
    .map((entry) => ({
      qualifiedPath: entry.qualifiedPath,
      flowPath: [...entry.flowPath],
      flowId: entry.flowId,
      localNodeKey: entry.localNodeKey,
      nodeId: entry.node.nodeId,
      nodeName: entry.node.name,
      ...(entry.node.description ? { nodeDescription: entry.node.description } : {}),
    }))
    .sort((left, right) => left.qualifiedPath.localeCompare(right.qualifiedPath));
}

export function resolveFlowNodeTarget(resolved: ResolvedFlowGraph, selector: string): ResolvedFlowNode {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error("Flow node selector is required.");
  }

  const exact = resolved.nodesByPath[trimmed];
  if (exact) return exact;

  const candidates = Object.values(resolved.nodesByPath).filter(
    (entry) =>
      entry.node.nodeId === trimmed ||
      entry.localNodeKey === trimmed ||
      entry.node.name === trimmed,
  );

  if (candidates.length === 1) return candidates[0]!;

  const available = listResolvedFlowNodeTargets(resolved)
    .map((target) => `${target.qualifiedPath} (${target.nodeId})`)
    .join(", ");
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous flow node selector '${selector}' matched ${candidates.length} nodes: ${candidates.map((entry) => entry.qualifiedPath).join(", ")}. Use a qualified Node path.`,
    );
  }
  throw new Error(`Unknown flow node selector '${selector}'. Available resolved Node paths: ${available}`);
}
