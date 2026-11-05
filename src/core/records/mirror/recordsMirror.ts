import { AsyncLocalStorage } from "node:async_hooks";

import { isRecordsTransportError } from "../sql/httpExecutor";
import type { SqlStatement } from "../sql/types";
import type { RecordStore } from "../store/recordStore";
import { openRecordStoreFromEnv, recordsModeFromEnv, type ResolvedRecordStore } from "./resolveRecords";

/**
 * Process-wide mirror from the file-based run records into the Record Store.
 *
 * Writers call `enqueueRecords(build)`; `build` turns one record into SQL statements. Pending builds are
 * drained together into one transaction, in order. A store failure never fails a run: the files are the
 * spool, and `records ingest` backfills anything that did not land.
 */
// [@agents-focus] Records writes must never throw into Flow/agent execution; errors degrade to files-only. see: src/core/records/README.md
type Build = (store: RecordStore) => SqlStatement[] | Promise<SqlStatement[]>;

type MirrorState = {
  explicit?: RecordStore | null;
  resolved?: Promise<ResolvedRecordStore | undefined>;
  resolvedAt: number;
  pending: Array<{ seq: number; build: Build }>;
  draining?: Promise<void>;
  enqueued: number;
  processed: number;
  waiters: Array<{ target: number; resolve: () => void }>;
  warned: Set<string>;
  failures: number;
};

const state: MirrorState = { pending: [], warned: new Set(), failures: 0, enqueued: 0, processed: 0, waiters: [], resolvedAt: 0 };
const context = new AsyncLocalStorage<{ nodeRunDir?: string }>();
const boundEvents = new WeakMap<object, string>();
const openedStores = new Set<ResolvedRecordStore>();
let exitHookInstalled = false;
/** After "unavailable" (lock busy, server gone), try again this often. */
const RERESOLVE_AFTER_MS = 10_000;

function warnOnce(key: string, message: string): void {
  if (state.warned.has(key)) return;
  state.warned.add(key);
  if (process.env.BAGELWERK_RECORDS_QUIET !== "1") process.stderr.write(`[bagelwerk records] ${message}\n`);
}

/**
 * Inject a store (tests, embedding hosts) or `null` to turn the mirror off. `undefined` returns to env
 * resolution. Pending writes are flushed to the previous store first.
 */
export async function configureRecords(store: RecordStore | null | undefined): Promise<void> {
  await flushRecords();
  state.explicit = store;
  state.resolved = undefined;
}

export function recordsEnabled(): boolean {
  if (state.explicit === null) return false;
  if (state.explicit) return true;
  try {
    return recordsModeFromEnv().kind !== "off";
  } catch (error) {
    warnOnce("mode", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function resolveNow(): Promise<ResolvedRecordStore | undefined> {
  state.resolvedAt = Date.now();
  const resolved = openRecordStoreFromEnv({
    purpose: `pid ${process.pid} ${process.argv.slice(1, 3).join(" ")}`.slice(0, 200),
    onUnavailable: (reason) => warnOnce("unavailable", reason),
  }).catch((error) => {
    warnOnce("open", `records store could not be opened; continuing with files only: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  void resolved.then((value) => {
    if (!value) return;
    openedStores.add(value);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once("beforeExit", () => {
        void flushRecords().finally(() => {
          for (const store of openedStores) void store.close().catch(() => undefined);
          openedStores.clear();
        });
      });
    }
  });
  return resolved;
}

/** The active store, opening it on first use. Undefined when records are off or unavailable. */
export async function getRecordStore(): Promise<RecordStore | undefined> {
  if (state.explicit === null) return undefined;
  if (state.explicit) return state.explicit;
  if (!recordsEnabled()) return undefined;
  if (!state.resolved) state.resolved = resolveNow();
  let resolved = await state.resolved;
  if (!resolved && Date.now() - state.resolvedAt > RERESOLVE_AFTER_MS) {
    state.resolved = resolveNow();
    resolved = await state.resolved;
  }
  return resolved?.store;
}

/** A records server can stop or restart; forget it so the next write re-resolves (and may become the owner). */
function invalidateRemoteStore(store: RecordStore): boolean {
  if (state.explicit || store.executor.kind !== "http") return false;
  state.resolved = undefined;
  return true;
}

export function enqueueRecords(build: Build): void {
  if (!recordsEnabled()) return;
  state.enqueued += 1;
  state.pending.push({ seq: state.enqueued, build });
  if (!state.draining) state.draining = drain();
}

/** false = the store itself is unreachable (transport); true = applied, with any bad records isolated and reported. */
async function applyGroups(store: RecordStore, groups: SqlStatement[][]): Promise<boolean> {
  try {
    await store.apply(groups.flat());
    return true;
  } catch (error) {
    if (isRecordsTransportError(error) && invalidateRemoteStore(store)) return false;
    // A SQL error: isolate the bad record so one malformed write does not drop the batch.
    for (const group of groups) {
      try {
        await store.apply(group);
      } catch (inner) {
        if (isRecordsTransportError(inner) && invalidateRemoteStore(store)) return false;
        recordFailure(inner);
      }
    }
    return true;
  }
}

async function drain(): Promise<void> {
  try {
    await new Promise((resolve) => setImmediate(resolve));
    while (state.pending.length > 0) {
      const batch = state.pending.splice(0, 500);
      const lastSeq = batch[batch.length - 1]!.seq;
      try {
        const store = await getRecordStore();
        if (store) {
          const groups: SqlStatement[][] = [];
          for (const item of batch) {
            try {
              groups.push(await item.build(store));
            } catch (error) {
              recordFailure(error);
            }
          }
          if (!(await applyGroups(store, groups))) {
            // The remote store went away: re-resolve once and retry this batch.
            const retry = await getRecordStore();
            if (!retry || !(await applyGroups(retry, groups))) recordFailure(new Error(`records store unreachable; ${groups.length} record(s) left to \`records ingest\``));
          }
        }
      } catch (error) {
        recordFailure(error);
      } finally {
        state.processed = Math.max(state.processed, lastSeq);
        releaseWaiters();
      }
    }
  } finally {
    state.draining = undefined;
    if (state.pending.length > 0) state.draining = drain();
  }
}

function releaseWaiters(): void {
  const ready = state.waiters.filter((waiter) => waiter.target <= state.processed);
  state.waiters = state.waiters.filter((waiter) => waiter.target > state.processed);
  for (const waiter of ready) waiter.resolve();
}

function recordFailure(error: unknown): void {
  state.failures += 1;
  warnOnce(`write-${state.failures > 1 ? "n" : "1"}`, `a records write failed (files are unaffected; \`records ingest\` can backfill): ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Wait until everything enqueued *before this call* is in the store. Later writes from parallel work do
 * not extend the wait. Bounded, never throws.
 */
export async function flushRecords(options: { timeoutMs?: number } = {}): Promise<void> {
  const target = state.enqueued;
  if (state.processed >= target) return;
  let timer: NodeJS.Timeout | undefined;
  await new Promise<void>((resolve) => {
    state.waiters.push({ target, resolve });
    timer = setTimeout(resolve, options.timeoutMs ?? 30_000);
    timer.unref?.();
  });
  if (timer) clearTimeout(timer);
}

export function recordsFailureCount(): number {
  return state.failures;
}

// ---------- context ----------

export function runWithRecordsContext<T>(value: { nodeRunDir?: string }, fn: () => T): T {
  return context.run({ ...context.getStore(), ...value }, fn);
}

export function currentRecordsContext(): { nodeRunDir?: string } | undefined {
  return context.getStore();
}

// ---------- flow events ----------

/** Ties an in-memory events array to the run directory that will persist it as events.json. */
export function bindRecordsEvents(events: object, ownerRunDir: string): void {
  boundEvents.set(events, ownerRunDir);
}

/** Called after an event is pushed; the ordinal matches the event's index in events.json. */
export function mirrorFlowEvent(events: unknown[], event: unknown): void {
  const ownerRunDir = boundEvents.get(events);
  if (!ownerRunDir || !recordsEnabled()) return;
  const ord = events.length - 1;
  enqueueRecords((store) => store.flowEventStatements([{ ownerRunDir, ord, event: event as Record<string, unknown> }]));
}
