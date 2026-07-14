import type { FlowRunnerRunTreeNode } from "../../runRecords";
import type { FlowRunnerNodeRunResult, FlowRunnerResolvedFlow } from "../api/contracts";

export function nodeTreeRecord<TInput>(run: FlowRunnerNodeRunResult<TInput>): FlowRunnerRunTreeNode {
  const output = run.runResult.working.outputsByNodeId[run.launchSnapshot.nodeId];
  return {
    qualifiedNodePath: run.launchSnapshot.qualifiedNodePath,
    nodeId: run.launchSnapshot.nodeId,
    status: output?.status ?? "unknown",
    ...(output?.note ? { note: output.note } : {}),
    runDir: run.record.runDir,
    latestDir: run.record.latestDir,
    acceptedDir: run.record.acceptedDir,
    accepted: run.accepted,
    ...(run.skipped ? { skipped: true, skipReason: "resume-accepted" } : {}),
  };
}

export function nextResolvedNodePath<TInput>(args: {
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  fromQualifiedPath: string;
  status: string;
  allowedNodePaths?: Set<string>;
}): string | undefined {
  const matches = args.resolvedFlow.resolved.edges.filter(
    (edge) => edge.fromQualifiedPath === args.fromQualifiedPath && edge.on === args.status && (!args.allowedNodePaths || args.allowedNodePaths.has(edge.toQualifiedPath)),
  );
  if (matches.length > 1) throw new Error(`Flow Runner found multiple next nodes from '${args.fromQualifiedPath}' for status '${args.status}'.`);
  return matches[0]?.toQualifiedPath;
}
