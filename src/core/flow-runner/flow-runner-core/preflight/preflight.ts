import path from "node:path";

import { flowRunnerAcceptedDir, flowRunnerFileExists } from "../../runRecords";
import type { FlowRunnerPreflightDependency } from "../../runtimeContext";
import type { FlowRunnerResolvedFlow } from "../api/contracts";

export async function buildPreflightDependencies<TInput>(args: {
  artifactRoot: string;
  sessionId: string;
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  qualifiedNodePath: string;
}): Promise<FlowRunnerPreflightDependency[]> {
  const target = args.resolvedFlow.resolved.nodesByPath[args.qualifiedNodePath];
  if (!target) throw new Error(`Unknown Flow Runner Node path: ${args.qualifiedNodePath}`);
  return Promise.all(target.acceptedArtifacts.map(async (dependency) => {
    const canonicalAcceptedDir = flowRunnerAcceptedDir(args.artifactRoot, args.sessionId, dependency.fromQualifiedPath);
    const canonicalPath = path.join(canonicalAcceptedDir, dependency.relativePath);
    if (await flowRunnerFileExists(canonicalPath)) {
      return {
        fromQualifiedPath: dependency.fromQualifiedPath,
        relativePath: dependency.relativePath,
        label: dependency.label,
        required: dependency.required ?? true,
        acceptedPath: canonicalPath,
        exists: true,
      } satisfies FlowRunnerPreflightDependency;
    }

    const sourceNodeId = args.resolvedFlow.resolved.nodesByPath[dependency.fromQualifiedPath]?.node.nodeId;
    const aliasPath = sourceNodeId && sourceNodeId !== dependency.fromQualifiedPath
      ? path.join(flowRunnerAcceptedDir(args.artifactRoot, args.sessionId, sourceNodeId), dependency.relativePath)
      : undefined;
    const aliasExists = aliasPath ? await flowRunnerFileExists(aliasPath) : false;
    return {
      fromQualifiedPath: dependency.fromQualifiedPath,
      relativePath: dependency.relativePath,
      label: dependency.label,
      required: dependency.required ?? true,
      acceptedPath: aliasExists && aliasPath ? aliasPath : canonicalPath,
      exists: aliasExists,
      ...(aliasExists && sourceNodeId ? { resolvedFromQualifiedPath: sourceNodeId, aliasResolved: true } : {}),
    } satisfies FlowRunnerPreflightDependency;
  }));
}
