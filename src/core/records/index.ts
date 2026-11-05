/**
 * Record Store: bagelwerk run records (flow/node/agent runs, events, artifacts, acceptances) in
 * Postgres-compatible SQL. PGlite in-process or behind `records serve`; real Postgres later.
 */
export * from "./sql/types";
export { openPgliteExecutor, createPgliteExecutor } from "./sql/pgliteExecutor";
export { openPgExecutor } from "./sql/pgExecutor";
export { createHttpExecutor } from "./sql/httpExecutor";
export { tryAcquireDataDirLock, readDataDirLock } from "./sql/dataDirLock";
export { migrateRecords, type MigrationOutcome } from "./schema/migrate";
export { RECORDS_MIGRATIONS } from "./schema/migrations";
export * from "./store/recordStore";
export { SEARCH_SOURCE_KINDS, type SearchSourceKind } from "./store/searchDocs";
export type { RecordSearchHit, RecordSearchMode, RecordSearchQuery } from "./store/search";
export { startRecordsServer, readServerAdvert, type RecordsServer, type RecordsServerAdvert } from "./server/recordsServer";
export {
  configureRecords,
  getRecordStore,
  flushRecords,
  recordsEnabled,
  runWithRecordsContext,
  currentRecordsContext,
  recordsFailureCount,
} from "./mirror/recordsMirror";
export { openRecordStoreFromEnv, recordsDirFromEnv, recordsDataDir, recordsModeFromEnv, type ResolvedRecordStore } from "./mirror/resolveRecords";
export { ingestPaths, type IngestReport } from "./ingest/ingest";
export { syncAcceptedSurfaceFromRecords, materializeAcceptance, type AcceptedSurfaceSync } from "./materialize/materialize";
export { HashingEmbedder, OpenAICompatibleEmbedder, resolveEmbedder, type Embedder } from "./embeddings/embedder";
export { embedPendingDocs, type EmbedRunResult } from "./embeddings/embedDocs";
export { serveRecordsMcp, handleRecordsTool } from "./mcp/recordsMcpServer";
