import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const STALE_AFTER_MS = 60_000;
const HEARTBEAT_MS = 10_000;

/**
 * Cross-process, per-directory mutual exclusion for accepted/ surfaces. Held by restores (materialize) and
 * by the Flow Runner's own accept, so neither ever sees the other half-way. The holder refreshes the lock's
 * mtime, so only a lock whose holder died is taken over; release removes the file only if it is still ours.
 */
export async function withDirLock<T>(dir: string, fn: () => Promise<T>, options: { waitMs?: number } = {}): Promise<T | "busy"> {
  const lockPath = `${dir}.sync.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${randomBytes(6).toString("hex")}`;
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, token);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_AFTER_MS) unlinkSync(lockPath); // holder died
      } catch {
        // gone already
      }
      if (Date.now() > deadline) return "busy";
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      if (readFileSync(lockPath, "utf8") === token) utimesSync(lockPath, now, now);
    } catch {
      // ignore
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      if (readFileSync(lockPath, "utf8") === token) unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}
