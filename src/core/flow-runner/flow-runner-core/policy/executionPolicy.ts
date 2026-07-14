import { parseExecutionPolicyRunOverlay, type ExecutionPolicyRunOverlay } from "../../../flows/config";
import type { RunFlowRunnerParams } from "../api/contracts";

export function executionPolicyOverlayFromInput<TInput>(input: TInput): ExecutionPolicyRunOverlay | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return parseExecutionPolicyRunOverlay((input as { executionPolicy?: unknown }).executionPolicy);
}

export function resolveExecutionPolicyOverlay<TInput>(params: Pick<RunFlowRunnerParams<TInput>, "input" | "executionPolicyOverlay">): ExecutionPolicyRunOverlay | undefined {
  return params.executionPolicyOverlay ?? executionPolicyOverlayFromInput(params.input);
}
