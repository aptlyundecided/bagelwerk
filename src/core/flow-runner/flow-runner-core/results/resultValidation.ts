import type { NodeGraphRunResult, NodeResult } from "../../../nodes/graph";
import type { FlowRunnerRunTreeNode } from "../../runRecords";
import type { FlowRunnerNodeExecutionInput } from "../../runtimeContext";

export function isFlowRunnerNodeStatus(value: unknown): value is Exclude<FlowRunnerRunTreeNode["status"], "unknown"> {
  return value === "completed" || value === "failed" || value === "timed_out";
}

export function isFlowRunnerNodeResult(value: unknown): value is NodeResult<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isFlowRunnerNodeStatus(record.status) && (record.note === undefined || typeof record.note === "string");
}

export function createSyntheticRunResult<TInput>(args: {
  input: FlowRunnerNodeExecutionInput<TInput>;
  nodeId: string;
  nodeResult: NodeResult<unknown>;
  launchedAt: string;
}): NodeGraphRunResult<FlowRunnerNodeExecutionInput<TInput>> {
  return {
    finalNodeId: args.nodeId,
    working: {
      input: args.input,
      outputsByNodeId: { [args.nodeId]: args.nodeResult },
      attemptsByNodeId: { [args.nodeId]: 1 },
      lastNodeId: args.nodeId,
    },
    history: [{
      nodeId: args.nodeId,
      nodeStatus: args.nodeResult.status,
      attemptCount: 1,
      ...(args.nodeResult.note ? { note: args.nodeResult.note } : {}),
      startedAt: args.launchedAt,
      finishedAt: new Date().toISOString(),
    }],
  };
}
