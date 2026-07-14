import path from "node:path";

import { requireNodeTypeEntry, type NodeRegistry } from "../../../nodes/config";
import { flowRunnerAcceptedDir, flowRunnerFileExists, flowRunnerLatestDir, type FlowRunnerRunTreeNode } from "../../runRecords";
import type { FlowRunnerResolvedFlow } from "../api/contracts";

export async function acceptedTreeNodeForResume<TInput>(params: {
  artifactRoot: string;
  sessionId: string;
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  nodeRegistry: NodeRegistry;
  qualifiedNodePath: string;
}): Promise<FlowRunnerRunTreeNode | undefined> {
  const target = params.resolvedFlow.resolved.nodesByPath[params.qualifiedNodePath];
  if (!target) throw new Error(`Unknown Flow Runner Node path: ${params.qualifiedNodePath}`);
  const entry = requireNodeTypeEntry(params.nodeRegistry, target.node.nodeType);
  const parsedParams = entry.validateParams(target.node.params);
  const expectedArtifacts = entry.describeArtifacts?.({ nodeId: target.node.nodeId, params: parsedParams })?.outputs ?? [];
  const acceptedDir = flowRunnerAcceptedDir(params.artifactRoot, params.sessionId, params.qualifiedNodePath);
  const acceptedSelectionPath = path.join(acceptedDir, "accepted-selection.json");
  if (!await flowRunnerFileExists(acceptedSelectionPath)) return undefined;

  const requiredArtifacts = expectedArtifacts.filter((artifact) => artifact.required !== false);
  const requiredArtifactsExist = await Promise.all(requiredArtifacts.map((artifact) => flowRunnerFileExists(path.join(acceptedDir, artifact.relativePath))));
  if (requiredArtifactsExist.some((exists) => !exists)) return undefined;

  return {
    qualifiedNodePath: target.qualifiedPath,
    nodeId: target.node.nodeId,
    status: "completed",
    note: "Resumed from accepted Node result.",
    runDir: acceptedDir,
    latestDir: flowRunnerLatestDir(params.artifactRoot, params.sessionId, params.qualifiedNodePath),
    acceptedDir,
    accepted: true,
    skipped: true,
    skipReason: "resume-accepted",
  };
}
