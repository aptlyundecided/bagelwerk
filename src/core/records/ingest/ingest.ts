import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { captureArtifactContent } from "../store/artifactContent";
import type { NodeArtifactInput, RecordStore } from "../store/recordStore";
import type { SqlStatement } from "../sql/types";
import { nodeOutcomeFromResult } from "../mirror/hooks";
import { sanitizeFlowRunnerRecordPathPart } from "../../flow-runner/runRecords";

export type IngestReport = {
  directoriesScanned: number;
  flowRuns: number;
  nodeRuns: number;
  acceptances: number;
  agentRuns: number;
  agentRunEvents: number;
  supervisorReports: number;
  errors: Array<{ path: string; error: string }>;
};

const SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", "dist", "pgdata", ".cache", ".next", "coverage"]);

async function readJson<T = unknown>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readNdjson(filePath: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn last line from a killed process
    }
  }
  return out;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function eventsOf(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const events = (value as { events?: unknown } | undefined)?.events;
  return Array.isArray(events) ? (events as Array<Record<string, unknown>>) : [];
}

function sessionIdFrom(events: Array<Record<string, unknown>>, fallback: string): string {
  for (const event of events) if (typeof event.sessionId === "string") return event.sessionId;
  return fallback;
}

async function listFilesRecursive(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(root, relative)));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

/**
 * Backfills the store from run-record files. Detects Flow Runner node/flow runs, Workbench runs,
 * accepted surfaces, agent observation dirs and supervisor reports anywhere under the given paths.
 * Idempotent: every write is keyed on its natural key, so re-running is safe.
 */
export async function ingestPaths(store: RecordStore, roots: string[], options: { maxDepth?: number; log?: (line: string) => void } = {}): Promise<IngestReport> {
  const report: IngestReport = { directoriesScanned: 0, flowRuns: 0, nodeRuns: 0, acceptances: 0, agentRuns: 0, agentRunEvents: 0, supervisorReports: 0, errors: [] };
  const maxDepth = options.maxDepth ?? 12;
  const acceptedDirs: string[] = [];

  async function apply(label: string, dir: string, build: () => Promise<SqlStatement[]>): Promise<boolean> {
    try {
      await store.apply(await build());
      return true;
    } catch (error) {
      report.errors.push({ path: dir, error: `${label}: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  async function walk(dir: string, depth: number): Promise<void> {
    report.directoriesScanned += 1;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      report.errors.push({ path: dir, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const base = path.basename(dir);
    const parentBase = path.basename(path.dirname(dir));

    if (base === "accepted" && names.has("accepted-selection.json")) {
      acceptedDirs.push(dir); // after runs, so node rows exist first
      return;
    }
    if (/^run-\d+$/.test(base) && parentBase === "runs") {
      if (names.has("run-tree.json")) {
        if (await apply("flow run", dir, () => flowRunStatements(store, dir))) report.flowRuns += 1;
        return;
      }
      if (names.has("launch-snapshot.json")) {
        if (await apply("node run", dir, () => nodeRunStatements(store, dir, names.has("flow-events.json") && !names.has("events.json") ? "workbench" : "flow-runner"))) report.nodeRuns += 1;
        return;
      }
    }
    if (names.has("summary.json") && (names.has("prompt.md") || names.has("run-events.ndjson") || names.has("input.json"))) {
      const statements = await agentStatements(store, dir).catch((error) => {
        report.errors.push({ path: dir, error: `agent run: ${error instanceof Error ? error.message : String(error)}` });
        return undefined;
      });
      if (statements && (await apply("agent run", dir, async () => statements.statements))) {
        report.agentRuns += 1;
        report.agentRunEvents += statements.events;
      }
      return;
    }
    if (names.has("ledger.jsonl") && names.has("health.json")) {
      if (await apply("supervisor", dir, () => supervisorStatements(store, dir))) report.supervisorReports += 1;
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || /\.(restore|old)-\d+-/.test(entry.name) || entry.name.endsWith(".sync.lock")) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!(await exists(resolved))) {
      report.errors.push({ path: resolved, error: "does not exist" });
      continue;
    }
    await walk(resolved, 0);
  }
  for (const dir of acceptedDirs) {
    if (await apply("acceptance", dir, () => acceptanceStatementsFromDir(store, dir, { includeRun: false }))) report.acceptances += 1;
  }
  options.log?.(
    `ingested ${report.nodeRuns} node runs, ${report.flowRuns} flow runs, ${report.acceptances} acceptances, ${report.agentRuns} agent runs (${report.agentRunEvents} events), ${report.supervisorReports} supervisor reports; ${report.errors.length} errors`,
  );
  return report;
}

async function flowRunStatements(store: RecordStore, runDir: string): Promise<SqlStatement[]> {
  const tree = (await readJson<Record<string, unknown>>(path.join(runDir, "run-tree.json"))) ?? {};
  const events = eventsOf(await readJson(path.join(runDir, "events.json")));
  const sessionDir = path.resolve(runDir, "..", "..", "..");
  return [
    ...store.flowRunStatements({
      runDir,
      artifactRoot: path.dirname(sessionDir),
      sessionId: typeof tree.sessionId === "string" ? tree.sessionId : sessionIdFrom(events, path.basename(sessionDir)),
      flowId: typeof tree.flowId === "string" ? tree.flowId : "unknown",
      ...(typeof tree.mode === "string" ? { mode: tree.mode } : {}),
      ...(typeof tree.status === "string" ? { status: tree.status } : {}),
      ...(typeof tree.startedAt === "string" ? { startedAt: tree.startedAt } : {}),
      ...(typeof tree.finishedAt === "string" ? { finishedAt: tree.finishedAt } : {}),
      runTree: tree,
    }),
    ...store.flowEventStatements(events.map((event, ord) => ({ ownerRunDir: runDir, ord, event }))),
  ];
}

async function nodeRunStatements(store: RecordStore, runDir: string, source: "flow-runner" | "workbench"): Promise<SqlStatement[]> {
  const snapshot = (await readJson<Record<string, unknown>>(path.join(runDir, "launch-snapshot.json"))) ?? {};
  const result = await readJson(path.join(runDir, "node-result.json"));
  const artifactEvents = (await readJson<Array<Record<string, unknown>>>(path.join(runDir, "artifact-events.json"))) ?? [];
  const existence = (await readJson<Array<Record<string, unknown>>>(path.join(runDir, "artifact-existence.json"))) ?? [];
  const events = eventsOf(await readJson(path.join(runDir, source === "workbench" ? "flow-events.json" : "events.json")));
  // flow-runner: <root>/<session>/nodes/<node>/runs/run-NNN ; workbench: <root>/<session>/<node>/runs/run-NNN
  const sessionDir = source === "workbench" ? path.resolve(runDir, "..", "..", "..") : path.resolve(runDir, "..", "..", "..", "..");
  const nodePath = typeof snapshot.qualifiedNodePath === "string" ? snapshot.qualifiedNodePath : path.basename(path.resolve(runDir, "..", ".."));
  const sessionId = sessionIdFrom(events, path.basename(sessionDir));
  const nodeId = typeof snapshot.nodeId === "string" ? snapshot.nodeId : undefined;
  const outcome = nodeOutcomeFromResult(result, nodeId);
  const required = new Map(existence.map((verdict) => [String(verdict.relativePath), verdict.required === true]));
  const kinds = new Map(((snapshot.expectedArtifacts as Array<Record<string, unknown>> | undefined) ?? []).map((artifact) => [String(artifact.relativePath), artifact.kind]));
  const artifacts: NodeArtifactInput[] = [];
  for (const event of artifactEvents) {
    const relativePath = String(event.relativePath ?? "");
    if (!relativePath) continue;
    // Per-run copy first: the canonical path can hold a later run's output.
    const candidates = event.exists === false ? [] : ([path.join(runDir, relativePath), typeof event.canonicalPath === "string" ? event.canonicalPath : undefined].filter(Boolean) as string[]);
    let content = { present: false } as Awaited<ReturnType<typeof captureArtifactContent>>;
    let canonicalPath = candidates[0];
    for (const candidate of candidates) {
      content = await captureArtifactContent(candidate);
      if (content.present) {
        canonicalPath = candidate;
        break;
      }
    }
    artifacts.push({
      relativePath,
      ...(typeof event.key === "string" ? { key: event.key } : {}),
      ...(typeof event.label === "string" ? { label: event.label } : {}),
      ...(typeof kinds.get(relativePath) === "string" ? { kind: kinds.get(relativePath) as string } : {}),
      ...(required.has(relativePath) ? { required: required.get(relativePath) } : {}),
      present: event.exists !== false && content.present,
      ...(canonicalPath ? { canonicalPath } : {}),
      ...(content.sha256 ? { sha256: content.sha256 } : {}),
      ...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
      ...(content.mediaType ? { mediaType: content.mediaType } : {}),
      ...(content.contentText !== undefined ? { contentText: content.contentText } : {}),
      ...(typeof event.observedAt === "string" ? { observedAt: event.observedAt } : {}),
    });
  }
  const finishedEvent = [...events].reverse().find((event) => event.type === "node-complete");
  return [
    ...store.nodeRunStatements({
      runDir,
      source,
      artifactRoot: path.dirname(sessionDir),
      sessionId,
      ...(typeof snapshot.flowId === "string" ? { flowId: snapshot.flowId } : {}),
      nodePath,
      ...(nodeId ? { nodeId } : {}),
      ...(typeof snapshot.nodeType === "string" ? { nodeType: snapshot.nodeType } : {}),
      status: outcome.status ?? (result ? "unknown" : "running"),
      ...(outcome.note ? { note: outcome.note } : {}),
      launchSnapshot: snapshot,
      ...(result !== undefined ? { result } : {}),
      artifactExistence: existence,
      ...(typeof snapshot.launchedAt === "string" ? { startedAt: snapshot.launchedAt } : {}),
      ...(typeof finishedEvent?.at === "string" ? { finishedAt: finishedEvent.at } : {}),
    }),
    ...store.nodeArtifactStatements(runDir, artifacts, { sessionId, nodePath }),
    ...store.flowEventStatements(events.map((event, ord) => ({ ownerRunDir: runDir, ord, event }))),
  ];
}

/**
 * Statements recording an accepted/ directory as it is on disk: the acceptance, and (only where missing)
 * the artifacts from the accepted copies. `includeRun` also records the run directory itself, used when
 * healing the store from a files-only acceptance.
 */
export async function acceptanceStatementsFromDir(store: RecordStore, acceptedDir: string, options: { includeRun?: boolean } = { includeRun: true }): Promise<SqlStatement[]> {
  const record = await readJson<Record<string, unknown> & { acceptedAt: string; runDir: string }>(path.join(acceptedDir, "accepted-selection.json"));
  if (!record?.acceptedAt || !record.runDir) throw new Error("accepted-selection.json lacks acceptedAt/runDir");
  const nodeDir = path.dirname(acceptedDir);
  const isFlowRunner = path.basename(path.dirname(nodeDir)) === "nodes";
  // A relative runDir was relative to the writer's cwd, not to this file; the run lives beside accepted/.
  // An alias dir (accepted under the nodeId) points at a run that lives under the qualified node's dir.
  const aliasTarget = typeof record.aliasForQualifiedNodePath === "string" && isFlowRunner
    ? path.join(path.dirname(nodeDir), sanitizeFlowRunnerRecordPathPart(record.aliasForQualifiedNodePath))
    : nodeDir;
  const runDir = path.isAbsolute(record.runDir) ? path.resolve(record.runDir) : path.join(aliasTarget, "runs", path.basename(record.runDir));
  const sessionDir = isFlowRunner ? path.resolve(nodeDir, "..", "..") : path.dirname(nodeDir);
  const snapshot = (await readJson<Record<string, unknown>>(path.join(runDir, "launch-snapshot.json"))) ?? {};
  const events = eventsOf(await readJson(path.join(runDir, isFlowRunner ? "events.json" : "flow-events.json")));
  const sessionId = sessionIdFrom(events, path.basename(sessionDir));
  const qualified = typeof snapshot.qualifiedNodePath === "string" ? snapshot.qualifiedNodePath : path.basename(nodeDir);
  const aliasFor = typeof record.aliasForQualifiedNodePath === "string" ? record.aliasForQualifiedNodePath : undefined;
  const nodePath = aliasFor ? (typeof snapshot.nodeId === "string" ? snapshot.nodeId : path.basename(nodeDir)) : qualified;
  const artifacts: NodeArtifactInput[] = [];
  for (const relativePath of await listFilesRecursive(acceptedDir)) {
    if (relativePath === "accepted-selection.json" || (!isFlowRunner && relativePath === "flow-events.json")) continue;
    const filePath = path.join(acceptedDir, relativePath);
    const content = await captureArtifactContent(filePath);
    if (!content.present) continue;
    artifacts.push({
      relativePath: relativePath.split(path.sep).join("/"),
      present: true,
      canonicalPath: filePath,
      ...(content.sha256 ? { sha256: content.sha256 } : {}),
      ...(content.bytes !== undefined ? { bytes: content.bytes } : {}),
      ...(content.mediaType ? { mediaType: content.mediaType } : {}),
      ...(content.contentText !== undefined ? { contentText: content.contentText } : {}),
    });
  }
  const runStatements = options.includeRun !== false && (await exists(path.join(runDir, "launch-snapshot.json")))
    ? await nodeRunStatements(store, runDir, isFlowRunner ? "flow-runner" : "workbench")
    : [];
  return [
    ...runStatements,
    ...store.nodeArtifactStatements(runDir, artifacts, { sessionId, nodePath: qualified, ifMissing: true }),
    ...store.acceptanceStatements({
      artifactRoot: path.dirname(sessionDir),
      sessionId,
      nodePath,
      runDir,
      ...(aliasFor ? { aliasFor } : {}),
      record: { ...record, runDir },
    }),
  ];
}

async function agentStatements(store: RecordStore, dir: string): Promise<{ statements: SqlStatement[]; events: number }> {
  const summary = (await readJson<Record<string, unknown>>(path.join(dir, "summary.json"))) ?? {};
  const statements: SqlStatement[] = store.agentRunStatements({
    observationDir: dir,
    ...(typeof summary.runId === "string" ? { runId: summary.runId } : {}),
    ...(typeof summary.nodeId === "string" ? { nodeId: summary.nodeId } : {}),
    ...(typeof summary.startedAt === "string" ? { startedAt: summary.startedAt } : {}),
  });
  const files = (await listFilesRecursive(dir)).filter((file) => !/\.(ndjson|jsonl)$/.test(file));
  const ordered = [
    ...files.filter((file) => file === "input.json"),
    ...files.filter((file) => file !== "input.json" && file !== "summary.json"),
    ...files.filter((file) => file === "summary.json"),
  ];
  for (const relativePath of ordered) {
    const content = await captureArtifactContent(path.join(dir, relativePath));
    if (content.contentText === undefined) continue;
    statements.push(...store.agentFileStatements(dir, relativePath.split(path.sep).join("/"), content.contentText, typeof summary.startedAt === "string" ? { at: summary.startedAt } : {}));
  }
  const runEvents = (await readNdjson(path.join(dir, "run-events.ndjson"))) as Array<Record<string, unknown>>;
  const valid = runEvents.filter((event) => typeof event.seq === "number");
  statements.push(...store.agentRunEventStatements(dir, valid.map((event) => ({
    seq: event.seq as number,
    ...(typeof event.at === "string" ? { at: event.at } : {}),
    ...(typeof event.harness === "string" ? { harness: event.harness } : {}),
    ...(typeof event.kind === "string" ? { kind: event.kind } : {}),
    ...(typeof event.phase === "string" ? { phase: event.phase } : {}),
    ...(typeof event.itemId === "string" ? { itemId: event.itemId } : {}),
    ...(typeof event.summary === "string" ? { summary: event.summary } : {}),
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
  }))));
  if (/^(1|true|on)$/i.test(process.env.BAGELWERK_RECORDS_RAW ?? "")) {
    for (const file of (await listFilesRecursive(dir)).filter((name) => /\.ndjson$/.test(name) && !name.endsWith("run-events.ndjson"))) {
      const raw = await readNdjson(path.join(dir, file));
      statements.push(...store.agentRawEventStatements(dir, file, raw.map((payload, ord) => ({ ord, payload }))));
    }
  }
  return { statements, events: valid.length };
}

async function supervisorStatements(store: RecordStore, dir: string): Promise<SqlStatement[]> {
  const health = (await readJson<Record<string, unknown>>(path.join(dir, "health.json"))) ?? {};
  const report = {
    status: health.status,
    metrics: await readJson(path.join(dir, "metrics.json")),
    fragilitySignals: (await readJson<{ signals?: unknown }>(path.join(dir, "fragility-signals.json")))?.signals,
    recoveryAttempts: (await readJson<{ attempts?: unknown }>(path.join(dir, "recovery-attempts.json")))?.attempts,
    recommendations: (await readJson<{ recommendations?: unknown }>(path.join(dir, "remedy-recommendations.json")))?.recommendations,
  };
  const ledger = (await readNdjson(path.join(dir, "ledger.jsonl"))) as Array<Record<string, unknown>>;
  return store.supervisorStatements(dir, report as Record<string, unknown>, ledger, { keepExisting: true });
}
