import type {
  ConfiguredFlowNodeAcceptedArtifactRef,
  ConfiguredFlowSpec,
  ExecutionPolicy,
  ExecutionPolicySource,
  FlowNodeLibrary,
} from "../../../../flows/config";
import { hasExecutionPolicy, mergeExecutionPolicy, requireConfiguredNode } from "../../../../flows/config";
import { resolveAcceptedArtifactSource } from "../accepted-artifacts/acceptedArtifactRefs";
import { joinPath } from "../refs/pathRefs";
import type { FlowBoundary, ResolveState } from "../state/resolveState";

export function flattenFlow(params: {
  flow: ConfiguredFlowSpec;
  flowPath: string[];
  state: ResolveState;
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
