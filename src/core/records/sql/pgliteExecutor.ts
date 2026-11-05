import path from "node:path";

import { capRows, normalizeRows, prepareReadOnlySql, type ReadOnlyQueryOptions, type ReadOnlyQueryResult, type SqlExecutor, type SqlRow, type SqlStatement } from "./types";

type PGliteQueryResult = { rows: SqlRow[]; fields?: Array<{ name: string }> };
type PGliteLike = {
  query(sql: string, params?: unknown[]): Promise<PGliteQueryResult>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: { query(sql: string, params?: unknown[]): Promise<PGliteQueryResult> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** Extensions bundled with @electric-sql/pglite that the schema may use. All exist for stock Postgres too. */
function loadExtensions(): Record<string, unknown> {
  // Subpath exports are resolved at runtime; this repo's `node` module resolution cannot type them.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { vector } = require("@electric-sql/pglite/vector");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ltree } = require("@electric-sql/pglite/contrib/ltree");
  return { vector, pg_trgm, ltree };
}

export type PgliteExecutorOptions = {
  /** Directory on disk, or "memory://" for tests. */
  dataDir: string;
};

export async function openPgliteExecutor(options: PgliteExecutorOptions): Promise<SqlExecutor> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PGlite } = require("@electric-sql/pglite") as { PGlite: { create(options: Record<string, unknown>): Promise<PGliteLike> } };
  const dataDir = options.dataDir.startsWith("memory://") ? options.dataDir : path.resolve(options.dataDir);
  const db = await PGlite.create({ dataDir, extensions: loadExtensions() });
  return createPgliteExecutor(db);
}

export function createPgliteExecutor(db: PGliteLike): SqlExecutor {
  let closed = false;
  let readerRole: boolean | undefined;
  return {
    kind: "pglite",
    async query<T = SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      return normalizeRows<T>((await db.query(sql, params)).rows);
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
    async transaction(statements: SqlStatement[]): Promise<SqlRow[][]> {
      if (statements.length === 0) return [];
      return db.transaction(async (tx) => {
        const out: SqlRow[][] = [];
        for (const statement of statements) out.push(normalizeRows((await tx.query(statement.sql, statement.params ?? [])).rows));
        return out;
      });
    },
    async readOnlyQuery<T = SqlRow>(sql: string, params: unknown[] = [], options: ReadOnlyQueryOptions = {}): Promise<ReadOnlyQueryResult<T>> {
      const prepared = prepareReadOnlySql(sql, options.maxRows);
      if (readerRole === undefined) readerRole = (await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'records_reader'")).rows.length > 0;
      return db.transaction(async (tx) => {
        await tx.query("SET TRANSACTION READ ONLY");
        if (readerRole) await tx.query("SET LOCAL ROLE records_reader");
        const result = await tx.query(prepared.sql, params);
        const capped = capRows(normalizeRows<T>(result.rows), prepared.cap);
        return { ...capped, fields: (result.fields ?? []).map((field) => field.name) };
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await db.close();
    },
  };
}
