import path from "node:path";

import { captureArtifactContent, type CapturedArtifactContent } from "../store/artifactContent";
import type { NodeArtifactInput } from "../store/recordStore";
import { currentRecordsContext, enqueueRecords, flushRecords, recordsEnabled } from "./recordsMirror";

/**
 * Translation from bagelwerk's run-record shapes into Record Store writes. Kept free of imports from
 * flow-runner / workbench / agent-execution so those packages can depend on records without cycles.
 */

type NodeRecordLike = { sessionId: string; flowId: string; qualifiedNodePath: string; runDir: string };
type ArtifactEventLike = { key?: string; label: string; canonicalPath: string; relativePath: string; exists: boolean; observedAt?: string };
type ExistenceLike = { key: string; label: string; relativePath: string; required: boolean; canonicalPath?: string; exists: boolean };
type LaunchSnapshotLike = { nodeId?: string; nodeType?: string; launchedAt?: string; expectedArtifacts?: Array<{ relativePath: string; kind?: string; required?: boolean; key?: string; label?: string }> };

export function nodeOutcomeFromResult(result: unknown, nodeId: string | undefined): { status?: string; note?: string } {
  const working = (result as { working?: { outputsByNodeId?: Record<string, { status?: unknown; note?: unknown }> } } | undefined)?.working;
  const outputs = working?.outputsByNodeId ?? {};
  const output = (nodeId ? outputs[nodeId] : undefined) ?? Object.values(outputs)[0];
  return {
    ...(typeof output?.status === "string" ? { status: output.status } : {}),
    ...(typeof output?.note === "string" ? { note: output.note } : {}),
  };
}

/**
 * Content comes from the per-run copy (<runDir>/<relativePath>, written by the runner) because the
 * canonical path is the Node's output location and later runs may overwrite it. `present` is what the
 * runner observed, not what happens to exist by the time the queue drains.
 */
async function captureArtifacts(runDir: string, artifacts: Array<{ canonicalPath: string; relativePath: string } & Partial<ArtifactEventLike>>, extra: Map<string, Partial<NodeArtifactInput>> = new Map()): Promise<NodeArtifactInput[]> {
  const out: NodeArtifactInput[] = [];
  for (const artifact of artifacts) {
    const observed = artifact.exists !== false;
    let content: CapturedArtifactContent = observed ? await captureArtifactContent(path.join(runDir, artifact.relativePath)) : { present: false };
    if (observed && !content.present) content = await captureArtifactContent(artifact.canonicalPath);
    out.push({
      relativePath: artifact.relativePath,
      ...(artifact.key ? { key: artifact.key } : {}),
      ...(artifact.label ? { label: artifact.label } : {}),
      canonicalPath: artifact.canonicalPath,
      present: observed && content.present,
      ...(content.sha256 ? { sha256: content.sha256 } : {}),
      ...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
      ...(content.mediaType ? { mediaType: content.mediaType } : {}),
      ...(content.contentText !== undefined ? { contentText: content.contentText } : {}),
      ...(artifact.observedAt ? { observedAt: artifact.observedAt } : {}),
      ...extra.get(artifact.relativePath),
    });
  }
  return out;
}

const abs = (value: string) => path.resolve(value);

export function recordNodeRunBegun(args: { artifactRoot: string; record: NodeRecordLike; source?: "flow-runner" | "workbench" }): void {
  if (!recordsEnabled()) return;
  const startedAt = new Date().toISOString();
  enqueueRecords((store) => [...store.resetNodeRunStatements(abs(args.record.runDir)), ...store.nodeRunStatements({
    runDir: abs(args.record.runDir),
    source: args.source ?? "flow-runner",
    artifactRoot: abs(args.artifactRoot),
    sessionId: args.record.sessionId,
    flowId: args.record.flowId,
    nodePath: args.record.qualifiedNodePath,
    status: "running",
    startedAt,
  })]);
}

export async function recordNodeRunPersisted(args: {
  artifactRoot: string;
  record: NodeRecordLike;
  source?: "flow-runner" | "workbench";
  launchSnapshot: LaunchSnapshotLike;
  artifactEvents: ArtifactEventLike[];
  artifactExistence: ExistenceLike[];
  events?: unknown[];
  result: unknown;
}): Promise<void> {
  if (!recordsEnabled()) return;
  const outcome = nodeOutcomeFromResult(args.result, args.launchSnapshot.nodeId);
  const finishedAt = new Date().toISOString();
  const kinds = new Map((args.launchSnapshot.expectedArtifacts ?? []).map((artifact) => [artifact.relativePath, artifact]));
  const required = new Map(args.artifactExistence.map((verdict) => [verdict.relativePath, verdict.required]));
  enqueueRecords(async (store) => {
    const extra = new Map<string, Partial<NodeArtifactInput>>();
    for (const event of args.artifactEvents) {
      const declared = kinds.get(event.relativePath);
      extra.set(event.relativePath, {
        ...(declared?.kind ? { kind: declared.kind } : {}),
        ...(required.has(event.relativePath) ? { required: required.get(event.relativePath) } : {}),
      });
    }
    const artifacts = await captureArtifacts(abs(args.record.runDir), args.artifactEvents, extra);
    return [
      ...store.nodeRunStatements({
        runDir: abs(args.record.runDir),
        source: args.source ?? "flow-runner",
        artifactRoot: abs(args.artifactRoot),
        sessionId: args.record.sessionId,
        flowId: args.record.flowId,
        nodePath: args.record.qualifiedNodePath,
        ...(args.launchSnapshot.nodeId ? { nodeId: args.launchSnapshot.nodeId } : {}),
        ...(args.launchSnapshot.nodeType ? { nodeType: args.launchSnapshot.nodeType } : {}),
        status: outcome.status ?? "unknown",
        ...(outcome.note ? { note: outcome.note } : {}),
        launchSnapshot: args.launchSnapshot,
        result: args.result,
        artifactExistence: args.artifactExistence,
        ...(args.launchSnapshot.launchedAt ? { startedAt: args.launchSnapshot.launchedAt } : {}),
        finishedAt,
      }),
      ...store.nodeArtifactStatements(abs(args.record.runDir), artifacts, { sessionId: args.record.sessionId, nodePath: args.record.qualifiedNodePath }),
    ];
  });
  if (args.source === "workbench" && args.events?.length) {
    const events = args.events;
    enqueueRecords((store) => store.flowEventStatements(events.map((event, ord) => ({ ownerRunDir: abs(args.record.runDir), ord, event: event as Record<string, unknown> }))));
  }
  await flushRecords();
}

export async function recordNodeAccepted(args: {
  artifactRoot: string;
  sessionId: string;
  nodePath: string;
  runDir: string;
  nodeId?: string;
  emittedArtifacts: Array<{ canonicalPath: string; relativePath: string }>;
  acceptance: { acceptedAt: string; acceptedByKind?: string; acceptedById?: string; note?: string; runDir: string };
}): Promise<void> {
  if (!recordsEnabled()) return;
  enqueueRecords(async (store) => {
    const artifacts = await captureArtifacts(abs(args.runDir), args.emittedArtifacts);
    const statements = [
      ...store.nodeArtifactStatements(abs(args.runDir), artifacts, { sessionId: args.sessionId, nodePath: args.nodePath }),
      ...store.acceptanceStatements({ artifactRoot: abs(args.artifactRoot), sessionId: args.sessionId, nodePath: args.nodePath, runDir: abs(args.runDir), record: { ...args.acceptance, runDir: abs(args.acceptance.runDir) } }),
    ];
    if (args.nodeId && args.nodeId !== args.nodePath) {
      statements.push(...store.acceptanceStatements({
        artifactRoot: abs(args.artifactRoot),
        sessionId: args.sessionId,
        nodePath: args.nodeId,
        runDir: abs(args.runDir),
        aliasFor: args.nodePath,
        record: { ...args.acceptance, runDir: abs(args.acceptance.runDir), aliasForQualifiedNodePath: args.nodePath },
      }));
    }
    return statements;
  });
  await flushRecords();
}

export function recordFlowRunBegun(args: { artifactRoot: string; sessionId: string; flowId: string; runDir: string }): void {
  if (!recordsEnabled()) return;
  const startedAt = new Date().toISOString();
  enqueueRecords((store) => store.flowRunStatements({ ...args, artifactRoot: abs(args.artifactRoot), runDir: abs(args.runDir), status: "running", startedAt }));
}

export async function recordFlowRunPersisted(args: { artifactRoot: string; runDir: string; runTree: { flowId: string; sessionId: string; mode?: string; status?: string; startedAt?: string; finishedAt?: string } }): Promise<void> {
  if (!recordsEnabled()) return;
  const tree = args.runTree;
  enqueueRecords((store) => store.flowRunStatements({
    runDir: abs(args.runDir),
    artifactRoot: abs(args.artifactRoot),
    sessionId: tree.sessionId,
    flowId: tree.flowId,
    ...(tree.mode ? { mode: tree.mode } : {}),
    ...(tree.status ? { status: tree.status } : {}),
    ...(tree.startedAt ? { startedAt: tree.startedAt } : {}),
    ...(tree.finishedAt ? { finishedAt: tree.finishedAt } : {}),
    runTree: tree,
  }));
  await flushRecords();
}

/** Recovers the artifact root from a Flow Runner node run dir: <root>/<session>/nodes/<node>/runs/run-NNN. */
export function artifactRootFromNodeRunDir(runDir: string): string {
  return path.resolve(runDir, "..", "..", "..", "..", "..");
}

export function artifactRootFromFlowRunDir(runDir: string): string {
  return path.resolve(runDir, "..", "..", "..", "..");
}

// ---------- agent observation ----------

export type AgentObservationMirror = {
  file(relativePath: string, content: string): void;
  ndjson(relativePath: string, value: unknown): void;
  finalized(): Promise<void>;
};

const NOOP: AgentObservationMirror = { file: () => undefined, ndjson: () => undefined, finalized: async () => undefined };

export function recordAgentObservationBegun(args: { observationDir: string; runId?: string; nodeId: string; startedAt: string }): AgentObservationMirror {
  if (!recordsEnabled()) return NOOP;
  const nodeRunDir = currentRecordsContext()?.nodeRunDir;
  const observationDir = path.resolve(args.observationDir);
  const rawEnabled = /^(1|true|on)$/i.test(process.env.BAGELWERK_RECORDS_RAW ?? "");
  const rawCounters = new Map<string, number>();
  enqueueRecords((store) => store.agentRunStatements({
    observationDir,
    ...(args.runId ? { runId: args.runId } : {}),
    nodeId: args.nodeId,
    ...(nodeRunDir ? { nodeRunDir } : {}),
    startedAt: args.startedAt,
  }));
  return {
    file(relativePath, content) {
      enqueueRecords((store) => store.agentFileStatements(observationDir, relativePath, content, { at: new Date().toISOString() }));
    },
    ndjson(relativePath, value) {
      const base = relativePath.split("/").pop() ?? relativePath;
      if (base === "run-events.ndjson") {
        const event = value as { seq?: number; at?: string; harness?: string; kind?: string; phase?: string; itemId?: string; summary?: string; detail?: unknown };
        if (typeof event?.seq !== "number") return;
        enqueueRecords((store) => store.agentRunEventStatements(observationDir, [{
          seq: event.seq!,
          ...(event.at ? { at: event.at } : {}),
          ...(event.harness ? { harness: event.harness } : {}),
          ...(event.kind ? { kind: event.kind } : {}),
          ...(event.phase ? { phase: event.phase } : {}),
          ...(event.itemId ? { itemId: event.itemId } : {}),
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
        }]));
        return;
      }
      if (!rawEnabled) return;
      const ord = (rawCounters.get(relativePath) ?? -1) + 1;
      rawCounters.set(relativePath, ord);
      enqueueRecords((store) => store.agentRawEventStatements(observationDir, relativePath, [{ ord, payload: value }]));
    },
    async finalized() {
      await flushRecords();
    },
  };
}

export async function recordSupervisorReport(args: { rootDir: string; report: Record<string, unknown>; ledger: Array<Record<string, unknown>> }): Promise<void> {
  if (!recordsEnabled()) return;
  enqueueRecords((store) => store.supervisorStatements(path.resolve(args.rootDir), args.report, args.ledger));
  await flushRecords();
}
