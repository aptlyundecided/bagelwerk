import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExecutionPolicy, ExecutionPolicySource, FlowRuntimeEvent } from "../flows/config";

export type FlowWorkbenchAcceptanceActorKind = "user" | "agent";

export type FlowWorkbenchLaunchSnapshot = {
  flowId: string;
  qualifiedNodePath: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  nodeDescription: string;
  flowPath: string[];
  nodeStatus?: string;
  params: unknown;
  executionPolicy?: ExecutionPolicy;
  executionPolicySources?: ExecutionPolicySource[];
  acceptedUpstreamArtifacts: Array<{
    fromQualifiedPath: string;
    relativePath: string;
    label?: string;
    required: boolean;
    acceptedPath: string;
    resolvedFromQualifiedPath?: string;
    aliasResolved?: boolean;
  }>;
  expectedArtifacts: Array<{
    key: string;
    label: string;
    relativePath: string;
    required: boolean;
    kind?: string;
  }>;
  launchedAt: string;
};

export type FlowWorkbenchArtifactEvent = {
  key?: string;
  label: string;
  canonicalPath: string;
  relativePath: string;
  exists: boolean;
  observedAt: string;
};

export type FlowWorkbenchArtifactExistenceVerdict = {
  key: string;
  label: string;
  relativePath: string;
  required: boolean;
  canonicalPath?: string;
  exists: boolean;
};

export type FlowWorkbenchAcceptanceRecord = {
  acceptedAt: string;
  acceptedByKind: FlowWorkbenchAcceptanceActorKind;
  acceptedById?: string;
  note?: string;
  runDir: string;
};

export type FlowWorkbenchRunRecord = {
  sessionId: string;
  flowId: string;
  qualifiedNodePath: string;
  runDir: string;
  latestDir: string;
  acceptedDir: string;
  launchSnapshotPath: string;
  artifactEventsPath: string;
  artifactExistencePath: string;
  flowEventsPath: string;
  resultPath: string;
};

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

export function workbenchSessionRoot(workspaceRoot: string, sessionId: string): string {
  return path.join(workspaceRoot, sessionId);
}

export function workbenchNodeRoot(workspaceRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(workbenchSessionRoot(workspaceRoot, sessionId), sanitizePathPart(qualifiedNodePath));
}

export function workbenchLatestDir(workspaceRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(workbenchNodeRoot(workspaceRoot, sessionId, qualifiedNodePath), "latest");
}

export function workbenchAcceptedDir(workspaceRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(workbenchNodeRoot(workspaceRoot, sessionId, qualifiedNodePath), "accepted");
}

async function nextRunDir(workspaceRoot: string, sessionId: string, qualifiedNodePath: string): Promise<string> {
  const runsRoot = path.join(workbenchNodeRoot(workspaceRoot, sessionId, qualifiedNodePath), "runs");
  await mkdir(runsRoot, { recursive: true });
  let max = 0;
  try {
    const entries = await readFile(path.join(runsRoot, ".counter"), "utf8");
    max = Number.parseInt(entries.trim(), 10) || 0;
  } catch {
    max = 0;
  }
  const next = max + 1;
  await writeFile(path.join(runsRoot, ".counter"), `${next}\n`, "utf8");
  return path.join(runsRoot, `run-${String(next).padStart(3, "0")}`);
}

export async function beginWorkbenchRun(params: {
  workspaceRoot: string;
  sessionId: string;
  qualifiedNodePath: string;
  flowId: string;
}): Promise<FlowWorkbenchRunRecord> {
  const runDir = await nextRunDir(params.workspaceRoot, params.sessionId, params.qualifiedNodePath);
  const latestDir = workbenchLatestDir(params.workspaceRoot, params.sessionId, params.qualifiedNodePath);
  const acceptedDir = workbenchAcceptedDir(params.workspaceRoot, params.sessionId, params.qualifiedNodePath);
  await mkdir(runDir, { recursive: true });
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });

  return {
    sessionId: params.sessionId,
    flowId: params.flowId,
    qualifiedNodePath: params.qualifiedNodePath,
    runDir,
    latestDir,
    acceptedDir,
    launchSnapshotPath: path.join(runDir, "launch-snapshot.json"),
    artifactEventsPath: path.join(runDir, "artifact-events.json"),
    artifactExistencePath: path.join(runDir, "artifact-existence.json"),
    flowEventsPath: path.join(runDir, "flow-events.json"),
    resultPath: path.join(runDir, "node-result.json"),
  };
}

export async function copyCanonicalArtifactToSurface(sourcePath: string, surfaceRoot: string, relativePath: string): Promise<string> {
  const targetPath = path.join(surfaceRoot, relativePath);
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return targetPath;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: false });
  return targetPath;
}

export async function persistWorkbenchSidecars(params: {
  record: FlowWorkbenchRunRecord;
  launchSnapshot: FlowWorkbenchLaunchSnapshot;
  artifactEvents: FlowWorkbenchArtifactEvent[];
  artifactExistence: FlowWorkbenchArtifactExistenceVerdict[];
  flowEvents?: FlowRuntimeEvent[];
  result: unknown;
}): Promise<void> {
  await writeFile(params.record.launchSnapshotPath, `${JSON.stringify(params.launchSnapshot, null, 2)}\n`, "utf8");
  await writeFile(params.record.artifactEventsPath, `${JSON.stringify(params.artifactEvents, null, 2)}\n`, "utf8");
  await writeFile(params.record.artifactExistencePath, `${JSON.stringify(params.artifactExistence, null, 2)}\n`, "utf8");
  await writeFile(params.record.flowEventsPath, `${JSON.stringify({ schemaVersion: 1, events: params.flowEvents ?? [] }, null, 2)}\n`, "utf8");
  await writeFile(params.record.resultPath, `${JSON.stringify(params.result, null, 2)}\n`, "utf8");

  await cp(params.record.launchSnapshotPath, path.join(params.record.latestDir, path.basename(params.record.launchSnapshotPath)), { recursive: false });
  await cp(params.record.artifactEventsPath, path.join(params.record.latestDir, path.basename(params.record.artifactEventsPath)), { recursive: false });
  await cp(params.record.artifactExistencePath, path.join(params.record.latestDir, path.basename(params.record.artifactExistencePath)), { recursive: false });
  await cp(params.record.flowEventsPath, path.join(params.record.latestDir, path.basename(params.record.flowEventsPath)), { recursive: false });
  await cp(params.record.resultPath, path.join(params.record.latestDir, path.basename(params.record.resultPath)), { recursive: false });
}

export async function acceptWorkbenchRun(params: {
  record: FlowWorkbenchRunRecord;
  emittedArtifacts: Array<{ canonicalPath: string; relativePath: string }>;
  acceptance: FlowWorkbenchAcceptanceRecord;
}): Promise<void> {
  await rm(params.record.acceptedDir, { recursive: true, force: true });
  await mkdir(params.record.acceptedDir, { recursive: true });
  for (const artifact of params.emittedArtifacts) {
    await copyCanonicalArtifactToSurface(artifact.canonicalPath, params.record.acceptedDir, artifact.relativePath);
  }
  if (await fileExists(params.record.flowEventsPath)) {
    await cp(params.record.flowEventsPath, path.join(params.record.acceptedDir, path.basename(params.record.flowEventsPath)), { recursive: false });
  }
  await writeFile(path.join(params.record.acceptedDir, "accepted-selection.json"), `${JSON.stringify(params.acceptance, null, 2)}\n`, "utf8");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const st = await stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}
