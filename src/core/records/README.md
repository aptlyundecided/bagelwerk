# Records (`src/core/records/`)

The **Record Store** is bagelwerk's system of record for run state: Flow runs, Node runs, accepted Node results, Flow events, agent runs and their event timelines, agent files, Node artifacts and supervisor reports. It is plain Postgres SQL, so it can be searched by agents and humans, and it runs on embedded **PGlite** today and real **Postgres** later with no schema change.

Run-record files under `.artifacts/` are still written exactly as before. They are the working surface that agents and Nodes read, and they double as the write-ahead spool: anything that did not reach the store can be backfilled with `records ingest`.

## Quick start

```sh
npm run records -- serve            # one process owns the store; every other process writes through it
npm run records -- ingest .artifacts ../infinity-crew/runs   # backfill existing history (idempotent)
npm run records -- search "ECONNRESET uploader"              # full-text
npm run records -- search "exit code 1" --mode fuzzy --kind agent_event
npm run records -- runs --kind agent --status failed
npm run records -- embed            # vectors for semantic / hybrid search
npm run records -- mcp              # MCP server on stdio for agents
```

## How processes reach the store

PGlite is single-process. Two processes on one data directory **silently lose writes** (measured in the Phase 0 spike: about half the rows vanished with no error). So exactly one process owns the data directory, enforced by `<recordsDir>/pgdata.lock`:

| `BAGELWERK_RECORDS` | Behaviour |
| --- | --- |
| unset / `auto` | Use the records server advertised in `<recordsDir>/server.json` if one is running. Otherwise take the lock, open PGlite in-process **and serve it** to other processes (the first process becomes the owner). A process that finds the lock busy waits up to 5 s for the owner's advert. When the owner exits, the next writer takes over. Files-only is the last resort, retried every 10 s. |
| `local` | As auto, but never use a server. |
| `off` | Files only. The default test runner sets this. |
| `http://127.0.0.1:PORT` + `BAGELWERK_RECORDS_TOKEN` | A specific records server. |
| `postgres://…` | Real Postgres (needs the `pg` package). |

`BAGELWERK_RECORDS_DIR` (default `<cwd>/.artifacts/records`) chooses the store. Every process that should share a store must resolve the same directory: run them from the same cwd or set `BAGELWERK_RECORDS_DIR`. `records serve` is still useful as a long-lived owner (and for `--embed-every`), but auto mode no longer needs it.

The server binds loopback only, requires the bearer token from `server.json` (mode 0600), and exposes `query`, `exec`, `transaction` and `read-only` routes. It speaks JSON over HTTP rather than the Postgres wire protocol because `@electric-sql/pglite-socket` could not be installed here. Clients go through the same `SqlExecutor` seam, so swapping in Postgres is a connection-string change.

## What gets recorded, and where it hooks in

| Source | Hook | Tables |
| --- | --- | --- |
| Flow Runner node run | `flow-runner/runRecords.ts` (`beginFlowRunnerNodeRun`, `persistFlowRunnerNodeSidecars`) | `node_runs`, `node_artifacts` |
| Acceptance (and nodeId alias) | `acceptFlowRunnerNodeRun` | `acceptances` (`is_current` = latest by `accepted_at`) |
| Flow run | `beginFlowRunnerFlowRun`, `persistFlowRunnerRunTree` | `flow_runs` |
| Flow events, live | `emitFlowRunnerEvent`; arrays are bound to their run dir so ordinals match `events.json` | `flow_events` |
| Workbench runs | `flow-workbench/runRecords.ts` | same tables, `source = 'workbench'` |
| Every agent harness | `agent-execution/nodeObservability.ts` (`writeText`, `writeJson`, `appendNdjson`, `finalize`) | `agent_runs`, `agent_files`, `agent_run_events`; raw harness streams in `agent_raw_events` only with `BAGELWERK_RECORDS_RAW=1` |
| Supervisor | `writeFlowSupervisorArtifacts` | `supervisor_reports`, `supervisor_ledger` |

Agent runs started inside a Node are linked to that Node run (`agent_runs.node_run_dir`) through `AsyncLocalStorage`, so no harness signature changed.

Writes are queued and drained in order as batched transactions (`mirror/recordsMirror.ts`). A store failure is logged once and never fails a run. `persist…` / `accept…` / `finalize` await a bounded flush, so records are in the store when those calls return.

## Authority (Phase 5)

The store decides which run is accepted; `accepted/` directories are a materialised cache. Preflight and resume call `syncAcceptedSurfaceFromRecords` for every upstream Node first:

| Store vs `accepted/` | Result |
| --- | --- |
| Same acceptance, files match (sha256) | `in-sync` |
| Same acceptance, a file missing or changed | restored from the store |
| `accepted/` missing or unreadable | restored from the store |
| `accepted/` holds a **newer** acceptance (written while the store was busy or off) | files kept; the store is healed from them (`healed-store`) |
| `accepted/` holds an older or unknown acceptance | restored from the store |
| Store has no acceptance | files decide; recorded into the store if present |

Restores are written to a staging directory and swapped in (old → trash → new; put back on failure) under a per-directory lock, so an interrupted restore never loses the existing surface.

**Resetting:** deleting `accepted/` is no longer enough, because the store restores it. Use `records unaccept --artifact-root DIR --session ID [--node PATH]`, which withdraws the acceptance and removes the directory. `records materialize … [--force]` rebuilds surfaces by hand.

Text artifacts up to 1 MB are stored inline (exact bytes, checked by sha256) so they can be restored even if the run directory is gone. Larger or binary artifacts are stored by path and sha256 and restored from the run directory or the accepted copy.

### Sidecar files (Phase 6 decision)

No JSON sidecar was removed. `launch-snapshot.json`, `events.json`, `artifact-events.json`, `artifact-existence.json`, `node-result.json`, `run-tree.json` and the agent observation files are the spool for files-only mode (a busy or disabled store), the input to `records ingest`, and what people and Workbench tools open directly. Dropping any of them would make files-only runs lossy. Revisit once every process writes through `records serve` or Postgres.

## Search

`search_docs` is one flat search surface fed from prompts, agent files, agent events, node results, node artifacts, meaningful flow events and supervisor reports, chunked at about 4,000 characters. Hits carry `observationDir` / `runDir` so callers can drill in.

| Mode | Mechanism |
| --- | --- |
| `text` | `tsvector` + GIN, `websearch_to_tsquery` (`"phrase"`, `-exclude`, `or`), `ts_rank_cd`, highlighted snippet |
| `fuzzy` | `ILIKE` substring, accelerated by `pg_trgm` GIN: error strings, paths, ids, commands |
| `semantic` | `pgvector` cosine distance over `search_embeddings` |
| `hybrid` (default when embeddings exist) | text + semantic fused by reciprocal rank, falling back to fuzzy |

Filters: `kinds`, `sessionId`, `nodePath` (ltree prefix: everything under `flowA.lane2`), `harness`, `observationDir`, `runDir`, `since`, `until`.

### Embeddings (Phase 7)

Computed asynchronously (`records embed`, or `records serve --embed-every 60`), never on a run's write path. Only docs without a vector for the current model, or whose `body_hash` changed, are embedded.

- `BAGELWERK_EMBEDDINGS=hash` (default): local, deterministic feature hashing. No model, no network, no cost. It finds lexical near-matches across runs, but it is not truly semantic.
- `BAGELWERK_EMBEDDINGS=openai-compatible` with `BAGELWERK_EMBEDDINGS_URL`, `_MODEL`, `_DIMS`, optional `_API_KEY`: OpenAI, OpenRouter, or a local Ollama (`http://localhost:11434/v1`). Use this for real semantic search.
- Changing model means a new `model` id; old vectors stay until deleted.

## Agent access

Agent SQL (`records_query`, `records sql`) accepts one `SELECT`/`WITH`/`VALUES`/`TABLE` statement, wraps it in `LIMIT cap+1`, rejects dangerous functions (`pg_sleep`, `pg_read_file`, `lo_*`, `dblink`, …), and runs in a READ ONLY transaction as the `records_reader` role (migration 3: SELECT only, no `node_artifacts.content_text`). Known limits on PGlite: there is no statement timeout, and set-returning functions such as `generate_series` materialise fully before the outer `LIMIT`, so a hostile query can still stall the store. On Postgres, connect with a non-superuser and `statement_timeout` applies.

`records mcp` exposes read-only tools: `records_search`, `records_list_runs`, `records_get_agent_run`, `records_get_node_run`, `records_get_file`, `records_query` (one statement in a READ ONLY transaction, row-capped), `records_schema`, `records_stats`. Register it next to other MCP servers, e.g. Codex `-c mcp_servers.bagelwerk_records.command="npm" -c mcp_servers.bagelwerk_records.args=["run","--silent","records","--","mcp"]`.

## Redaction

Known credential shapes (`sk-…`, `sk-ant-…`, `ghp_…`, `xox…-`, `AKIA…`, Bearer tokens, `postgres://user:pass@`) and string values under secret-looking keys (`apiKey`, `password`, `token`, `access_token`, …, but not counts such as `inputTokens`) are replaced with `[redacted]` in JSON columns, agent files, events, notes and search bodies. Two things are stored exactly because they must round-trip: `node_artifacts.content_text` (byte-for-byte restore; not readable through agent SQL, and redacted on the way out of `records_get_file`) and the acceptance record (it becomes `accepted-selection.json`).

## Invariants

- Portable SQL only. Extensions: `pg_trgm`, `ltree` (contrib), `vector` (optional migration 2; semantic search is off if it is skipped).
- Every write is keyed on a natural key (run dir, observation dir + seq, run dir + event ordinal), so live mirroring and `ingest` converge on the same rows and re-ingest is a no-op. A new run beginning in a reused run dir clears that dir's old rows first.
- Paths are stored absolute (`path.resolve`).
- Records must never throw into Flow or agent execution.

## File map

| Path | Purpose |
| --- | --- |
| `sql/` | `SqlExecutor` seam; PGlite, HTTP and `pg` executors; data-dir lock |
| `schema/` | Migrations and the idempotent migrator |
| `store/` | `RecordStore` (statement builders and reads), search docs, search, text/redaction helpers |
| `mirror/` | Env resolution, the process-wide write queue, and hooks called from runner/workbench/agent code |
| `server/` | `records serve` HTTP server |
| `ingest/` | Backfill from files |
| `materialize/` | Rebuild `accepted/` from the store |
| `embeddings/` | Embedders and the pending-embeddings job |
| `mcp/` | stdio MCP server |
| `records.test.ts` | Mirror, authority/heal/parity, ingest, run-dir reuse |
| `records.security.test.ts` | Read-only SQL guard, redaction, data-dir lock |
| `records.concurrency.test.ts` | Server with many clients, search + MCP, flush under load, auto-mode owner/serve |

## Moving to Postgres later

1. Create a database (Infinity Crew's Docker Postgres works) with `pg_trgm`, `ltree` and `pgvector` available; `npm install pg` in bagelwerk.
2. `BAGELWERK_RECORDS=postgres://… npm run records -- migrate`.
3. Move data: `records ingest` from the run-record files (simplest), or `pg_dump` from PGlite via `@electric-sql/pglite-tools` and restore.
4. Set `BAGELWERK_RECORDS=postgres://…` for every process; stop `records serve`.
5. Later if needed: a read-only role for agent tools, HNSW indexes on fixed-dimension embeddings, monthly partitions for `agent_run_events` / `flow_events`, `LISTEN/NOTIFY` for live timelines.
