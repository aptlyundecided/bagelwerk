import {
  createStaticFlowNodeLibrary,
  type ExecutionPolicyRunOverlay,
} from "../../../flows/config";
import type { FlowRunnerBinding, FlowRunnerResolvedFlow } from "../api/contracts";
import { resolveFlowRunnerGraph } from "./resolveFlowRunnerGraph";

export function resolveFlowRunnerBinding<TInput>(params: FlowRunnerBinding & {
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
}): FlowRunnerResolvedFlow<TInput> {
  return {
    resolved: resolveFlowRunnerGraph({
      flow: params.flow,
      nodeLibrary: createStaticFlowNodeLibrary(params.configuredNodes),
      options: { ...(params.executionPolicyOverlay ? { executionPolicyOverlay: params.executionPolicyOverlay } : {}) },
    }),
  };
}
