import { vectorLiteral, type Embedder } from "../embeddings/embedder";
import type { RecordStore } from "./recordStore";
import type { SearchSourceKind } from "./searchDocs";
import { toLtree } from "./text";

export type RecordSearchMode = "text" | "fuzzy" | "semantic" | "hybrid";

export type RecordSearchQuery = {
  query: string;
  /**
   * text: Postgres full-text (stemmed words, websearch syntax: "quoted phrase", -exclude, or).
   * fuzzy: substring match, good for error strings, paths, ids, commands.
   * semantic: vector similarity (needs embeddings).
   * hybrid: text + semantic fused by reciprocal rank (falls back to text when no embeddings).
   */
  mode?: RecordSearchMode;
  kinds?: SearchSourceKind[];
  sessionId?: string;
  /** Node path prefix, e.g. "flowA.lane2" matches everything beneath it. */
  nodePath?: string;
  harness?: string;
  observationDir?: string;
  runDir?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type RecordSearchHit = {
  id: number;
  sourceKind: string;
  sourceKey: string;
  chunk: number;
  title: string | null;
  snippet: string;
  score: number;
  at: string | null;
  sessionId: string | null;
  nodePath: string | null;
  harness: string | null;
  observationDir: string | null;
  runDir: string | null;
  matchedBy: RecordSearchMode[];
};

type Row = {
  id: number;
  source_kind: string;
  source_key: string;
  chunk: number;
  title: string | null;
  snippet: string | null;
  score: number;
  at: string | null;
  session_id: string | null;
  node_path: string | null;
  harness: string | null;
  observation_dir: string | null;
  run_dir: string | null;
};

const COLUMNS = "d.id, d.source_kind, d.source_key, d.chunk, d.title, d.at, d.session_id, d.node_path, d.harness, d.observation_dir, d.run_dir";

function buildFilters(query: RecordSearchQuery, params: unknown[]): string[] {
  const where: string[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace(/\?/g, `$${params.length}`));
  };
  if (query.kinds?.length) add("d.source_kind = ANY(?::text[])", query.kinds);
  if (query.sessionId) add("d.session_id = ?", query.sessionId);
  if (query.nodePath) add("d.node_path_ltree <@ ?::ltree", toLtree(query.nodePath));
  if (query.harness) add("d.harness = ?", query.harness);
  if (query.observationDir) add("d.observation_dir = ?", query.observationDir);
  if (query.runDir) add("d.run_dir = ?", query.runDir);
  if (query.since) add("d.at >= ?", query.since);
  if (query.until) add("d.at < ?", query.until);
  return where;
}

function toHit(row: Row, mode: RecordSearchMode): RecordSearchHit {
  return {
    id: Number(row.id),
    sourceKind: row.source_kind,
    sourceKey: row.source_key,
    chunk: row.chunk,
    title: row.title,
    snippet: (row.snippet ?? "").replace(/\s+/g, " ").trim(),
    score: Number(row.score),
    at: row.at,
    sessionId: row.session_id,
    nodePath: row.node_path,
    harness: row.harness,
    observationDir: row.observation_dir,
    runDir: row.run_dir,
    matchedBy: [mode],
  };
}

async function textSearch(store: RecordStore, query: RecordSearchQuery, limit: number): Promise<RecordSearchHit[]> {
  const params: unknown[] = [query.query];
  const where = ["d.tsv @@ q.q", ...buildFilters(query, params)];
  params.push(limit);
  const rows = await store.executor.query<Row>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS q),
     top AS (
       SELECT ${COLUMNS}, d.body, ts_rank_cd(d.tsv, q.q, 32) AS score
       FROM search_docs d, q WHERE ${where.join(" AND ")}
       ORDER BY score DESC, d.at DESC NULLS LAST LIMIT $${params.length}
     )
     SELECT top.id, top.source_kind, top.source_key, top.chunk, top.title, top.at, top.session_id, top.node_path, top.harness, top.observation_dir, top.run_dir, top.score,
            ts_headline('english', top.body, q.q, 'MaxFragments=2, MinWords=6, MaxWords=24, StartSel=«, StopSel=»') AS snippet
     FROM top, q ORDER BY top.score DESC, top.at DESC NULLS LAST`,
    params,
  );
  return rows.map((row) => toHit(row, "text"));
}

async function fuzzySearch(store: RecordStore, query: RecordSearchQuery, limit: number): Promise<RecordSearchHit[]> {
  const needle = query.query.trim();
  const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const params: unknown[] = [pattern, needle];
  const where = ["(d.body ILIKE $1 OR d.title ILIKE $1)", ...buildFilters(query, params)];
  params.push(limit);
  const rows = await store.executor.query<Row>(
    `SELECT ${COLUMNS},
            similarity(coalesce(d.title, ''), $2) + 0.5 AS score,
            substr(d.body, greatest(1, strpos(lower(d.body), lower($2)) - 120), 320) AS snippet
     FROM search_docs d WHERE ${where.join(" AND ")}
     ORDER BY d.at DESC NULLS LAST, d.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => toHit(row, "fuzzy"));
}

async function semanticSearch(store: RecordStore, query: RecordSearchQuery, limit: number, embedder: Embedder): Promise<RecordSearchHit[]> {
  if (!(await store.isSemanticAvailable())) return [];
  const [vector] = await embedder.embed([query.query]);
  const params: unknown[] = [vectorLiteral(vector!), embedder.model];
  const where = ["e.model = $2", ...buildFilters(query, params)];
  params.push(limit);
  const rows = await store.executor.query<Row>(
    `SELECT ${COLUMNS}, 1 - (e.embedding <=> $1::vector) AS score, left(d.body, 320) AS snippet
     FROM search_embeddings e JOIN search_docs d ON d.id = e.doc_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.embedding <=> $1::vector LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => toHit(row, "semantic"));
}

/** Reciprocal-rank fusion: robust to the two scorers living on different scales. */
function fuse(lists: RecordSearchHit[][], limit: number): RecordSearchHit[] {
  const k = 60;
  const merged = new Map<number, RecordSearchHit>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const existing = merged.get(hit.id);
      const contribution = 1 / (k + rank + 1);
      if (existing) {
        existing.score += contribution;
        existing.matchedBy = [...new Set([...existing.matchedBy, ...hit.matchedBy])];
        if (hit.matchedBy.includes("text")) existing.snippet = hit.snippet;
      } else {
        merged.set(hit.id, { ...hit, score: contribution });
      }
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function runSearch(store: RecordStore, query: RecordSearchQuery, embedder?: Embedder): Promise<RecordSearchHit[]> {
  if (!query.query?.trim()) throw new Error("search query is empty");
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
  const mode = query.mode ?? (embedder ? "hybrid" : "text");
  switch (mode) {
    case "text":
      return textSearch(store, query, limit);
    case "fuzzy":
      return fuzzySearch(store, query, limit);
    case "semantic":
      if (!embedder) throw new Error("semantic search needs an embedder (BAGELWERK_EMBEDDINGS)");
      return semanticSearch(store, query, limit, embedder);
    case "hybrid": {
      const [text, semantic] = await Promise.all([
        textSearch(store, query, Math.max(limit * 2, 40)),
        embedder ? semanticSearch(store, query, Math.max(limit * 2, 40), embedder) : Promise.resolve([]),
      ]);
      const fused = fuse([text, semantic], limit);
      if (fused.length > 0) return fused;
      return fuzzySearch(store, query, limit);
    }
    default:
      throw new Error(`unknown search mode '${String(mode)}'`);
  }
}
