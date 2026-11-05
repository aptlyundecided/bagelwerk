/**
 * The only seam the Record Store talks through. Implementations: in-process PGlite, the local records
 * server over HTTP, and real Postgres via `pg`. Keep every SQL statement portable Postgres.
 */
export type SqlRow = Record<string, unknown>;

export type SqlStatement = { sql: string; params?: unknown[] };

export type ReadOnlyQueryOptions = {
  /** Rows beyond this are dropped and `truncated` is set. */
  maxRows?: number;
  /** Best effort: enforced by Postgres, not by PGlite (single-threaded WASM has no timer interrupts). */
  timeoutMs?: number;
};

export type ReadOnlyQueryResult<T = SqlRow> = { rows: T[]; truncated: boolean; fields: string[] };

export type SqlExecutorKind = "pglite" | "http" | "postgres";

export interface SqlExecutor {
  readonly kind: SqlExecutorKind;
  /** One parameterised statement. Multiple statements are rejected by the extended protocol. */
  query<T = SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Several statements, no parameters (migrations / DDL). */
  exec(sql: string): Promise<void>;
  /** All statements in one transaction; all or nothing. Returns each statement's rows. */
  transaction(statements: SqlStatement[]): Promise<SqlRow[][]>;
  /** One statement inside a READ ONLY transaction. Used for agent-facing SQL. */
  readOnlyQuery<T = SqlRow>(sql: string, params?: unknown[], options?: ReadOnlyQueryOptions): Promise<ReadOnlyQueryResult<T>>;
  close(): Promise<void>;
}

export const DEFAULT_READ_ONLY_MAX_ROWS = 500;

export function assertSingleStatement(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!trimmed) throw new Error("Empty SQL statement.");
  // Cheap guard; the extended query protocol rejects multiple commands anyway.
  if (/;\s*\S/.test(stripSqlLiterals(trimmed))) throw new Error("Only one SQL statement is allowed.");
}

function stripSqlLiterals(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const READ_ONLY_LEADING = /^(select|with|values|table)\b/i;
// Defense in depth on top of the records_reader role (PGlite has no statement timeout, so pg_sleep would
// block every writer; the file/large-object functions need superuser, which PGlite and many Docker URLs have).
const READ_ONLY_DENIED_KEYWORDS = /\brecursive\b/i;
const READ_ONLY_DENIED = /\b(generate_series|pg_sleep\w*|pg_read_file|pg_read_binary_file|pg_ls_\w+|pg_stat_file|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|set_config|pg_logical_\w+|pg_advisory\w*|pg_try_advisory\w*|query_to_xml\w*|currval|nextval|setval)\s*\(/i;

/**
 * Agent-supplied SQL: one SELECT-style statement, wrapped so the row cap is applied by the database
 * (never materialising more than cap + 1 rows).
 */
export function prepareReadOnlySql(sql: string, maxRows: number | undefined): { sql: string; cap: number } {
  assertSingleStatement(sql);
  const body = sql.trim().replace(/;\s*$/, "");
  const scrubbed = stripSqlLiterals(body);
  if (!READ_ONLY_LEADING.test(scrubbed.trim())) throw new Error("Only SELECT / WITH / VALUES / TABLE statements are allowed.");
  // Match against identifiers with their quotes removed: "pg_sleep"(1) must not slip through.
  const identifiers = body.replace(/'(?:[^']|'')*'/g, "''").replace(/"((?:[^"]|"")*)"/g, (_match, name: string) => name.replace(/""/g, '"'));
  if (READ_ONLY_DENIED.test(identifiers) || READ_ONLY_DENIED_KEYWORDS.test(identifiers)) throw new Error("That function or construct is not allowed in read-only records queries (no pg_sleep, file/large-object functions, generate_series or WITH RECURSIVE).");
  const cap = Math.max(1, Math.min(maxRows ?? DEFAULT_READ_ONLY_MAX_ROWS, 10_000));
  return { sql: `SELECT * FROM (\n${body}\n) AS records_q LIMIT ${cap + 1}`, cap };
}

export function capRows<T>(rows: T[], maxRows: number | undefined): { rows: T[]; truncated: boolean } {
  const cap = Math.max(1, Math.min(maxRows ?? DEFAULT_READ_ONLY_MAX_ROWS, 10_000));
  return rows.length > cap ? { rows: rows.slice(0, cap), truncated: true } : { rows, truncated: false };
}

/** Executors return identical shapes: timestamps as ISO strings, int8 as number when safe. */
export function normalizeRows<T>(rows: SqlRow[]): T[] {
  return rows.map((row) => {
    const out: SqlRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) out[key] = value.toISOString();
      else if (typeof value === "bigint") out[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
      else out[key] = value;
    }
    return out as T;
  });
}
