import type { SqlStatement } from "../sql/types";
import { chunkText, pgJson, pgSafeText, sha1, toLtree } from "./text";

export type SearchSourceKind =
  | "agent_prompt"
  | "agent_file"
  | "agent_event"
  | "node_run"
  | "node_artifact"
  | "flow_event"
  | "supervisor";

export const SEARCH_SOURCE_KINDS: SearchSourceKind[] = ["agent_prompt", "agent_file", "agent_event", "node_run", "node_artifact", "flow_event", "supervisor"];

export type SearchDocInput = {
  sourceKind: SearchSourceKind;
  sourceKey: string;
  title?: string;
  body: string;
  at?: string | null;
  sessionId?: string | null;
  nodePath?: string | null;
  harness?: string | null;
  observationDir?: string | null;
  runDir?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Upserts a document's chunks and drops chunks beyond the new count. Unchanged chunks keep their id and
 * body_hash, so their embeddings stay valid.
 */
export function searchDocStatements(doc: SearchDocInput): SqlStatement[] {
  const chunks = chunkText(pgSafeText(doc.body) ?? "");
  const statements: SqlStatement[] = chunks.map((body, chunk) => ({
    sql: `INSERT INTO search_docs (source_kind, source_key, chunk, title, body, body_hash, at, session_id, node_path, node_path_ltree, harness, observation_dir, run_dir, meta)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::ltree, $11, $12, $13, $14::jsonb)
          ON CONFLICT (source_kind, source_key, chunk) DO UPDATE SET
            title = EXCLUDED.title, body = EXCLUDED.body, body_hash = EXCLUDED.body_hash, at = COALESCE(EXCLUDED.at, search_docs.at),
            session_id = COALESCE(EXCLUDED.session_id, search_docs.session_id), node_path = COALESCE(EXCLUDED.node_path, search_docs.node_path),
            node_path_ltree = COALESCE(EXCLUDED.node_path_ltree, search_docs.node_path_ltree), harness = COALESCE(EXCLUDED.harness, search_docs.harness),
            observation_dir = COALESCE(EXCLUDED.observation_dir, search_docs.observation_dir), run_dir = COALESCE(EXCLUDED.run_dir, search_docs.run_dir),
            meta = COALESCE(EXCLUDED.meta, search_docs.meta)
          WHERE search_docs.body_hash IS DISTINCT FROM EXCLUDED.body_hash OR search_docs.at IS DISTINCT FROM EXCLUDED.at`,
    params: [
      doc.sourceKind,
      doc.sourceKey,
      chunk,
      pgSafeText(doc.title ?? null),
      body,
      sha1(body),
      doc.at ?? null,
      doc.sessionId ?? null,
      doc.nodePath ?? null,
      toLtree(doc.nodePath),
      doc.harness ?? null,
      doc.observationDir ?? null,
      doc.runDir ?? null,
      pgJson(doc.meta),
    ],
  }));
  statements.push({
    sql: "DELETE FROM search_docs WHERE source_kind = $1 AND source_key = $2 AND chunk >= $3",
    params: [doc.sourceKind, doc.sourceKey, chunks.length],
  });
  return statements;
}
