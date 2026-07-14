import type {
  ExecutionPolicyRunOverlay,
  FlowNodeLibrary,
  ResolvedFlowGraph,
} from "../../../../flows/config";
import { parseConfiguredFlowSpec } from "../../../../flows/config";
import { computeFlowBoundaryExits } from "../boundaries/flowBoundaries";
import { expandRawEdges } from "../edges/edgeExpansion";
import { flattenFlow } from "../flatten/flattenFlow";
import { applyExecutionPolicyOverlay } from "../policies/executionPolicyOverlay";
import { requireBoundary } from "../refs/pathRefs";
import { createResolveState } from "../state/resolveState";
import { buildResolvedFlowGraph, requireResolvedInitialNode, validateAndAttachResolvedEdges } from "../validation/resolvedGraphValidation";

export type ResolveFlowRunnerGraphOptions = {
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
};

export function resolveFlowRunnerGraph(params: {
  flow: unknown;
  nodeLibrary: FlowNodeLibrary;
  options?: ResolveFlowRunnerGraphOptions;
}): ResolvedFlowGraph {
  const flow = parseConfiguredFlowSpec(params.flow);
  const state = createResolveState();

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
  validateAndAttachResolvedEdges(state);

  const initialNodePath = requireResolvedInitialNode(state, rootBoundary.initialNodePath, flow.initial);
  return buildResolvedFlowGraph({ rootFlowId: flow.flowId, initialNodePath, state });
}
