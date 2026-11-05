import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

/**
 * PGlite has no cross-process locking. Two processes on one data directory silently lose writes
 * (measured in the Phase 0 spike: ~half the rows vanished, no error). Every in-process opener must
 * hold this lock; a records server holds it for everyone else.
 */
export type DataDirLock = { path: string; release(): void };

export type DataDirLockHolder = { pid: number; startedAt: string; purpose: string };

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockPathFor(dataDir: string): string {
  return `${path.resolve(dataDir)}.lock`;
}

export function readDataDirLock(dataDir: string): DataDirLockHolder | undefined {
  try {
    const holder = JSON.parse(readFileSync(lockPathFor(dataDir), "utf8")) as DataDirLockHolder;
    return pidAlive(holder.pid) ? holder : undefined;
  } catch {
    return undefined;
  }
}

/** A lock file that exists but cannot be parsed yet is a lock being written, not a stale one. */
const UNREADABLE_LOCK_GRACE_MS = 30_000;

function readRawLock(lockPath: string): { text: string; mtimeMs: number } | undefined {
  try {
    return { text: readFileSync(lockPath, "utf8"), mtimeMs: statSync(lockPath).mtimeMs };
  } catch {
    return undefined;
  }
}

/** Returns undefined when a live process already holds the lock. Stale locks (dead pid) are taken over. */
export function tryAcquireDataDirLock(dataDir: string, purpose: string): DataDirLock | undefined {
  const lockPath = lockPathFor(dataDir);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const holder: DataDirLockHolder = { pid: process.pid, startedAt: new Date().toISOString(), purpose };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raw = readRawLock(lockPath);
      if (!raw) continue; // vanished between open and read: retry
      let existing: DataDirLockHolder | undefined;
      try {
        existing = JSON.parse(raw.text) as DataDirLockHolder;
      } catch {
        existing = undefined;
      }
      if (!existing) {
        if (Date.now() - raw.mtimeMs < UNREADABLE_LOCK_GRACE_MS) return undefined;
      } else if (pidAlive(existing.pid)) {
        return undefined;
      }
      // Stale. Move it aside atomically (never unlink by name: that could delete a lock another process
      // created a moment ago). If what we moved is not the stale file we inspected, put it back.
      const aside = `${lockPath}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
      try {
        renameSync(lockPath, aside);
      } catch {
        continue; // someone else moved it; retry
      }
      let movedText = "";
      try {
        movedText = readFileSync(aside, "utf8");
      } catch {
        // unreadable: treat as not ours
      }
      if (movedText !== raw.text) {
        try {
          linkSync(aside, lockPath); // fails if a newer lock already exists, which is fine
        } catch {
          // ignore
        }
      }
      try {
        unlinkSync(aside);
      } catch {
        // ignore
      }
      continue;
    }
    try {
      writeSync(fd, JSON.stringify(holder));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(readFileSync(lockPath, "utf8")) as DataDirLockHolder;
        if (current.pid === process.pid) unlinkSync(lockPath);
      } catch {
        // already gone
      }
    };
    process.once("exit", release);
    return { path: lockPath, release };
  }
  return undefined;
}
