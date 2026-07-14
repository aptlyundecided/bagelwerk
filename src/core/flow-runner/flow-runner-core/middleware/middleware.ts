import type { NodeResult } from "../../../nodes/graph";
import type { FlowRunnerEventSink } from "../../events";
import type { FlowRunnerArtifactEvent, FlowRunnerFlowRunRecord, FlowRunnerLaunchSnapshot, FlowRunnerNodeRunRecord, FlowRunnerRunTree } from "../../runRecords";
import type { FlowRunnerRuntimeContext } from "../../runtimeContext";
import type { FlowRunnerExecutionPlan } from "../api/contracts";

export type FlowRunnerMiddlewareHookResult = void | Promise<void>;

export type FlowRunnerFlowMiddlewareContext<TInput> = {
  flowId: string;
  sessionId: string;
  mode: "whole-flow" | "prefix" | "lanes";
  input: TInput;
  record: FlowRunnerFlowRunRecord;
  executionPlan: FlowRunnerExecutionPlan;
  emitEvent?: FlowRunnerEventSink;
};

export type FlowRunnerFlowCompleteMiddlewareContext<TInput> = FlowRunnerFlowMiddlewareContext<TInput> & {
  runTree: FlowRunnerRunTree;
};

export type FlowRunnerNodeMiddlewareContext<TInput> = {
  flowId: string;
  sessionId: string;
  qualifiedNodePath: string;
  nodeId: string;
  nodeName: string;
  input: TInput;
  record: FlowRunnerNodeRunRecord;
  launchSnapshot: FlowRunnerLaunchSnapshot;
  runtime: FlowRunnerRuntimeContext;
  emitEvent?: FlowRunnerEventSink;
};

export type FlowRunnerNodeCompleteMiddlewareContext<TInput> = FlowRunnerNodeMiddlewareContext<TInput> & {
  result: NodeResult<unknown> | undefined;
  artifactEvents: FlowRunnerArtifactEvent[];
  accepted: boolean;
};

export type FlowRunnerNodeCrashMiddlewareContext<TInput> = FlowRunnerNodeMiddlewareContext<TInput> & {
  error: unknown;
};

export type FlowRunnerTransitionMiddlewareContext<TInput> = {
  flowId: string;
  sessionId: string;
  fromQualifiedNodePath: string;
  status: string;
  toQualifiedNodePath?: string;
  input: TInput;
};

export type FlowRunnerMiddleware<TInput = unknown> = {
  name: string;
  beforeFlow?: (context: FlowRunnerFlowMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
  afterFlow?: (context: FlowRunnerFlowCompleteMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
  beforeNode?: (context: FlowRunnerNodeMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
  afterNode?: (context: FlowRunnerNodeCompleteMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
  onNodeCrash?: (context: FlowRunnerNodeCrashMiddlewareContext<TInput>) => NodeResult<unknown> | void | Promise<NodeResult<unknown> | void>;
  beforeTransition?: (context: FlowRunnerTransitionMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
  afterTransition?: (context: FlowRunnerTransitionMiddlewareContext<TInput>) => FlowRunnerMiddlewareHookResult;
};

export async function runFlowRunnerMiddlewareHook<TInput>(
  middlewares: FlowRunnerMiddleware<TInput>[] | undefined,
  hook: keyof FlowRunnerMiddleware<TInput>,
  context: unknown,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const middleware of middlewares ?? []) {
    const fn = middleware[hook];
    if (typeof fn === "function") {
      results.push(await (fn as (ctx: unknown) => unknown)(context));
    }
  }
  return results;
}
