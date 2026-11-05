import type { RecordStore } from "../store/recordStore";
import { vectorLiteral, type Embedder } from "./embedder";

export type EmbedRunResult = { model: string; embedded: number; remaining: number; skippedReason?: string };

/** Embeds docs that have no vector for this model, or whose body changed since. Safe to run repeatedly. */
export async function embedPendingDocs(store: RecordStore, embedder: Embedder, options: { limit?: number; batchSize?: number } = {}): Promise<EmbedRunResult> {
  if (!(await store.isSemanticAvailable())) {
    return { model: embedder.model, embedded: 0, remaining: 0, skippedReason: "pgvector not available (migration 2 skipped)" };
  }
  const limit = Math.max(1, options.limit ?? 2000);
  const batchSize = Math.max(1, options.batchSize ?? 64);
  let embedded = 0;
  while (embedded < limit) {
    const docs = await store.executor.query<{ id: number; title: string | null; body: string; body_hash: string }>(
      `SELECT d.id, d.title, d.body, d.body_hash FROM search_docs d
       LEFT JOIN search_embeddings e ON e.doc_id = d.id AND e.model = $1
       WHERE e.doc_id IS NULL OR e.body_hash <> d.body_hash
       ORDER BY d.id LIMIT $2`,
      [embedder.model, Math.min(batchSize, limit - embedded)],
    );
    if (docs.length === 0) break;
    const vectors = await embedder.embed(docs.map((doc) => `${doc.title ?? ""}\n${doc.body}`));
    await store.apply(docs.map((doc, index) => ({
      sql: `INSERT INTO search_embeddings (doc_id, model, dims, body_hash, embedding) VALUES ($1, $2, $3, $4, $5::vector)
            ON CONFLICT (doc_id, model) DO UPDATE SET dims = EXCLUDED.dims, body_hash = EXCLUDED.body_hash, embedding = EXCLUDED.embedding, created_at = now()`,
      params: [doc.id, embedder.model, embedder.dims, doc.body_hash, vectorLiteral(vectors[index]!)],
    })));
    embedded += docs.length;
  }
  const [row] = await store.executor.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM search_docs d LEFT JOIN search_embeddings e ON e.doc_id = d.id AND e.model = $1 WHERE e.doc_id IS NULL OR e.body_hash <> d.body_hash`,
    [embedder.model],
  );
  return { model: embedder.model, embedded, remaining: row?.n ?? 0 };
}
