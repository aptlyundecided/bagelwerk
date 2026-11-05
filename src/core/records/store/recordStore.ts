import { migrateRecords, appliedMigrationVersions, type MigrationOutcome } from "../schema/migrate";
import type { ReadOnlyQueryOptions, ReadOnlyQueryResult, SqlExecutor, SqlRow, SqlStatement } from "../sql/types";
import { searchDocStatements } from "./searchDocs";
import { pgJson, pgRawJson, pgSafeText, pgText, redactText, searchableJson, toLtree } from "./text";
import { runSearch, type RecordSearchHit, type RecordSearchQuery } from "./search";
import type { Embedder } from "../embeddings/embedder";

// ---------- write inputs ----------

export type FlowRunInput = {
  runDir: string;
  artifactRoot: string;
  sessionId: string;
  flowId: string;
  mode?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  runTree?: unknown;
};

export type NodeRunInput = {
  runDir: string;
  source?: "flow-runner" | "workbench";
  artifactRoot: string;
  sessionId: string;
  flowId?: string;
  nodePath: string;
  nodeId?: string;
  nodeType?: string;
  status?: string;
  note?: string;
  launchSnapshot?: unknown;
  result?: unknown;
  artifactExistence?: unknown;
  startedAt?: string;
  finishedAt?: string;
};

export type NodeArtifactInput = {
  relativePath: string;
  key?: string;
  label?: string;
  kind?: string;
  required?: boolean;
  present?: boolean;
  canonicalPath?: string;
  sha256?: string;
  bytes?: number;
  mediaType?: string;
  contentText?: string;
  observedAt?: string;
};

export type AcceptanceInput = {
  artifactRoot: string;
  sessionId: string;
  nodePath: string;
  runDir: string;
  aliasFor?: string;
  record: { acceptedAt: string; acceptedByKind?: string; acceptedById?: string; note?: string; runDir: string; [key: string]: unknown };
};

export type FlowEventInput = { ownerRunDir: string; ord: number; event: Record<string, unknown> };

export type AgentRunInput = {
  observationDir: string;
  runId?: string;
  nodeId?: string;
  nodeRunDir?: string;
  startedAt?: string;
};

export type AgentRunEventInput = {
  seq: number;
  at?: string;
  harness?: string;
  kind?: string;
  phase?: string;
  itemId?: string;
  summary?: string;
  detail?: unknown;
};

export type AcceptanceRow = {
  artifact_root: string;
  session_id: string;
  node_path: string;
  run_dir: string;
  alias_for: string | null;
  accepted_at: string;
  record: AcceptanceInput["record"];
};

export type NodeArtifactRow = {
  run_dir: string;
  relative_path: string;
  artifact_key: string | null;
  label: string | null;
  required: boolean | null;
  present: boolean | null;
  canonical_path: string | null;
  sha256: string | null;
  bytes: number | null;
  content_text: string | null;
};

const AGENT_FILE_NOT_INDEXED = new Set(["summary.json", "input.json", "output-schema.json", "agent-backend.json", "expected-output-artifacts.json"]);

function attemptFromRunDir(runDir: string): number | null {
  const match = /run-(\d+)\/?$/.exec(runDir.replace(/\\/g, "/"));
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/**
 * Bagelwerk's run-record system of record. Writes are exposed twice: as statement builders (so the
 * mirror and the ingester can batch many records into one transaction) and as direct async calls.
 */
export class RecordStore {
  private semanticAvailable: boolean | undefined;

  constructor(readonly executor: SqlExecutor) {}

  migrate(): Promise<MigrationOutcome[]> {
    this.semanticAvailable = undefined;
    return migrateRecords(this.executor);
  }

  async apply(statements: SqlStatement[]): Promise<void> {
    if (statements.length > 0) await this.executor.transaction(statements);
  }

  close(): Promise<void> {
    return this.executor.close();
  }

  // ---------- statement builders ----------

  flowRunStatements(input: FlowRunInput): SqlStatement[] {
    return [{
      sql: `INSERT INTO flow_runs (run_dir, artifact_root, session_id, flow_id, attempt, mode, status, started_at, finished_at, run_tree)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
            ON CONFLICT (run_dir) DO UPDATE SET
              mode = COALESCE(EXCLUDED.mode, flow_runs.mode), status = COALESCE(EXCLUDED.status, flow_runs.status),
              started_at = COALESCE(flow_runs.started_at, EXCLUDED.started_at), finished_at = COALESCE(flow_runs.finished_at, EXCLUDED.finished_at),
              run_tree = COALESCE(EXCLUDED.run_tree, flow_runs.run_tree), updated_at = now()`,
      params: [input.runDir, input.artifactRoot, input.sessionId, input.flowId, attemptFromRunDir(input.runDir), input.mode ?? null, input.status ?? null, input.startedAt ?? null, input.finishedAt ?? null, pgJson(input.runTree)],
    }];
  }

  /**
   * A run directory can be reused (session dir or runs/.counter deleted, numbering restarts at run-001).
   * Called when a new run begins there, so the old run's artifacts, events and docs cannot leak into it.
   */
  resetNodeRunStatements(runDir: string): SqlStatement[] {
    return [
      { sql: "DELETE FROM node_artifacts WHERE run_dir = $1", params: [runDir] },
      { sql: "DELETE FROM flow_events WHERE owner_run_dir = $1", params: [runDir] },
      { sql: "DELETE FROM search_docs WHERE run_dir = $1 AND source_kind IN ('node_run', 'node_artifact', 'flow_event')", params: [runDir] },
      { sql: "DELETE FROM node_runs WHERE run_dir = $1", params: [runDir] },
      // Acceptances of the previous occupant must not survive: they would now describe the new run.
      { sql: "UPDATE acceptances SET is_current = false, withdrawn_at = now() WHERE run_dir = $1 AND withdrawn_at IS NULL", params: [runDir] },
      {
        sql: `UPDATE acceptances SET is_current = true WHERE id IN (
                SELECT DISTINCT ON (x.artifact_root, x.session_id, x.node_path) x.id FROM acceptances x
                WHERE x.withdrawn_at IS NULL
                  AND (x.artifact_root, x.session_id, x.node_path) IN (SELECT artifact_root, session_id, node_path FROM acceptances WHERE run_dir = $1)
                  AND NOT EXISTS (SELECT 1 FROM acceptances c WHERE c.is_current AND c.artifact_root = x.artifact_root AND c.session_id = x.session_id AND c.node_path = x.node_path)
                ORDER BY x.artifact_root, x.session_id, x.node_path, x.accepted_at DESC, x.id DESC)`,
        params: [runDir],
      },
    ];
  }

  nodeRunStatements(input: NodeRunInput): SqlStatement[] {
    const statements: SqlStatement[] = [{
      sql: `INSERT INTO node_runs (run_dir, source, artifact_root, session_id, flow_id, node_path, node_path_ltree, node_id, node_type, attempt, status, note, launch_snapshot, result, artifact_existence, started_at, finished_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7::ltree, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17)
            ON CONFLICT (run_dir) DO UPDATE SET
              flow_id = COALESCE(EXCLUDED.flow_id, node_runs.flow_id), node_id = COALESCE(EXCLUDED.node_id, node_runs.node_id),
              node_type = COALESCE(EXCLUDED.node_type, node_runs.node_type), status = COALESCE(EXCLUDED.status, node_runs.status),
              note = COALESCE(EXCLUDED.note, node_runs.note), launch_snapshot = COALESCE(EXCLUDED.launch_snapshot, node_runs.launch_snapshot),
              result = COALESCE(EXCLUDED.result, node_runs.result), artifact_existence = COALESCE(EXCLUDED.artifact_existence, node_runs.artifact_existence),
              started_at = COALESCE(node_runs.started_at, EXCLUDED.started_at), finished_at = COALESCE(node_runs.finished_at, EXCLUDED.finished_at),
              updated_at = now()`,
      params: [
        input.runDir, input.source ?? "flow-runner", input.artifactRoot, input.sessionId, input.flowId ?? null, input.nodePath, toLtree(input.nodePath),
        input.nodeId ?? null, input.nodeType ?? null, attemptFromRunDir(input.runDir), input.status ?? null, pgSafeText(input.note ?? null),
        pgJson(input.launchSnapshot), pgJson(input.result), pgJson(input.artifactExistence), input.startedAt ?? null, input.finishedAt ?? null,
      ],
    }];
    if (input.status && input.status !== "running") {
      const snapshot = input.launchSnapshot as { nodeName?: string; nodeDescription?: string; params?: unknown } | undefined;
      statements.push(...searchDocStatements({
        sourceKind: "node_run",
        sourceKey: input.runDir,
        title: `node ${input.nodePath} ${input.status}`,
        body: [input.note, snapshot?.nodeName, snapshot?.nodeDescription, searchableJson(snapshot?.params, 4000), searchableJson(input.result, 24_000)].filter(Boolean).join("\n"),
        at: input.finishedAt ?? input.startedAt ?? null,
        sessionId: input.sessionId,
        nodePath: input.nodePath,
        runDir: input.runDir,
        meta: { status: input.status, nodeType: input.nodeType, source: input.source ?? "flow-runner" },
      }));
    }
    return statements;
  }

  /** `ifMissing`: only fill rows that do not exist yet (backfill from accepted/ copies must not overwrite a run's own record). */
  nodeArtifactStatements(runDir: string, artifacts: NodeArtifactInput[], context: { sessionId?: string; nodePath?: string; ifMissing?: boolean } = {}): SqlStatement[] {
    const statements: SqlStatement[] = [];
    for (const artifact of artifacts) {
      statements.push({
        sql: `INSERT INTO node_artifacts (run_dir, relative_path, artifact_key, label, kind, required, present, canonical_path, sha256, bytes, media_type, content_text, observed_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (run_dir, relative_path) ${context.ifMissing ? "DO NOTHING" : `DO UPDATE SET
                artifact_key = COALESCE(EXCLUDED.artifact_key, node_artifacts.artifact_key), label = COALESCE(EXCLUDED.label, node_artifacts.label),
                kind = COALESCE(EXCLUDED.kind, node_artifacts.kind), required = COALESCE(EXCLUDED.required, node_artifacts.required),
                present = COALESCE(EXCLUDED.present, node_artifacts.present), canonical_path = COALESCE(EXCLUDED.canonical_path, node_artifacts.canonical_path),
                sha256 = COALESCE(EXCLUDED.sha256, node_artifacts.sha256), bytes = COALESCE(EXCLUDED.bytes, node_artifacts.bytes),
                media_type = COALESCE(EXCLUDED.media_type, node_artifacts.media_type), content_text = COALESCE(EXCLUDED.content_text, node_artifacts.content_text),
                observed_at = COALESCE(EXCLUDED.observed_at, node_artifacts.observed_at)`}`,
        params: [
          runDir, artifact.relativePath, artifact.key ?? null, artifact.label ?? null, artifact.kind ?? null, artifact.required ?? null, artifact.present ?? null,
          artifact.canonicalPath ?? null, artifact.sha256 ?? null, artifact.bytes ?? null, artifact.mediaType ?? null, pgText(artifact.contentText ?? null), artifact.observedAt ?? null,
        ],
      });
      if (artifact.contentText && !context.ifMissing) {
        statements.push(...searchDocStatements({
          sourceKind: "node_artifact",
          sourceKey: `${runDir}#${artifact.relativePath}`,
          title: `${artifact.label ?? artifact.relativePath} (${context.nodePath ?? "node"})`,
          body: artifact.contentText,
          at: artifact.observedAt ?? null,
          sessionId: context.sessionId ?? null,
          nodePath: context.nodePath ?? null,
          runDir,
          meta: { relativePath: artifact.relativePath, kind: artifact.kind },
        }));
      }
    }
    return statements;
  }

  acceptanceStatements(input: AcceptanceInput): SqlStatement[] {
    const key = [input.artifactRoot, input.sessionId, input.nodePath];
    return [
      // Serialise concurrent acceptances of one Node on real Postgres (READ COMMITTED); a no-op cost on PGlite.
      { sql: "SELECT pg_advisory_xact_lock(hashtext($1 || '|' || $2 || '|' || $3))", params: key },
      {
        sql: `INSERT INTO acceptances (artifact_root, session_id, node_path, run_dir, alias_for, accepted_at, by_kind, by_id, note, record)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
              ON CONFLICT (artifact_root, session_id, node_path, run_dir, accepted_at) DO NOTHING`,
        params: [...key, input.runDir, input.aliasFor ?? null, input.record.acceptedAt, input.record.acceptedByKind ?? null, input.record.acceptedById ?? null, pgSafeText(input.record.note ?? null), pgRawJson(input.record)],
      },
      { sql: "UPDATE acceptances SET is_current = false WHERE artifact_root = $1 AND session_id = $2 AND node_path = $3 AND is_current", params: key },
      {
        sql: `UPDATE acceptances SET is_current = true WHERE id = (
                SELECT id FROM acceptances WHERE artifact_root = $1 AND session_id = $2 AND node_path = $3 AND withdrawn_at IS NULL
                ORDER BY accepted_at DESC, id DESC LIMIT 1)`,
        params: key,
      },
    ];
  }

  /** Withdraw acceptances (all Nodes of a session when nodePath is omitted). Re-accepting a run makes it current again. */
  unacceptStatements(artifactRoot: string, sessionId: string, nodePath?: string): SqlStatement[] {
    return nodePath
      ? [{ sql: "UPDATE acceptances SET is_current = false, withdrawn_at = now() WHERE artifact_root = $1 AND session_id = $2 AND (node_path = $3 OR alias_for = $3)", params: [artifactRoot, sessionId, nodePath] }]
      : [{ sql: "UPDATE acceptances SET is_current = false, withdrawn_at = now() WHERE artifact_root = $1 AND session_id = $2", params: [artifactRoot, sessionId] }];
  }

  flowEventStatements(events: FlowEventInput[]): SqlStatement[] {
    const statements: SqlStatement[] = [];
    for (const { ownerRunDir, ord, event } of events) {
      const type = String(event.type ?? "unknown");
      const nodePath = typeof event.qualifiedNodePath === "string" ? event.qualifiedNodePath : undefined;
      const at = typeof event.at === "string" ? event.at : null;
      const sessionId = typeof event.sessionId === "string" ? event.sessionId : null;
      const dedupeKey = `${ownerRunDir}#${ord}`;
      statements.push({
        sql: `INSERT INTO flow_events (dedupe_key, owner_run_dir, ord, session_id, flow_id, node_path, type, at, payload)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) ON CONFLICT (dedupe_key) DO NOTHING`,
        params: [dedupeKey, ownerRunDir, ord, sessionId, typeof event.flowId === "string" ? event.flowId : null, nodePath ?? null, type, at, pgJson(event)],
      });
      // Flow-level event lists repeat their Nodes' events; those are indexed under the Node run already.
      const forwardedNodeEvent = /[\\/]__flow__[\\/]/.test(ownerRunDir) && (type.startsWith("node-") || type === "artifact-observed" || type === "accepted" || type === "child-event");
      if (forwardedNodeEvent) continue;
      // Index the events that carry meaning beyond structure: failures, notes, progress messages.
      const progress = event.progress as { message?: string; reason?: string } | undefined;
      const text = [event.note, event.disposition, progress?.message, progress?.reason, type.includes("failure") || event.status === "failed" ? `${type} ${event.status ?? ""}` : undefined]
        .filter((value) => typeof value === "string" && value.trim()) as string[];
      if (text.length > 0) {
        statements.push(...searchDocStatements({
          sourceKind: "flow_event",
          sourceKey: dedupeKey,
          title: `${type}${nodePath ? ` ${nodePath}` : ""}`,
          body: text.join("\n"),
          at,
          sessionId,
          nodePath: nodePath ?? null,
          runDir: ownerRunDir,
          meta: { type, status: event.status },
        }));
      }
    }
    return statements;
  }

  agentRunStatements(input: AgentRunInput): SqlStatement[] {
    return [{
      sql: `INSERT INTO agent_runs (observation_dir, run_id, node_id, node_run_dir, started_at, status)
            VALUES ($1, $2, $3, $4, $5, 'running')
            ON CONFLICT (observation_dir) DO UPDATE SET
              run_id = COALESCE(EXCLUDED.run_id, agent_runs.run_id), node_id = COALESCE(EXCLUDED.node_id, agent_runs.node_id),
              node_run_dir = COALESCE(EXCLUDED.node_run_dir, agent_runs.node_run_dir), started_at = COALESCE(agent_runs.started_at, EXCLUDED.started_at),
              updated_at = now()`,
      params: [input.observationDir, input.runId ?? null, input.nodeId ?? null, input.nodeRunDir ?? null, input.startedAt ?? null],
    }];
  }

  agentFileStatements(observationDir: string, relativePath: string, content: string, context: { at?: string } = {}): SqlStatement[] {
    const text = pgSafeText(content) ?? "";
    const statements: SqlStatement[] = [{
      sql: `INSERT INTO agent_files (observation_dir, relative_path, content, bytes) VALUES ($1, $2, $3, $4)
            ON CONFLICT (observation_dir, relative_path) DO UPDATE SET content = EXCLUDED.content, bytes = EXCLUDED.bytes, updated_at = now()`,
      params: [observationDir, relativePath, text, Buffer.byteLength(text)],
    }];
    const base = relativePath.split("/").pop() ?? relativePath;
    if (base === "prompt.md") {
      statements.push({ sql: "UPDATE agent_runs SET prompt = $2, updated_at = now() WHERE observation_dir = $1", params: [observationDir, text] });
    }
    if (base === "input.json") {
      const input = safeJson(text) as { harness?: string; model?: string; cwd?: string } | undefined;
      if (input) {
        statements.push({
          sql: `UPDATE agent_runs SET input = $2::jsonb, harness = COALESCE($3, harness), model = COALESCE($4, model), cwd = COALESCE($5, cwd), updated_at = now() WHERE observation_dir = $1`,
          params: [observationDir, pgJson(input), stringOrNull(input.harness), stringOrNull(input.model), stringOrNull(input.cwd)],
        });
      }
    }
    if (base === "summary.json") {
      const summary = safeJson(text) as Record<string, unknown> | undefined;
      if (summary) statements.push(...this.agentSummaryStatements(observationDir, summary));
    }
    if (!AGENT_FILE_NOT_INDEXED.has(base) && text.trim()) {
      statements.push(
        ...searchDocStatements({
          sourceKind: base === "prompt.md" ? "agent_prompt" : "agent_file",
          sourceKey: `${observationDir}#${relativePath}`,
          title: `${base} (${observationDir.split(/[\\/]/).slice(-1)[0]})`,
          body: text,
          at: context.at ?? null,
          observationDir,
          meta: { relativePath },
        }),
      );
      // Fill harness/session context on the docs from the run row once known.
      statements.push({
        sql: `UPDATE search_docs d SET harness = COALESCE(d.harness, r.harness), run_dir = COALESCE(d.run_dir, r.node_run_dir), at = COALESCE(d.at, r.started_at)
              FROM agent_runs r WHERE r.observation_dir = $1 AND d.source_key = $2`,
        params: [observationDir, `${observationDir}#${relativePath}`],
      });
    }
    return statements;
  }

  private agentSummaryStatements(observationDir: string, summary: Record<string, unknown>): SqlStatement[] {
    const usage = summary.usage ?? summary.tokenUsage ?? summary.tokens;
    const cost = typeof summary.costUsd === "number" ? summary.costUsd : typeof summary.totalCostUsd === "number" ? summary.totalCostUsd : null;
    const executionStatus = stringOrNull(summary.executionStatus);
    return [{
      sql: `UPDATE agent_runs SET summary = $2::jsonb,
              status = COALESCE($3, status), quality_status = COALESCE($4, quality_status), error_message = COALESCE($5, error_message),
              usage = COALESCE($6::jsonb, usage), cost_usd = COALESCE($7, cost_usd), harness = COALESCE($8, harness), model = COALESCE($9, model),
              started_at = COALESCE(started_at, $10), finished_at = COALESCE($11, finished_at),
              run_id = COALESCE(run_id, $12), node_id = COALESCE(node_id, $13), updated_at = now()
            WHERE observation_dir = $1`,
      params: [
        observationDir, pgJson(summary), executionStatus, stringOrNull(summary.qualityStatus), pgSafeText(stringOrNull(summary.errorMessage)),
        pgJson(usage), cost, stringOrNull(summary.harness), stringOrNull(summary.model), stringOrNull(summary.startedAt), stringOrNull(summary.finishedAt),
        stringOrNull(summary.runId), stringOrNull(summary.nodeId),
      ],
    }];
  }

  agentRunEventStatements(observationDir: string, events: AgentRunEventInput[]): SqlStatement[] {
    const statements: SqlStatement[] = [];
    for (const event of events) {
      statements.push({
        sql: `INSERT INTO agent_run_events (observation_dir, seq, at, harness, kind, phase, item_id, summary, detail)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) ON CONFLICT (observation_dir, seq) DO NOTHING`,
        params: [observationDir, event.seq, event.at ?? null, event.harness ?? null, event.kind ?? null, event.phase ?? null, event.itemId ?? null, pgSafeText(event.summary ?? null), pgJson(event.detail)],
      });
      if (event.harness) {
        statements.push({ sql: "UPDATE agent_runs SET harness = COALESCE(harness, $2) WHERE observation_dir = $1 AND harness IS NULL", params: [observationDir, event.harness] });
      }
      if (event.kind === "usage") continue;
      const body = [event.summary, searchableJson(event.detail, 8000)].filter(Boolean).join("\n");
      if (!body.trim()) continue;
      statements.push(...searchDocStatements({
        sourceKind: "agent_event",
        sourceKey: `${observationDir}#${event.seq}`,
        title: `${event.harness ?? "agent"} ${event.kind ?? "event"}${event.phase ? ` ${event.phase}` : ""}`,
        body,
        at: event.at ?? null,
        harness: event.harness ?? null,
        observationDir,
        meta: { kind: event.kind, phase: event.phase, seq: event.seq },
      }));
    }
    return statements;
  }

  agentRawEventStatements(observationDir: string, file: string, events: Array<{ ord: number; payload: unknown }>): SqlStatement[] {
    return events.map(({ ord, payload }) => ({
      sql: "INSERT INTO agent_raw_events (observation_dir, file, ord, at, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING",
      params: [observationDir, file, ord, stringOrNull((payload as { at?: unknown } | null)?.at), pgJson(payload) ?? "null"],
    }));
  }

  /** `keepExisting`: backfill from files must not replace the richer report the live mirror wrote. */
  supervisorStatements(rootDir: string, report: Record<string, unknown>, ledger: Array<Record<string, unknown>>, options: { keepExisting?: boolean } = {}): SqlStatement[] {
    const statements: SqlStatement[] = [{
      sql: `INSERT INTO supervisor_reports (root_dir, session_id, flow_id, status, report) VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (root_dir) ${options.keepExisting ? "DO NOTHING" : "DO UPDATE SET report = EXCLUDED.report, status = EXCLUDED.status, at = now()"}`,
      params: [rootDir, stringOrNull(report.sessionId), stringOrNull(report.flowId), stringOrNull(report.status), pgJson(report)],
    }];
    ledger.forEach((entry, ord) => {
      statements.push({
        sql: "INSERT INTO supervisor_ledger (root_dir, ord, at, type, message, entry) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING",
        params: [rootDir, ord, stringOrNull(entry.at), stringOrNull(entry.type), pgSafeText(stringOrNull(entry.message)), pgJson(entry)],
      });
    });
    const remedies = searchableJson((report as { recommendations?: unknown }).recommendations, 8000);
    const signals = searchableJson((report as { fragilitySignals?: unknown }).fragilitySignals, 8000);
    statements.push(...searchDocStatements({
      sourceKind: "supervisor",
      sourceKey: rootDir,
      title: `supervisor ${stringOrNull(report.flowId) ?? ""} ${stringOrNull(report.status) ?? ""}`.trim(),
      body: [ledger.map((entry) => entry.message).filter(Boolean).join("\n"), signals, remedies].filter(Boolean).join("\n"),
      sessionId: stringOrNull(report.sessionId),
    }));
    return statements;
  }

  // ---------- reads ----------

  async getCurrentAcceptance(artifactRoot: string, sessionId: string, nodePath: string): Promise<AcceptanceRow | undefined> {
    const rows = await this.executor.query<AcceptanceRow>(
      "SELECT artifact_root, session_id, node_path, run_dir, alias_for, accepted_at, record FROM acceptances WHERE artifact_root = $1 AND session_id = $2 AND node_path = $3 AND is_current",
      [artifactRoot, sessionId, nodePath],
    );
    return rows[0];
  }

  /** True when this exact acceptance was withdrawn (`records unaccept`), so it must not be healed back. */
  async isAcceptanceWithdrawn(artifactRoot: string, sessionId: string, nodePath: string, runDir: string, acceptedAt?: string): Promise<boolean> {
    const rows = await this.executor.query<{ accepted_at: string }>(
      "SELECT accepted_at FROM acceptances WHERE artifact_root = $1 AND session_id = $2 AND node_path = $3 AND run_dir = $4 AND withdrawn_at IS NOT NULL",
      [artifactRoot, sessionId, nodePath, runDir],
    );
    return rows.some((row) => !acceptedAt || Date.parse(row.accepted_at) === Date.parse(acceptedAt));
  }

  listCurrentAcceptances(artifactRoot: string, sessionId: string): Promise<AcceptanceRow[]> {
    return this.executor.query<AcceptanceRow>(
      "SELECT artifact_root, session_id, node_path, run_dir, alias_for, accepted_at, record FROM acceptances WHERE artifact_root = $1 AND session_id = $2 AND is_current ORDER BY node_path",
      [artifactRoot, sessionId],
    );
  }

  listNodeArtifacts(runDir: string): Promise<NodeArtifactRow[]> {
    return this.executor.query<NodeArtifactRow>(
      "SELECT run_dir, relative_path, artifact_key, label, required, present, canonical_path, sha256, bytes, content_text FROM node_artifacts WHERE run_dir = $1 ORDER BY relative_path",
      [runDir],
    );
  }

  async getNodeRun(runDir: string): Promise<SqlRow | undefined> {
    const [run] = await this.executor.query("SELECT * FROM node_runs WHERE run_dir = $1", [runDir]);
    if (!run) return undefined;
    const artifacts = (await this.executor.query<{ content_preview: string | null }>(
      "SELECT relative_path, label, kind, present, bytes, sha256, left(content_text, 2000) AS content_preview FROM node_artifacts WHERE run_dir = $1 ORDER BY relative_path",
      [runDir],
    )).map((row) => ({ ...row, content_preview: row.content_preview === null ? null : redactText(row.content_preview) }));
    const agentRuns = await this.executor.query("SELECT observation_dir, harness, model, status, started_at, finished_at FROM agent_runs WHERE node_run_dir = $1 ORDER BY started_at", [runDir]);
    const events = await this.executor.query("SELECT ord, type, at, payload FROM flow_events WHERE owner_run_dir = $1 ORDER BY ord", [runDir]);
    return { ...run, artifacts, agentRuns, events };
  }

  async getAgentRun(observationDir: string, options: { afterSeq?: number; limit?: number } = {}): Promise<SqlRow | undefined> {
    const [run] = await this.executor.query("SELECT * FROM agent_runs WHERE observation_dir = $1", [observationDir]);
    if (!run) return undefined;
    const events = await this.executor.query(
      "SELECT seq, at, kind, phase, item_id, summary, detail FROM agent_run_events WHERE observation_dir = $1 AND seq > $2 ORDER BY seq LIMIT $3",
      [observationDir, options.afterSeq ?? 0, Math.min(Math.max(options.limit ?? 200, 1), 2000)],
    );
    const files = await this.executor.query("SELECT relative_path, bytes, updated_at FROM agent_files WHERE observation_dir = $1 ORDER BY relative_path", [observationDir]);
    return { ...run, files, events };
  }

  async listRuns(filter: { kind?: "agent" | "node" | "flow"; sessionId?: string; status?: string; harness?: string; since?: string; limit?: number } = {}): Promise<SqlRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const kind = filter.kind ?? "agent";
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (filter.status) add("status = ?", filter.status);
    if (filter.since) add("started_at >= ?", filter.since);
    if (kind === "agent") {
      if (filter.harness) add("harness = ?", filter.harness);
      params.push(limit);
      return this.executor.query(
        `SELECT observation_dir, run_id, node_id, node_run_dir, harness, model, status, quality_status, error_message, cost_usd, usage, started_at, finished_at
         FROM agent_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC NULLS LAST LIMIT $${params.length}`,
        params,
      );
    }
    if (filter.sessionId) add("session_id = ?", filter.sessionId);
    params.push(limit);
    const table = kind === "node" ? "node_runs" : "flow_runs";
    const columns = kind === "node"
      ? "run_dir, source, artifact_root, session_id, flow_id, node_path, node_id, node_type, attempt, status, note, started_at, finished_at"
      : "run_dir, artifact_root, session_id, flow_id, attempt, mode, status, started_at, finished_at";
    return this.executor.query(`SELECT ${columns} FROM ${table} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC NULLS LAST LIMIT $${params.length}`, params);
  }

  async stats(): Promise<Record<string, number | string | boolean>> {
    const tables = ["flow_runs", "node_runs", "node_artifacts", "acceptances", "flow_events", "agent_runs", "agent_run_events", "agent_raw_events", "agent_files", "supervisor_reports", "search_docs"];
    const out: Record<string, number | string | boolean> = { executor: this.executor.kind };
    for (const table of tables) {
      const [row] = await this.executor.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      out[table] = row?.n ?? 0;
    }
    out.semantic = await this.isSemanticAvailable();
    if (out.semantic) {
      const [row] = await this.executor.query<{ n: number }>("SELECT count(*)::int AS n FROM search_embeddings");
      out.search_embeddings = row?.n ?? 0;
    }
    try {
      const [size] = await this.executor.query<{ size: string }>("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
      if (size) out.database_size = size.size;
    } catch {
      // not permitted on some servers
    }
    return out;
  }

  readOnlyQuery<T = SqlRow>(sql: string, params: unknown[] = [], options: ReadOnlyQueryOptions = {}): Promise<ReadOnlyQueryResult<T>> {
    return this.executor.readOnlyQuery<T>(sql, params, options);
  }

  async isSemanticAvailable(): Promise<boolean> {
    if (this.semanticAvailable === undefined) this.semanticAvailable = (await appliedMigrationVersions(this.executor)).has(2);
    return this.semanticAvailable;
  }

  async search(query: RecordSearchQuery, embedder?: Embedder): Promise<RecordSearchHit[]> {
    return runSearch(this, query, embedder);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
