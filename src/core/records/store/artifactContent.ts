import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./text";

/** Text up to this size is stored inline (searchable, restorable). Larger or binary files are referenced by path + sha256. */
export const INLINE_CONTENT_MAX_BYTES = 1024 * 1024;

export type CapturedArtifactContent = {
  present: boolean;
  bytes?: number;
  sha256?: string;
  mediaType?: string;
  contentText?: string;
};

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl", ".ndjson", ".yaml", ".yml", ".csv", ".tsv", ".html", ".xml", ".log", ".ts", ".js", ".mjs", ".cjs", ".py", ".sql", ".diff", ".patch", ".svg", ".toml"]);

export function mediaTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown";
  if (ext === ".ndjson" || ext === ".jsonl") return "application/x-ndjson";
  if (ext === ".html") return "text/html";
  if (ext === ".svg") return "image/svg+xml";
  if (TEXT_EXTENSIONS.has(ext)) return "text/plain";
  return "application/octet-stream";
}

export async function captureArtifactContent(filePath: string): Promise<CapturedArtifactContent> {
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { present: false };
    size = info.size;
  } catch {
    return { present: false };
  }
  const mediaType = mediaTypeFor(filePath);
  const buffer = await readFile(filePath);
  const out: CapturedArtifactContent = { present: true, bytes: size, sha256: sha256(buffer), mediaType };
  if (size <= INLINE_CONTENT_MAX_BYTES && !buffer.includes(0)) {
    try {
      out.contentText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      // binary: keep the reference only
    }
  }
  return out;
}
