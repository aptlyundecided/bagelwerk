import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { acceptanceStatementsFromDir } from "../ingest/ingest";
import { withDirLock } from "./dirLock";
import { flushRecords, getRecordStore } from "../mirror/recordsMirror";
import type { AcceptanceRow, NodeArtifactRow, RecordStore } from "../store/recordStore";
import { sha256 } from "../store/text";

export type AcceptedSurfaceSync =
  | "no-store"
  | "no-record"
  | "in-sync"
  | "materialized"
  | "incomplete"
  /** accepted/ is newer than the store (e.g. written while the store was busy or off): files kept, store updated. */
  | "healed-store"
  /** another process is syncing this directory; nothing changed. */
  | "busy";

type Selection = { runDir?: string; acceptedAt?: string };

async function readSelection(acceptedDir: string): Promise<Selection | undefined> {
  try {
    return JSON.parse(await readFile(path.join(acceptedDir, "accepted-selection.json"), "utf8")) as Selection;
  } catch {
    return undefined;
  }
}

async function fileSha(filePath: string): Promise<{ size: number; sha: string } | undefined> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    return { size: info.size, sha: sha256(await readFile(filePath)) };
  } catch {
    return undefined;
  }
}

function sameAcceptance(selection: Selection, acceptance: AcceptanceRow): boolean {
  if (!selection.runDir || path.resolve(selection.runDir) !== path.resolve(acceptance.run_dir)) return false;
  return !selection.acceptedAt || Date.parse(selection.acceptedAt) === Date.parse(acceptance.accepted_at);
}

/**
 * The Record Store is the authority for which run is accepted; `accepted/` is a materialised cache that
 * downstream Nodes and agents read.
 *
 * - store has the same acceptance and content matches (sha256): in-sync
 * - store has the same acceptance but content is damaged or missing: restore from the store
 * - accepted/ is missing or unreadable: restore from the store
 * - accepted/ holds a strictly NEWER acceptance than the store: files win; the store is healed from them
 * - accepted/ holds an older or unknown acceptance: the store wins; restore
 * - the store has no acceptance at all: files decide (and are recorded into the store)
 */
// [@agents-focus] Authority flip: never overwrite a newer accepted/ with an older store row. see: src/core/records/README.md
export async function syncAcceptedSurfaceFromRecords(args: {
  artifactRoot: string;
  sessionId: string;
  nodePath: string;
  acceptedDir: string;
  store?: RecordStore;
}): Promise<AcceptedSurfaceSync> {
  let store = args.store;
  if (!store) {
    await flushRecords();
    store = await getRecordStore();
  }
  if (!store) return "no-store";
  const resolvedStore = store;
  const artifactRoot = path.resolve(args.artifactRoot);
  const outcome = await withDirLock(args.acceptedDir, async (): Promise<AcceptedSurfaceSync> => {
    let acceptance: AcceptanceRow | undefined;
    try {
      acceptance = await resolvedStore.getCurrentAcceptance(artifactRoot, args.sessionId, args.nodePath);
    } catch {
      return "no-store";
    }
    const selection = await readSelection(args.acceptedDir);
    if (!acceptance) {
      if (!selection?.runDir) return "no-record";
      if (await resolvedStore.isAcceptanceWithdrawn(artifactRoot, args.sessionId, args.nodePath, path.resolve(selection.runDir), selection.acceptedAt)) return "no-record";
      return (await healStoreFromFiles(resolvedStore, args.acceptedDir)) ? "healed-store" : "no-record";
    }
    if (selection && sameAcceptance(selection, acceptance)) {
      if (await acceptedSurfaceMatches(resolvedStore, acceptance, args.acceptedDir)) return "in-sync";
      return materializeAcceptance(resolvedStore, acceptance, args.acceptedDir);
    }
    if (selection?.runDir && selection.acceptedAt && Date.parse(selection.acceptedAt) > Date.parse(acceptance.accepted_at)) {
      return (await healStoreFromFiles(resolvedStore, args.acceptedDir)) ? "healed-store" : "in-sync";
    }
    return materializeAcceptance(resolvedStore, acceptance, args.acceptedDir);
  });
  return outcome;
}

async function healStoreFromFiles(store: RecordStore, acceptedDir: string): Promise<boolean> {
  try {
    await store.apply(await acceptanceStatementsFromDir(store, acceptedDir));
    return true;
  } catch {
    return false;
  }
}

function presentArtifacts(rows: NodeArtifactRow[]): NodeArtifactRow[] {
  return rows.filter((row) => row.present === true);
}

export async function acceptedSurfaceMatches(store: RecordStore, acceptance: AcceptanceRow, acceptedDir: string): Promise<boolean> {
  const selection = await readSelection(acceptedDir);
  if (!selection || !sameAcceptance(selection, acceptance)) return false;
  for (const artifact of presentArtifacts(await store.listNodeArtifacts(acceptance.run_dir))) {
    const disk = await fileSha(path.join(acceptedDir, artifact.relative_path));
    if (!disk) return false;
    if (artifact.sha256 ? disk.sha !== artifact.sha256 : artifact.bytes !== null && artifact.bytes !== undefined && Number(artifact.bytes) !== disk.size) return false;
  }
  return true;
}

/**
 * Writes into a staging directory and swaps it in (old → trash, staging → dir, then drop trash; on failure
 * the old directory is put back), so a failed or interrupted restore never loses the existing surface.
 */
export async function materializeAcceptance(store: RecordStore, acceptance: AcceptanceRow, acceptedDir: string): Promise<"materialized" | "incomplete"> {
  const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const staging = `${acceptedDir}.restore-${suffix}`;
  await mkdir(staging, { recursive: true });
  try {
    for (const artifact of presentArtifacts(await store.listNodeArtifacts(acceptance.run_dir))) {
      const target = path.join(staging, artifact.relative_path);
      if (!target.startsWith(staging + path.sep)) throw new Error(`refusing artifact path outside the accepted dir: ${artifact.relative_path}`);
      await mkdir(path.dirname(target), { recursive: true });
      if (artifact.content_text !== null && artifact.content_text !== undefined && (!artifact.sha256 || sha256(artifact.content_text) === artifact.sha256)) {
        await writeFile(target, artifact.content_text, "utf8");
        continue;
      }
      // Per-run copy first: the canonical path is the Node's output location and can be rewritten by later runs.
      const candidates = [path.join(acceptance.run_dir, artifact.relative_path), artifact.canonical_path, path.join(acceptedDir, artifact.relative_path)].filter(Boolean) as string[];
      let copied = false;
      for (const candidate of candidates) {
        const disk = await fileSha(candidate);
        if (!disk) continue;
        if (artifact.sha256 ? disk.sha !== artifact.sha256 : artifact.bytes !== null && artifact.bytes !== undefined && Number(artifact.bytes) !== disk.size) continue;
        await cp(candidate, target);
        copied = true;
        break;
      }
      if (!copied) {
        await rm(staging, { recursive: true, force: true });
        return "incomplete";
      }
    }
    await writeFile(path.join(staging, "accepted-selection.json"), `${JSON.stringify(acceptance.record, null, 2)}\n`, "utf8");
    await mkdir(path.dirname(acceptedDir), { recursive: true });
    const trash = `${acceptedDir}.old-${suffix}`;
    let movedOld = false;
    try {
      await rename(acceptedDir, trash);
      movedOld = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, acceptedDir);
    } catch (error) {
      if (movedOld) await rename(trash, acceptedDir).catch(() => undefined);
      throw error;
    }
    if (movedOld) await rm(trash, { recursive: true, force: true }).catch(() => undefined);
    return "materialized";
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
