import path from "node:path";

import { readServerAdvert, startRecordsServer, type RecordsServer } from "../server/recordsServer";
import { readDataDirLock, tryAcquireDataDirLock } from "../sql/dataDirLock";
import { createHttpExecutor } from "../sql/httpExecutor";
import { openPgExecutor } from "../sql/pgExecutor";
import { openPgliteExecutor } from "../sql/pgliteExecutor";
import { RecordStore } from "../store/recordStore";

export type ResolvedRecordStore = { store: RecordStore; description: string; close(): Promise<void> };

export type RecordsMode = { kind: "off" } | { kind: "auto" } | { kind: "local" } | { kind: "url"; url: string };

/**
 * BAGELWERK_RECORDS:
 * - unset / "auto": use a running records server if one is advertised, else open the local PGlite store
 *   (only if no other process holds it; otherwise run files-only and say so once).
 * - "local": like auto but never use a server.
 * - "off": files only.
 * - "http://127.0.0.1:PORT" (+ BAGELWERK_RECORDS_TOKEN): a specific records server.
 * - "postgres://..." / "postgresql://...": real Postgres (needs the `pg` package).
 * BAGELWERK_RECORDS_DIR: where the store lives (default `<cwd>/.artifacts/records`).
 */
export function recordsModeFromEnv(env: NodeJS.ProcessEnv = process.env): RecordsMode {
  const raw = (env.BAGELWERK_RECORDS ?? "auto").trim();
  const lower = raw.toLowerCase();
  if (lower === "" || lower === "auto" || lower === "on" || lower === "1" || lower === "true") return { kind: "auto" };
  if (lower === "off" || lower === "0" || lower === "false" || lower === "none") return { kind: "off" };
  if (lower === "local") return { kind: "local" };
  if (/^(https?|postgres|postgresql):\/\//i.test(raw)) return { kind: "url", url: raw };
  throw new Error(`BAGELWERK_RECORDS='${raw}' is not off, auto, local, an http:// records server URL or a postgres:// URL.`);
}

export function recordsDirFromEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return path.resolve(env.BAGELWERK_RECORDS_DIR?.trim() || path.join(cwd, ".artifacts", "records"));
}

export function recordsDataDir(recordsDir: string): string {
  return path.join(recordsDir, "pgdata");
}

export async function openRecordStoreFromEnv(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  purpose?: string;
  /** Returned reason when no store could be opened. */
  onUnavailable?: (reason: string) => void;
  /** auto mode: serve the store to other processes when this one becomes the owner (default true). */
  serve?: boolean;
} = {}): Promise<ResolvedRecordStore | undefined> {
  const env = options.env ?? process.env;
  const mode = recordsModeFromEnv(env);
  if (mode.kind === "off") return undefined;

  if (mode.kind === "url") {
    if (/^https?:/i.test(mode.url)) {
      const token = env.BAGELWERK_RECORDS_TOKEN?.trim();
      if (!token) throw new Error("BAGELWERK_RECORDS is an http:// URL; set BAGELWERK_RECORDS_TOKEN too.");
      const store = new RecordStore(createHttpExecutor({ url: mode.url, token }));
      return { store, description: `records server ${mode.url}`, close: () => store.close() };
    }
    const store = new RecordStore(await openPgExecutor(mode.url));
    await store.migrate();
    return { store, description: `postgres ${redact(mode.url)}`, close: () => store.close() };
  }

  const recordsDir = recordsDirFromEnv(env, options.cwd);
  if (mode.kind === "auto") {
    const advert = readServerAdvert(recordsDir);
    if (advert) {
      const store = new RecordStore(createHttpExecutor({ url: advert.url, token: advert.token }));
      return { store, description: `records server ${advert.url} (pid ${advert.pid})`, close: () => store.close() };
    }
  }

  const dataDir = recordsDataDir(recordsDir);
  let lock = tryAcquireDataDirLock(dataDir, options.purpose ?? "in-process");
  if (!lock && mode.kind === "auto") {
    // The owner may be between taking the lock and publishing its server address, or handing off on exit.
    const deadline = Date.now() + 5_000;
    while (!lock && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const advert = readServerAdvert(recordsDir);
      if (advert) {
        const store = new RecordStore(createHttpExecutor({ url: advert.url, token: advert.token }));
        return { store, description: `records server ${advert.url} (pid ${advert.pid})`, close: () => store.close() };
      }
      if (!readDataDirLock(dataDir)) lock = tryAcquireDataDirLock(dataDir, options.purpose ?? "in-process");
    }
  }
  if (!lock) {
    const holder = readDataDirLock(dataDir);
    options.onUnavailable?.(
      `records store ${dataDir} is held by pid ${holder?.pid ?? "?"} (${holder?.purpose ?? "unknown"}); this process writes files only. ` +
        "Run `npm run records -- serve` so every process can write to the store, then `records ingest` to backfill.",
    );
    return undefined;
  }
  try {
    const store = new RecordStore(await openPgliteExecutor({ dataDir }));
    await store.migrate();
    // In auto mode the owner also serves the store, so concurrent processes write through it instead of
    // falling back to files only. When this process exits, the next writer takes over ownership.
    let server: RecordsServer | undefined;
    if (mode.kind === "auto" && options.serve !== false) {
      server = await startRecordsServer({ executor: store.executor, recordsDir, dataDir, unref: true }).catch(() => undefined);
    }
    return {
      store,
      description: `local PGlite ${dataDir}${server ? ` (serving ${server.url})` : ""}`,
      async close() {
        try {
          await server?.close();
          await store.close();
        } finally {
          lock.release();
        }
      },
    };
  } catch (error) {
    lock.release();
    throw error;
  }
}

function redact(url: string): string {
  return url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}
