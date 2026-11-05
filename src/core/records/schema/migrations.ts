/**
 * Portable Postgres only. Every extension used here ships with stock Postgres (contrib) or pgvector.
 * Append new migrations; never edit an applied one.
 */
export type RecordsMigration = {
  version: number;
  name: string;
  /** Optional migrations may fail (e.g. pgvector missing on a server); the feature they enable is then off. */
  optional?: boolean;
  sql: string;
};

export const RECORDS_MIGRATIONS: RecordsMigration[] = [
  {
    version: 1,
    name: "core-run-records",
    sql: `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS records_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_runs (
  run_dir text PRIMARY KEY,
  artifact_root text NOT NULL,
  session_id text NOT NULL,
  flow_id text NOT NULL,
  attempt int,
  mode text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  run_tree jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_runs_session ON flow_runs (artifact_root, session_id);
CREATE INDEX IF NOT EXISTS flow_runs_started ON flow_runs (started_at);

CREATE TABLE IF NOT EXISTS node_runs (
  run_dir text PRIMARY KEY,
  source text NOT NULL DEFAULT 'flow-runner',
  artifact_root text NOT NULL,
  session_id text NOT NULL,
  flow_id text,
  node_path text NOT NULL,
  node_path_ltree ltree,
  node_id text,
  node_type text,
  attempt int,
  status text,
  note text,
  launch_snapshot jsonb,
  result jsonb,
  artifact_existence jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS node_runs_session ON node_runs (artifact_root, session_id, node_path);
CREATE INDEX IF NOT EXISTS node_runs_path ON node_runs USING gist (node_path_ltree);
CREATE INDEX IF NOT EXISTS node_runs_status ON node_runs (status);
CREATE INDEX IF NOT EXISTS node_runs_started ON node_runs (started_at);

CREATE TABLE IF NOT EXISTS node_artifacts (
  run_dir text NOT NULL,
  relative_path text NOT NULL,
  artifact_key text,
  label text,
  kind text,
  required boolean,
  present boolean,
  canonical_path text,
  sha256 text,
  bytes bigint,
  media_type text,
  content_text text,
  observed_at timestamptz,
  PRIMARY KEY (run_dir, relative_path)
);

CREATE TABLE IF NOT EXISTS acceptances (
  id bigserial PRIMARY KEY,
  artifact_root text NOT NULL,
  session_id text NOT NULL,
  node_path text NOT NULL,
  run_dir text NOT NULL,
  alias_for text,
  accepted_at timestamptz NOT NULL,
  by_kind text,
  by_id text,
  note text,
  record jsonb NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  UNIQUE (artifact_root, session_id, node_path, run_dir, accepted_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS acceptances_current ON acceptances (artifact_root, session_id, node_path) WHERE is_current;

CREATE TABLE IF NOT EXISTS flow_events (
  dedupe_key text PRIMARY KEY,
  owner_run_dir text NOT NULL,
  ord int NOT NULL,
  session_id text,
  flow_id text,
  node_path text,
  type text NOT NULL,
  at timestamptz,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS flow_events_owner ON flow_events (owner_run_dir, ord);
CREATE INDEX IF NOT EXISTS flow_events_session ON flow_events (session_id, at);
CREATE INDEX IF NOT EXISTS flow_events_type ON flow_events (type);

CREATE TABLE IF NOT EXISTS agent_runs (
  observation_dir text PRIMARY KEY,
  run_id text,
  node_id text,
  node_run_dir text,
  harness text,
  model text,
  cwd text,
  status text,
  quality_status text,
  error_message text,
  prompt text,
  input jsonb,
  summary jsonb,
  usage jsonb,
  cost_usd double precision,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_node_run ON agent_runs (node_run_dir);
CREATE INDEX IF NOT EXISTS agent_runs_node ON agent_runs (node_id, started_at);
CREATE INDEX IF NOT EXISTS agent_runs_started ON agent_runs (started_at);

CREATE TABLE IF NOT EXISTS agent_run_events (
  observation_dir text NOT NULL,
  seq int NOT NULL,
  at timestamptz,
  harness text,
  kind text,
  phase text,
  item_id text,
  summary text,
  detail jsonb,
  PRIMARY KEY (observation_dir, seq)
);
CREATE INDEX IF NOT EXISTS agent_run_events_kind ON agent_run_events (kind, at);

CREATE TABLE IF NOT EXISTS agent_raw_events (
  observation_dir text NOT NULL,
  file text NOT NULL,
  ord int NOT NULL,
  at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY (observation_dir, file, ord)
);

CREATE TABLE IF NOT EXISTS agent_files (
  observation_dir text NOT NULL,
  relative_path text NOT NULL,
  content text,
  bytes bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_dir, relative_path)
);

CREATE TABLE IF NOT EXISTS supervisor_reports (
  root_dir text PRIMARY KEY,
  session_id text,
  flow_id text,
  status text,
  report jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supervisor_ledger (
  root_dir text NOT NULL,
  ord int NOT NULL,
  at timestamptz,
  type text,
  message text,
  entry jsonb NOT NULL,
  PRIMARY KEY (root_dir, ord)
);

CREATE TABLE IF NOT EXISTS search_docs (
  id bigserial PRIMARY KEY,
  source_kind text NOT NULL,
  source_key text NOT NULL,
  chunk int NOT NULL,
  title text,
  body text NOT NULL,
  body_hash text NOT NULL,
  at timestamptz,
  session_id text,
  node_path text,
  node_path_ltree ltree,
  harness text,
  observation_dir text,
  run_dir text,
  meta jsonb,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || body)) STORED,
  UNIQUE (source_kind, source_key, chunk)
);
CREATE INDEX IF NOT EXISTS search_docs_tsv ON search_docs USING gin (tsv);
CREATE INDEX IF NOT EXISTS search_docs_body_trgm ON search_docs USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_docs_title_trgm ON search_docs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_docs_kind_at ON search_docs (source_kind, at);
CREATE INDEX IF NOT EXISTS search_docs_path ON search_docs USING gist (node_path_ltree);
CREATE INDEX IF NOT EXISTS search_docs_obs ON search_docs (observation_dir);
CREATE INDEX IF NOT EXISTS search_docs_run ON search_docs (run_dir);
`,
  },
  {
    version: 2,
    name: "semantic-embeddings",
    optional: true,
    sql: `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS search_embeddings (
  doc_id bigint NOT NULL REFERENCES search_docs (id) ON DELETE CASCADE,
  model text NOT NULL,
  dims int NOT NULL,
  body_hash text NOT NULL,
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, model)
);
CREATE INDEX IF NOT EXISTS search_embeddings_model ON search_embeddings (model);
`,
  },
  {
    version: 3,
    name: "read-only-agent-role",
    optional: true,
    // Agent-facing SQL runs as this role: SELECT only, no artifact bodies, no superuser functions or COPY.
    sql: `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'records_reader') THEN CREATE ROLE records_reader NOLOGIN; END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT records_reader TO %I', current_user); EXCEPTION WHEN OTHERS THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO records_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO records_reader;
REVOKE SELECT ON node_artifacts FROM records_reader;
GRANT SELECT (run_dir, relative_path, artifact_key, label, kind, required, present, canonical_path, sha256, bytes, media_type, observed_at) ON node_artifacts TO records_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO records_reader;
`,
  },
  {
    version: 4,
    name: "acceptance-withdrawal-and-ltree-labels",
    // For stores created before withdrawn_at existed, and before '-' was mapped to '_' in ltree labels.
    sql: `
ALTER TABLE acceptances ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
UPDATE node_runs SET node_path_ltree = text2ltree(regexp_replace(node_path, '[^A-Za-z0-9_.]', '_', 'g'))
  WHERE node_path_ltree::text LIKE '%-%';
UPDATE search_docs SET node_path_ltree = text2ltree(regexp_replace(node_path, '[^A-Za-z0-9_.]', '_', 'g'))
  WHERE node_path IS NOT NULL AND node_path_ltree::text LIKE '%-%';
`,
  },
  {
    version: 5,
    name: "reader-cannot-read-raw-acceptance-records",
    optional: true,
    // acceptances.record is stored unredacted so it round-trips; agents read the redacted columns instead.
    sql: `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'records_reader') THEN
    REVOKE SELECT ON acceptances FROM records_reader;
    GRANT SELECT (id, artifact_root, session_id, node_path, run_dir, alias_for, accepted_at, by_kind, by_id, note, is_current, withdrawn_at) ON acceptances TO records_reader;
  END IF;
END $$;
`,
  },
];
