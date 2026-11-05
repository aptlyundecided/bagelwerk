#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";

import { flowRunnerAcceptedDir } from "../../core/flow-runner/runRecords";
import {
  embedPendingDocs,
  ingestPaths,
  materializeAcceptance,
  openPgliteExecutor,
  openRecordStoreFromEnv,
  readDataDirLock,
  readServerAdvert,
  RecordStore,
  recordsDataDir,
  recordsDirFromEnv,
  recordsModeFromEnv,
  resolveEmbedder,
  serveRecordsMcp,
  startRecordsServer,
  syncAcceptedSurfaceFromRecords,
  tryAcquireDataDirLock,
  type RecordSearchMode,
  type SearchSourceKind,
} from "../../core/records";

const HELP = `bagelwerk records — run records in PGlite / Postgres

Usage: npm run records -- <command> [options]

  serve [--host 127.0.0.1] [--port 0] [--embed-every 60]   Own the local PGlite store and serve it to every process
  status                                                  Where the store is and who holds it
  migrate                                                 Apply schema migrations
  ingest <path...> [--max-depth 12]                       Backfill from run-record files (idempotent)
  search <query...> [--mode text|fuzzy|semantic|hybrid] [--kind K]... [--session S] [--node PATH]
                    [--harness H] [--since ISO] [--until ISO] [--limit N] [--json]
  runs [--kind agent|node|flow] [--status S] [--session S] [--limit N] [--json]
  show <observationDir|runDir> [--json]                   One agent run or node run in full
  sql "<one read-only statement>" [--max-rows N] [--json]
  stats                                                   Row counts and size
  materialize --artifact-root DIR --session ID [--node PATH] [--force]
                                                          Rebuild accepted/ surfaces from the store
  unaccept --artifact-root DIR --session ID [--node PATH] [--keep-files]
                                                          Withdraw acceptances (the reset path: deleting accepted/
                                                          alone is undone by the store) and remove accepted/ dirs
  embed [--limit N] [--batch N]                           Compute missing embeddings (BAGELWERK_EMBEDDINGS)
  mcp                                                     MCP server on stdio for agents (read-only tools)

Env: BAGELWERK_RECORDS (auto|local|off|http://…|postgres://…), BAGELWERK_RECORDS_DIR, BAGELWERK_RECORDS_TOKEN,
     BAGELWERK_RECORDS_RAW=1, BAGELWERK_EMBEDDINGS (hash|openai-compatible|off) + _URL _MODEL _DIMS _API_KEY`;

type Args = { positional: string[]; flags: Map<string, string[]> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
      const next = argv[i + 1];
      const value = inline ?? (next !== undefined && !next.startsWith("--") ? (i += 1, next) : "true");
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(arg);
  }
  return { positional, flags };
}

const flag = (args: Args, name: string): string | undefined => args.flags.get(name)?.slice(-1)[0];
const flagNumber = (args: Args, name: string): number | undefined => {
  const value = flag(args, name);
  return value === undefined ? undefined : Number(value);
};

function print(value: unknown, json: boolean): void {
  if (json || typeof value !== "object" || value === null) {
    process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      process.stdout.write("(no rows)\n");
      return;
    }
    console.table(value.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, item]) => [key, typeof item === "object" && item !== null ? JSON.stringify(item).slice(0, 80) : item]))));
    return;
  }
  for (const [key, item] of Object.entries(value)) process.stdout.write(`${key.padEnd(20)} ${typeof item === "object" ? JSON.stringify(item) : String(item)}\n`);
}

async function withStore<T>(fn: (store: RecordStore) => Promise<T>): Promise<T> {
  let reason = "";
  // One-shot commands never become the auto-mode server: their exit would force every peer to hand off.
  const resolved = await openRecordStoreFromEnv({ purpose: `records cli ${process.argv[2] ?? ""}`, serve: false, onUnavailable: (why) => (reason = why) });
  if (!resolved) {
    throw new Error(recordsModeFromEnv().kind === "off" ? "BAGELWERK_RECORDS=off; nothing to open." : reason || "records store unavailable");
  }
  process.stderr.write(`[records] ${resolved.description}\n`);
  try {
    return await fn(resolved.store);
  } finally {
    await resolved.close();
  }
}

async function serve(args: Args): Promise<void> {
  const recordsDir = recordsDirFromEnv();
  const dataDir = recordsDataDir(recordsDir);
  const existing = readServerAdvert(recordsDir);
  if (existing) throw new Error(`a records server is already running at ${existing.url} (pid ${existing.pid})`);
  const lock = tryAcquireDataDirLock(dataDir, "records serve");
  if (!lock) throw new Error(`records store ${dataDir} is held by pid ${readDataDirLock(dataDir)?.pid}; stop that process first`);
  const store = new RecordStore(await openPgliteExecutor({ dataDir }));
  const outcomes = await store.migrate();
  for (const outcome of outcomes) if (outcome.status !== "already") process.stderr.write(`[records] migration ${outcome.version} ${outcome.name}: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ""}\n`);
  const server = await startRecordsServer({
    executor: store.executor,
    recordsDir,
    dataDir,
    host: flag(args, "host") ?? "127.0.0.1",
    port: flagNumber(args, "port") ?? 0,
    log: (line) => process.stderr.write(`[records] ${line}\n`),
  });
  process.stderr.write(`[records] data ${dataDir}\n[records] processes using this records dir (auto mode) now write through the server\n`);

  const embedEvery = flagNumber(args, "embed-every");
  let embedTimer: NodeJS.Timeout | undefined;
  let embedding = false;
  const embedder = embedEvery ? resolveEmbedder() : undefined;
  if (embedEvery && embedder) {
    embedTimer = setInterval(() => {
      if (embedding) return;
      embedding = true;
      void embedPendingDocs(store, embedder, { limit: 500 })
        .then((result) => {
          if (result.embedded > 0) process.stderr.write(`[records] embedded ${result.embedded} docs (${result.remaining} remaining, ${result.model})\n`);
        })
        .catch((error) => process.stderr.write(`[records] embedding failed: ${error instanceof Error ? error.message : String(error)}\n`))
        .finally(() => (embedding = false));
    }, embedEvery * 1000);
  }

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  if (embedTimer) clearInterval(embedTimer);
  process.stderr.write("[records] shutting down\n");
  await server.close();
  await store.close();
  lock.release();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const json = flag(args, "json") === "true";
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${HELP}\n`);
      return;
    case "serve":
      return serve(args);
    case "status": {
      const recordsDir = recordsDirFromEnv();
      const dataDir = recordsDataDir(recordsDir);
      print({ mode: recordsModeFromEnv().kind, recordsDir, dataDir, server: readServerAdvert(recordsDir)?.url ?? "(none)", lockHolder: readDataDirLock(dataDir) ?? "(free)" }, json);
      return;
    }
    case "migrate":
      return withStore(async (store) => print(await store.migrate(), json));
    case "ingest": {
      if (args.positional.length === 0) throw new Error("ingest needs at least one path");
      return withStore(async (store) => {
        const report = await ingestPaths(store, args.positional, { maxDepth: flagNumber(args, "max-depth") ?? 12, log: (line) => process.stderr.write(`[records] ${line}\n`) });
        print(json ? report : { ...report, errors: report.errors.length }, json);
        for (const error of report.errors.slice(0, 20)) process.stderr.write(`  ! ${error.path}: ${error.error}\n`);
      });
    }
    case "search": {
      const query = args.positional.join(" ");
      return withStore(async (store) => {
        const embedder = resolveEmbedder();
        const hits = await store.search(
          {
            query,
            ...(flag(args, "mode") ? { mode: flag(args, "mode") as RecordSearchMode } : {}),
            ...(args.flags.get("kind") ? { kinds: args.flags.get("kind") as SearchSourceKind[] } : {}),
            ...(flag(args, "session") ? { sessionId: flag(args, "session")! } : {}),
            ...(flag(args, "node") ? { nodePath: flag(args, "node")! } : {}),
            ...(flag(args, "harness") ? { harness: flag(args, "harness")! } : {}),
            ...(flag(args, "since") ? { since: flag(args, "since")! } : {}),
            ...(flag(args, "until") ? { until: flag(args, "until")! } : {}),
            ...(flagNumber(args, "limit") ? { limit: flagNumber(args, "limit")! } : {}),
          },
          (await store.isSemanticAvailable()) ? embedder : undefined,
        );
        if (json) return print(hits, true);
        if (hits.length === 0) process.stdout.write("(no matches)\n");
        for (const hit of hits) {
          process.stdout.write(`\n${hit.score.toFixed(3)}  [${hit.sourceKind}] ${hit.title ?? ""}  ${hit.at ?? ""}  (${hit.matchedBy.join("+")})\n`);
          process.stdout.write(`       ${hit.snippet.slice(0, 300)}\n`);
          process.stdout.write(`       ${hit.observationDir ? `observationDir=${hit.observationDir}` : hit.runDir ? `runDir=${hit.runDir}` : hit.sourceKey}\n`);
        }
      });
    }
    case "runs":
      return withStore(async (store) => print(await store.listRuns({
        ...(flag(args, "kind") ? { kind: flag(args, "kind") as "agent" | "node" | "flow" } : {}),
        ...(flag(args, "status") ? { status: flag(args, "status")! } : {}),
        ...(flag(args, "session") ? { sessionId: flag(args, "session")! } : {}),
        ...(flag(args, "harness") ? { harness: flag(args, "harness")! } : {}),
        ...(flagNumber(args, "limit") ? { limit: flagNumber(args, "limit")! } : {}),
      }), json));
    case "show": {
      const target = args.positional[0];
      if (!target) throw new Error("show needs an observationDir or runDir");
      return withStore(async (store) => {
        const resolved = path.resolve(target);
        const found = (await store.getAgentRun(resolved)) ?? (await store.getNodeRun(resolved));
        if (!found) throw new Error(`no agent run or node run recorded for ${resolved}`);
        print(found, true);
      });
    }
    case "sql": {
      const sql = args.positional.join(" ");
      return withStore(async (store) => {
        const result = await store.readOnlyQuery(sql, [], { maxRows: flagNumber(args, "max-rows") ?? 200 });
        print(json ? result : result.rows, json);
        if (result.truncated && !json) process.stderr.write("[records] (truncated; use --max-rows)\n");
      });
    }
    case "stats":
      return withStore(async (store) => print(await store.stats(), json));
    case "materialize": {
      const artifactRoot = flag(args, "artifact-root");
      const sessionId = flag(args, "session");
      if (!artifactRoot || !sessionId) throw new Error("materialize needs --artifact-root and --session");
      const force = flag(args, "force") === "true";
      return withStore(async (store) => {
        const root = path.resolve(artifactRoot);
        const node = flag(args, "node");
        const acceptances = node
          ? [await store.getCurrentAcceptance(root, sessionId, node)].filter(Boolean)
          : await store.listCurrentAcceptances(root, sessionId);
        const results: Array<{ nodePath: string; outcome: string }> = [];
        for (const acceptance of acceptances) {
          const acceptedDir = flowRunnerAcceptedDir(root, sessionId, acceptance!.node_path);
          const outcome = force
            ? await materializeAcceptance(store, acceptance!, acceptedDir)
            : await syncAcceptedSurfaceFromRecords({ artifactRoot: root, sessionId, nodePath: acceptance!.node_path, acceptedDir, store });
          results.push({ nodePath: acceptance!.node_path, outcome });
        }
        print(results, json);
      });
    }
    case "unaccept": {
      const artifactRoot = flag(args, "artifact-root");
      const sessionId = flag(args, "session");
      if (!artifactRoot || !sessionId) throw new Error("unaccept needs --artifact-root and --session");
      return withStore(async (store) => {
        const root = path.resolve(artifactRoot);
        const node = flag(args, "node");
        const acceptances = (await store.listCurrentAcceptances(root, sessionId)).filter((acceptance) => !node || acceptance.node_path === node || acceptance.alias_for === node);
        await store.apply(store.unacceptStatements(root, sessionId, node));
        const removed: string[] = [];
        if (flag(args, "keep-files") !== "true") {
          const paths = new Set([...(node ? [node] : []), ...acceptances.map((acceptance) => acceptance!.node_path)]);
          for (const nodePath of paths) {
            const dir = flowRunnerAcceptedDir(root, sessionId, nodePath);
            await rm(dir, { recursive: true, force: true });
            removed.push(dir);
          }
        }
        print({ withdrawn: acceptances.length, removedAcceptedDirs: removed.length }, json);
      });
    }
    case "embed":
      return withStore(async (store) => {
        const embedder = resolveEmbedder();
        if (!embedder) throw new Error("BAGELWERK_EMBEDDINGS=off");
        print(await embedPendingDocs(store, embedder, { limit: flagNumber(args, "limit") ?? 5000, batchSize: flagNumber(args, "batch") ?? 64 }), json);
      });
    case "mcp": {
      let reason = "";
      const resolved = await openRecordStoreFromEnv({ purpose: "records mcp", onUnavailable: (why) => (reason = why) });
      if (!resolved) throw new Error(reason || "records store unavailable");
      const embedder = (await resolved.store.isSemanticAvailable()) ? resolveEmbedder() : undefined;
      try {
        await serveRecordsMcp({ store: resolved.store, ...(embedder ? { embedder } : {}) });
      } finally {
        await resolved.close();
      }
      return;
    }
    default:
      throw new Error(`unknown command '${command}'. Run with --help.`);
  }
}

main().catch((error) => {
  process.stderr.write(`[records] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
