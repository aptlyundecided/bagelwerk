import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExecutionPolicy, ExecutionPolicySource } from "../flows/config";

export type FlowRunnerAcceptanceActorKind = "user" | "agent";

export type FlowRunnerNodeStatus = "completed" | "failed" | "timed_out" | "unknown";

export type FlowRunnerLaunchSnapshot = {
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

export type FlowRunnerArtifactEvent = {
  key?: string;
  label: string;
  canonicalPath: string;
  relativePath: string;
  exists: boolean;
  observedAt: string;
};

export type FlowRunnerArtifactExistenceVerdict = {
  key: string;
  label: string;
  relativePath: string;
  required: boolean;
  canonicalPath?: string;
  exists: boolean;
};

export type FlowRunnerAcceptanceRecord = {
  acceptedAt: string;
  acceptedByKind: FlowRunnerAcceptanceActorKind;
  acceptedById?: string;
  note?: string;
  runDir: string;
  aliasForQualifiedNodePath?: string;
};

export type FlowRunnerNodeRunRecord = {
  sessionId: string;
  flowId: string;
  qualifiedNodePath: string;
  runDir: string;
  latestDir: string;
  acceptedDir: string;
  launchSnapshotPath: string;
  artifactEventsPath: string;
  artifactExistencePath: string;
  eventsPath: string;
  resultPath: string;
};

export type FlowRunnerFlowRunRecord = {
  sessionId: string;
  flowId: string;
  runDir: string;
  latestDir: string;
  runTreePath: string;
  eventsPath: string;
};

export type FlowRunnerRunTreeNode = {
  qualifiedNodePath: string;
  nodeId: string;
  status: FlowRunnerNodeStatus;
  note?: string;
  runDir: string;
  latestDir: string;
  acceptedDir: string;
  accepted: boolean;
  skipped?: boolean;
  skipReason?: string;
};

export type FlowRunnerRunTreeLane = {
  laneId: string;
  flowPath: string;
  nodes: FlowRunnerRunTreeNode[];
};

export type FlowRunnerRunTree = {
  schemaVersion: 1;
  flowId: string;
  sessionId: string;
  mode: "whole-flow" | "prefix" | "lanes";
  startedAt: string;
  finishedAt: string;
  status: FlowRunnerNodeStatus;
  nodes: FlowRunnerRunTreeNode[];
  lanes: Array<{
    after?: string;
    join?: string;
    laneConcurrency: number | "unbounded";
    lanes: FlowRunnerRunTreeLane[];
  }>;
};

export function sanitizeFlowRunnerRecordPathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

export function defaultFlowRunnerArtifactRoot(params: { cwd?: string; flowId: string }): string {
  return path.join(params.cwd ?? process.cwd(), ".artifacts", "flows", sanitizeFlowRunnerRecordPathPart(params.flowId));
}

export function flowRunnerSessionRoot(artifactRoot: string, sessionId: string): string {
  return path.join(artifactRoot, sanitizeFlowRunnerRecordPathPart(sessionId));
}

export function flowRunnerNodeRoot(artifactRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(flowRunnerSessionRoot(artifactRoot, sessionId), "nodes", sanitizeFlowRunnerRecordPathPart(qualifiedNodePath));
}

export function flowRunnerLatestDir(artifactRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(flowRunnerNodeRoot(artifactRoot, sessionId, qualifiedNodePath), "latest");
}

export function flowRunnerAcceptedDir(artifactRoot: string, sessionId: string, qualifiedNodePath: string): string {
  return path.join(flowRunnerNodeRoot(artifactRoot, sessionId, qualifiedNodePath), "accepted");
}

export function flowRunnerFlowRoot(artifactRoot: string, sessionId: string): string {
  return path.join(flowRunnerSessionRoot(artifactRoot, sessionId), "__flow__");
}

export function flowRunnerFlowLatestDir(artifactRoot: string, sessionId: string): string {
  return path.join(flowRunnerFlowRoot(artifactRoot, sessionId), "latest");
}

async function nextRunDir(root: string): Promise<string> {
  const runsRoot = path.join(root, "runs");
  await mkdir(runsRoot, { recursive: true });
  let max = 0;
  try {
    max = Number.parseInt((await readFile(path.join(runsRoot, ".counter"), "utf8")).trim(), 10) || 0;
  } catch {
    max = 0;
  }
  const next = max + 1;
  await writeFile(path.join(runsRoot, ".counter"), `${next}\n`, "utf8");
  return path.join(runsRoot, `run-${String(next).padStart(3, "0")}`);
}

export async function beginFlowRunnerNodeRun(params: {
  artifactRoot: string;
  sessionId: string;
  qualifiedNodePath: string;
  flowId: string;
}): Promise<FlowRunnerNodeRunRecord> {
  const nodeRoot = flowRunnerNodeRoot(params.artifactRoot, params.sessionId, params.qualifiedNodePath);
  const runDir = await nextRunDir(nodeRoot);
  const latestDir = flowRunnerLatestDir(params.artifactRoot, params.sessionId, params.qualifiedNodePath);
  const acceptedDir = flowRunnerAcceptedDir(params.artifactRoot, params.sessionId, params.qualifiedNodePath);
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
    eventsPath: path.join(runDir, "events.json"),
    resultPath: path.join(runDir, "node-result.json"),
  };
}

export async function beginFlowRunnerFlowRun(params: {
  artifactRoot: string;
  sessionId: string;
  flowId: string;
}): Promise<FlowRunnerFlowRunRecord> {
  const flowRoot = flowRunnerFlowRoot(params.artifactRoot, params.sessionId);
  const runDir = await nextRunDir(flowRoot);
  const latestDir = flowRunnerFlowLatestDir(params.artifactRoot, params.sessionId);
  await mkdir(runDir, { recursive: true });
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });
  return {
    sessionId: params.sessionId,
    flowId: params.flowId,
    runDir,
    latestDir,
    runTreePath: path.join(runDir, "run-tree.json"),
    eventsPath: path.join(runDir, "events.json"),
  };
}

export async function copyFlowRunnerArtifactToSurface(sourcePath: string, surfaceRoot: string, relativePath: string): Promise<string> {
  const targetPath = path.join(surfaceRoot, relativePath);
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return targetPath;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: false });
  return targetPath;
}

async function writeJsonAndCopyToLatest(params: { filePath: string; latestDir: string; value: unknown }): Promise<void> {
  await writeFile(params.filePath, `${JSON.stringify(params.value, null, 2)}\n`, "utf8");
  await mkdir(params.latestDir, { recursive: true });
  await cp(params.filePath, path.join(params.latestDir, path.basename(params.filePath)), { recursive: false });
}

export async function persistFlowRunnerNodeSidecars(params: {
  record: FlowRunnerNodeRunRecord;
  launchSnapshot: FlowRunnerLaunchSnapshot;
  artifactEvents: FlowRunnerArtifactEvent[];
  artifactExistence: FlowRunnerArtifactExistenceVerdict[];
  events?: unknown[];
  result: unknown;
}): Promise<void> {
  await writeJsonAndCopyToLatest({ filePath: params.record.launchSnapshotPath, latestDir: params.record.latestDir, value: params.launchSnapshot });
  await writeJsonAndCopyToLatest({ filePath: params.record.artifactEventsPath, latestDir: params.record.latestDir, value: params.artifactEvents });
  await writeJsonAndCopyToLatest({ filePath: params.record.artifactExistencePath, latestDir: params.record.latestDir, value: params.artifactExistence });
  await writeJsonAndCopyToLatest({ filePath: params.record.eventsPath, latestDir: params.record.latestDir, value: { schemaVersion: 1, events: params.events ?? [] } });
  await writeJsonAndCopyToLatest({ filePath: params.record.resultPath, latestDir: params.record.latestDir, value: params.result });
}

export async function acceptFlowRunnerNodeRun(params: {
  artifactRoot: string;
  sessionId: string;
  record: FlowRunnerNodeRunRecord;
  nodeId: string;
  emittedArtifacts: Array<{ canonicalPath: string; relativePath: string }>;
  acceptance: Omit<FlowRunnerAcceptanceRecord, "aliasForQualifiedNodePath">;
}): Promise<void> {
  await writeAcceptedSurface({ acceptedDir: params.record.acceptedDir, emittedArtifacts: params.emittedArtifacts, acceptance: params.acceptance });

  if (params.nodeId !== params.record.qualifiedNodePath) {
    const aliasDir = flowRunnerAcceptedDir(params.artifactRoot, params.sessionId, params.nodeId);
    await writeAcceptedSurface({
      acceptedDir: aliasDir,
      emittedArtifacts: params.emittedArtifacts,
      acceptance: { ...params.acceptance, aliasForQualifiedNodePath: params.record.qualifiedNodePath },
    });
  }
}

async function writeAcceptedSurface(params: {
  acceptedDir: string;
  emittedArtifacts: Array<{ canonicalPath: string; relativePath: string }>;
  acceptance: FlowRunnerAcceptanceRecord;
}): Promise<void> {
  await rm(params.acceptedDir, { recursive: true, force: true });
  await mkdir(params.acceptedDir, { recursive: true });
  for (const artifact of params.emittedArtifacts) {
    await copyFlowRunnerArtifactToSurface(artifact.canonicalPath, params.acceptedDir, artifact.relativePath);
  }
  await writeFile(path.join(params.acceptedDir, "accepted-selection.json"), `${JSON.stringify(params.acceptance, null, 2)}\n`, "utf8");
}

export async function persistFlowRunnerRunTree(params: {
  record: FlowRunnerFlowRunRecord;
  runTree: FlowRunnerRunTree;
  events?: unknown[];
}): Promise<void> {
  await writeJsonAndCopyToLatest({ filePath: params.record.runTreePath, latestDir: params.record.latestDir, value: params.runTree });
  await writeJsonAndCopyToLatest({ filePath: params.record.eventsPath, latestDir: params.record.latestDir, value: { schemaVersion: 1, events: params.events ?? [] } });
}

export async function flowRunnerFileExists(filePath: string): Promise<boolean> {
  try {
    const st = await stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}
