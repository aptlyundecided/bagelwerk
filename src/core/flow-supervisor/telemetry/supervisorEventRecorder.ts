import type { FlowRunnerEvent, FlowRunnerEventSink, FlowRunnerMiddleware } from "../../flow-runner";
import type { FlowSupervisorLedgerEntry, FlowSupervisorRecordedEvents } from "../types";

export type FlowSupervisorEventRecorder<TInput = unknown> = {
  onEvent: FlowRunnerEventSink;
  middleware: FlowRunnerMiddleware<TInput>;
  recordSupervisorMessage: (message: string, data?: unknown) => void;
  snapshot: () => FlowSupervisorRecordedEvents;
};

export function createFlowSupervisorEventRecorder<TInput = unknown>(args: {
  onEvent?: FlowRunnerEventSink;
  now?: () => Date;
} = {}): FlowSupervisorEventRecorder<TInput> {
  const now = args.now ?? (() => new Date());
  const events: FlowRunnerEvent[] = [];
  const ledger: FlowSupervisorLedgerEntry[] = [];

  function append(entry: Omit<FlowSupervisorLedgerEntry, "at">): void {
    ledger.push({ at: now().toISOString(), ...entry });
  }

  const onEvent: FlowRunnerEventSink = (event) => {
    events.push(event);
    append({ type: "flow-runner-event", message: event.type, event });
    args.onEvent?.(event);
  };

  const middleware: FlowRunnerMiddleware<TInput> = {
    name: "flow-supervisor-event-recorder",
    beforeFlow: (context) => append({ type: "middleware", message: "beforeFlow", data: middlewareFlowData(context) }),
    afterFlow: (context) => append({ type: "middleware", message: "afterFlow", data: { ...middlewareFlowData(context), status: context.runTree.status } }),
    beforeNode: (context) => append({ type: "middleware", message: "beforeNode", data: middlewareNodeData(context) }),
    afterNode: (context) => append({
      type: "middleware",
      message: "afterNode",
      data: { ...middlewareNodeData(context), status: context.result?.status, accepted: context.accepted },
    }),
    onNodeCrash: (context) => append({
      type: "middleware",
      message: "onNodeCrash",
      data: { ...middlewareNodeData(context), error: context.error instanceof Error ? context.error.message : String(context.error) },
    }),
    beforeTransition: (context) => append({ type: "middleware", message: "beforeTransition", data: middlewareTransitionData(context) }),
    afterTransition: (context) => append({ type: "middleware", message: "afterTransition", data: middlewareTransitionData(context) }),
  };

  return {
    onEvent,
    middleware,
    recordSupervisorMessage: (message, data) => append({ type: "supervisor", message, ...(data === undefined ? {} : { data }) }),
    snapshot: () => ({ events: [...events], ledger: [...ledger] }),
  };
}

function middlewareFlowData(context: { flowId: string; sessionId: string; mode: string; record: { runDir: string } }) {
  return { flowId: context.flowId, sessionId: context.sessionId, mode: context.mode, runDir: context.record.runDir };
}

function middlewareNodeData(context: { flowId: string; sessionId: string; qualifiedNodePath: string; nodeId: string; record: { runDir: string } }) {
  return {
    flowId: context.flowId,
    sessionId: context.sessionId,
    qualifiedNodePath: context.qualifiedNodePath,
    nodeId: context.nodeId,
    runDir: context.record.runDir,
  };
}

function middlewareTransitionData(context: { flowId: string; sessionId: string; fromQualifiedNodePath: string; toQualifiedNodePath?: string; status: string }) {
  return {
    flowId: context.flowId,
    sessionId: context.sessionId,
    fromQualifiedNodePath: context.fromQualifiedNodePath,
    ...(context.toQualifiedNodePath ? { toQualifiedNodePath: context.toQualifiedNodePath } : {}),
    status: context.status,
  };
}
