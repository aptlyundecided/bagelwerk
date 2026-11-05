import { capRows, normalizeRows, prepareReadOnlySql, type ReadOnlyQueryOptions, type ReadOnlyQueryResult, type SqlExecutor, type SqlRow, type SqlStatement } from "./types";

type PgClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: SqlRow[]; fields?: Array<{ name: string }> }>;
  release(): void;
};
type PgPool = { connect(): Promise<PgClient>; query(sql: string, params?: unknown[]): Promise<{ rows: SqlRow[] }>; end(): Promise<void> };

/**
 * Real Postgres through `pg`. `pg` is an optional peer: it is only required when a postgres:// URL is
 * configured, so bagelwerk itself keeps no hard dependency on it.
 */
export async function openPgExecutor(connectionString: string, options: { max?: number } = {}): Promise<SqlExecutor> {
  let pg: { Pool: new (config: Record<string, unknown>) => PgPool };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pg = require("pg");
  } catch {
    throw new Error("BAGELWERK_RECORDS is a postgres:// URL but the `pg` package is not installed. Run `npm install pg`.");
  }
  const pool = new pg.Pool({ connectionString, max: options.max ?? 5 });
  await pool.query("select 1");
  let readerRole: boolean | undefined;

  async function withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  return {
    kind: "postgres",
    async query<T = SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      return normalizeRows<T>((await pool.query(sql, params)).rows);
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async transaction(statements: SqlStatement[]): Promise<SqlRow[][]> {
      return withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const out: SqlRow[][] = [];
          for (const statement of statements) out.push(normalizeRows((await client.query(statement.sql, statement.params ?? [])).rows));
          await client.query("COMMIT");
          return out;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
    },
    async readOnlyQuery<T = SqlRow>(sql: string, params: unknown[] = [], options: ReadOnlyQueryOptions = {}): Promise<ReadOnlyQueryResult<T>> {
      const prepared = prepareReadOnlySql(sql, options.maxRows);
      if (readerRole === undefined) readerRole = (await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'records_reader' AND pg_has_role(current_user, oid, 'MEMBER')")).rows.length > 0;
      return withClient(async (client) => {
        await client.query("BEGIN READ ONLY");
        try {
          await client.query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(options.timeoutMs ?? 10_000))}`);
          if (readerRole) await client.query("SET LOCAL ROLE records_reader");
          const result = await client.query(prepared.sql, params);
          await client.query("COMMIT");
          return { ...capRows(normalizeRows<T>(result.rows), prepared.cap), fields: (result.fields ?? []).map((field) => field.name) };
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      });
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
