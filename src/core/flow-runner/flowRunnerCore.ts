import { resolveFlowRunnerBinding } from "./flow-runner-core/resolution/resolveFlowRunnerBinding";
import type { RunFlowRunnerParams } from "./flow-runner-core/api/contracts";
import { runResolvedFlowRunnerFlow } from "./flow-runner-core/plans/executionPlans";
import { resolveExecutionPolicyOverlay } from "./flow-runner-core/policy/executionPolicy";
import { runFlowRunnerNode } from "./flow-runner-core/node-run/nodeRun";

export type {
  FlowRunnerAcceptancePolicy,
  FlowRunnerBinding,
  FlowRunnerExecutionPlan,
  FlowRunnerFlowRunResult,
  FlowRunnerIterationPolicy,
  FlowRunnerNodeRunResult,
  FlowRunnerResolvedFlow,
  FlowRunnerResumePolicy,
  FlowRunnerUnhandledFailureResolution,
  FlowRunnerUnhandledFailureResolver,
  RunResolvedFlowRunnerParams,
  RunFlowRunnerNodeParams,
  RunFlowRunnerParams,
} from "./flow-runner-core/api/contracts";
export { runResolvedFlowRunnerFlow } from "./flow-runner-core/plans/executionPlans";
export {
  compileFlowRunnerExecutionPlanRecipe,
  defaultFlowRunnerLaneId,
  describeFlowRunnerRunProfilePlan,
  resolveFlowRunnerRunProfile,
  type FlowRunnerExecutionPlanRecipe,
  type FlowRunnerOutputSummaryDeclaration,
  type FlowRunnerRunProfile,
  type FlowRunnerRunProfilePlanDescription,
} from "./flow-runner-core/profiles/runProfiles";
export { resolveFlowRunnerBinding } from "./flow-runner-core/resolution/resolveFlowRunnerBinding";
export { runFlowRunnerNode } from "./flow-runner-core/node-run/nodeRun";
export { createFlowRunnerConsoleProgressMiddleware, type FlowRunnerProgressMiddlewareOptions } from "./flow-runner-core/middleware/progressMiddleware";
export {
  type FlowRunnerFlowCompleteMiddlewareContext,
  type FlowRunnerFlowMiddlewareContext,
  type FlowRunnerMiddleware,
  type FlowRunnerNodeCompleteMiddlewareContext,
  type FlowRunnerNodeCrashMiddlewareContext,
  type FlowRunnerNodeMiddlewareContext,
  type FlowRunnerTransitionMiddlewareContext,
} from "./flow-runner-core/middleware/middleware";

export async function runFlowRunnerFlow<TInput>(params: RunFlowRunnerParams<TInput>) {
  const executionPolicyOverlay = resolveExecutionPolicyOverlay(params);
  const resolvedFlow = resolveFlowRunnerBinding<TInput>({ ...params, ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}) });
  return runResolvedFlowRunnerFlow({
    resolvedFlow,
    nodeRegistry: params.nodeRegistry,
    input: params.input,
    sessionId: params.sessionId,
    ...(params.artifactRoot ? { artifactRoot: params.artifactRoot } : {}),
    ...(params.executionPlan ? { executionPlan: params.executionPlan } : {}),
    ...(params.acceptance ? { acceptance: params.acceptance } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.iteration ? { iteration: params.iteration } : {}),
    ...(params.unhandledFailureResolver ? { unhandledFailureResolver: params.unhandledFailureResolver } : {}),
    ...(params.log ? { log: params.log } : {}),
    ...(params.onEvent ? { onEvent: params.onEvent } : {}),
    ...(params.middlewares ? { middlewares: params.middlewares } : {}),
  });
}
