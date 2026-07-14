import {
  acceptFlowRunnerNodeRun,
  copyFlowRunnerArtifactToSurface,
  flowRunnerFileExists,
  persistFlowRunnerNodeSidecars,
  type FlowRunnerArtifactEvent,
  type FlowRunnerRunTreeNode,
} from "../../runRecords";
import { emitFlowRunnerEvent } from "../events/eventSink";
import { artifactExistenceFromExpected } from "../node-run/nodeRun";
import { isFlowRunnerNodeResult } from "../results/resultValidation";
import { nextResolvedNodePath } from "../traversal/runTree";
import type { FlowRunnerNodeRunResult, RunResolvedFlowRunnerParams } from "../api/contracts";

export async function resolveUnhandledFailureIfNeeded<TInput>(args: {
  params: RunResolvedFlowRunnerParams<TInput>;
  artifactRoot: string;
  current: string;
  treeNode: FlowRunnerRunTreeNode;
  nodeRun: FlowRunnerNodeRunResult<TInput> | undefined;
  allowedNodePaths?: Set<string>;
  events: import("../../events").FlowRunnerEvent[];
  forwardEvent: (event: import("../../events").FlowRunnerEvent) => void;
}): Promise<string | undefined> {
  let next = nextResolvedNodePath({
    resolvedFlow: args.params.resolvedFlow,
    fromQualifiedPath: args.current,
    status: args.treeNode.status,
    allowedNodePaths: args.allowedNodePaths,
  });

  if (next || args.treeNode.status === "completed" || !args.params.unhandledFailureResolver || !args.nodeRun) return next;

  args.forwardEvent({
    type: "unhandled-failure-resolution-start",
    flowId: args.params.resolvedFlow.resolved.rootFlowId,
    sessionId: args.params.sessionId,
    qualifiedNodePath: args.current,
    nodeId: args.treeNode.nodeId,
    status: args.treeNode.status,
    at: new Date().toISOString(),
  });

  const nodeRun = args.nodeRun;
  const resolution = await args.params.unhandledFailureResolver({ run: nodeRun, treeNode: args.treeNode });
  if (resolution?.replacementResult) {
    if (!isFlowRunnerNodeResult(resolution.replacementResult)) throw new Error(`Unhandled failure resolver returned malformed replacement NodeResult for '${args.current}'.`);
    for (const artifact of resolution.repairedArtifacts ?? []) {
      await observeRepairedArtifact({ ...args, nodeRun, artifact });
    }
    nodeRun.artifactExistence = artifactExistenceFromExpected(nodeRun.launchSnapshot.expectedArtifacts, nodeRun.artifactEvents);
    nodeRun.runResult.working.outputsByNodeId[args.treeNode.nodeId] = resolution.replacementResult;
    args.treeNode.status = resolution.replacementResult.status;
    if (resolution.replacementResult.note) args.treeNode.note = resolution.replacementResult.note;
    if ((args.params.acceptance?.mode ?? "auto") === "auto" && resolution.replacementResult.status === "completed" && !nodeRun.accepted) {
      await acceptFlowRunnerNodeRun({
        artifactRoot: args.artifactRoot,
        sessionId: args.params.sessionId,
        record: nodeRun.record,
        nodeId: args.treeNode.nodeId,
        emittedArtifacts: nodeRun.artifactEvents.filter((artifact) => artifact.exists).map((artifact) => ({ canonicalPath: artifact.canonicalPath, relativePath: artifact.relativePath })),
        acceptance: {
          acceptedAt: new Date().toISOString(),
          acceptedByKind: args.params.acceptance?.acceptedByKind ?? "agent",
          acceptedById: args.params.acceptance?.acceptedById ?? "flow-runner",
          note: resolution.note ?? "Accepted by Flow Runner unhandled failure resolver.",
          runDir: nodeRun.record.runDir,
        },
      });
      nodeRun.accepted = true;
      args.treeNode.accepted = true;
    }
    await persistFlowRunnerNodeSidecars({ record: nodeRun.record, launchSnapshot: nodeRun.launchSnapshot, artifactEvents: nodeRun.artifactEvents, artifactExistence: nodeRun.artifactExistence, events: nodeRun.events, result: nodeRun.runResult });
    next = nextResolvedNodePath({
      resolvedFlow: args.params.resolvedFlow,
      fromQualifiedPath: args.current,
      status: args.treeNode.status,
      allowedNodePaths: args.allowedNodePaths,
    });
  }

  args.forwardEvent({
    type: "unhandled-failure-resolution-complete",
    flowId: args.params.resolvedFlow.resolved.rootFlowId,
    sessionId: args.params.sessionId,
    qualifiedNodePath: args.current,
    nodeId: args.treeNode.nodeId,
    disposition: resolution?.disposition ?? "ignored",
    status: args.treeNode.status,
    ...(resolution?.note ? { note: resolution.note } : {}),
    at: new Date().toISOString(),
  });
  return next;
}

async function observeRepairedArtifact<TInput>(args: {
  params: RunResolvedFlowRunnerParams<TInput>;
  current: string;
  treeNode: FlowRunnerRunTreeNode;
  nodeRun: FlowRunnerNodeRunResult<TInput>;
  artifact: { canonicalPath: string; relativePath: string; key?: string; label: string };
  forwardEvent: (event: import("../../events").FlowRunnerEvent) => void;
}): Promise<void> {
  const exists = await flowRunnerFileExists(args.artifact.canonicalPath);
  const event: FlowRunnerArtifactEvent = {
    key: args.artifact.key,
    label: args.artifact.label,
    canonicalPath: args.artifact.canonicalPath,
    relativePath: args.artifact.relativePath,
    exists,
    observedAt: new Date().toISOString(),
  };
  args.nodeRun.artifactEvents.push(event);
  if (exists) {
    await copyFlowRunnerArtifactToSurface(args.artifact.canonicalPath, args.nodeRun.record.runDir, args.artifact.relativePath);
    await copyFlowRunnerArtifactToSurface(args.artifact.canonicalPath, args.nodeRun.record.latestDir, args.artifact.relativePath);
  }
  args.forwardEvent({
    type: "artifact-observed",
    flowId: args.params.resolvedFlow.resolved.rootFlowId,
    sessionId: args.params.sessionId,
    qualifiedNodePath: args.current,
    nodeId: args.treeNode.nodeId,
    ...(event.key ? { key: event.key } : {}),
    label: event.label,
    relativePath: event.relativePath,
    canonicalPath: event.canonicalPath,
    exists: event.exists,
    at: event.observedAt,
  });
}
