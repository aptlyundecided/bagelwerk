import type { SqlExecutor } from "../sql/types";
import { RECORDS_MIGRATIONS, type RecordsMigration } from "./migrations";

export type MigrationOutcome = { version: number; name: string; status: "applied" | "skipped" | "already"; error?: string };

/**
 * Idempotent. Each migration runs as one simple-protocol string (an implicit transaction) together
 * with its bookkeeping row, so a failure leaves nothing half-applied on PGlite or Postgres.
 */
export async function migrateRecords(executor: SqlExecutor, migrations: RecordsMigration[] = RECORDS_MIGRATIONS): Promise<MigrationOutcome[]> {
  await executor.exec(`CREATE TABLE IF NOT EXISTS records_schema_migrations (
    version int PRIMARY KEY,
    name text NOT NULL,
    status text NOT NULL,
    error text,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Map(
    (await executor.query<{ version: number; status: string }>("SELECT version, status FROM records_schema_migrations")).map((row) => [row.version, row.status]),
  );
  const outcomes: MigrationOutcome[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.get(migration.version) === "applied") {
      outcomes.push({ version: migration.version, name: migration.name, status: "already" });
      continue;
    }
    const record = `INSERT INTO records_schema_migrations (version, name, status) VALUES (${migration.version}, ${quote(migration.name)}, 'applied')
      ON CONFLICT (version) DO UPDATE SET status = 'applied', error = NULL, applied_at = now()`;
    try {
      await executor.exec(`${migration.sql}\n;\n${record};`);
      outcomes.push({ version: migration.version, name: migration.name, status: "applied" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!migration.optional) throw new Error(`Records migration ${migration.version} (${migration.name}) failed: ${message}`);
      if (!done.has(migration.version)) {
        await executor.query(
          "INSERT INTO records_schema_migrations (version, name, status, error) VALUES ($1, $2, 'skipped', $3) ON CONFLICT (version) DO UPDATE SET error = EXCLUDED.error",
          [migration.version, migration.name, message],
        );
      }
      outcomes.push({ version: migration.version, name: migration.name, status: "skipped", error: message });
    }
  }
  return outcomes;
}

export async function appliedMigrationVersions(executor: SqlExecutor): Promise<Set<number>> {
  try {
    const rows = await executor.query<{ version: number }>("SELECT version FROM records_schema_migrations WHERE status = 'applied'");
    return new Set(rows.map((row) => row.version));
  } catch {
    return new Set();
  }
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
