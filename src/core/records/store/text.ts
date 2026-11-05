import { createHash } from "node:crypto";

export function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** ltree labels allow [A-Za-z0-9_-]; node paths use '.' as the separator already. */
export function toLtree(nodePath: string | undefined | null): string | null {
  if (!nodePath) return null;
  // "-" is only legal from Postgres 16; map it too so the same paths work on older servers.
  const labels = nodePath.split(".").map((label) => label.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 255) || "_");
  return labels.join(".");
}

/** JSON for search bodies: compact, bounded, strings unquoted-ish so FTS sees words. */
export function searchableJson(value: unknown, maxChars = 16_000): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.slice(0, maxChars);
  value = redactJson(value);
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return (text ?? "").replace(/\\n/g, "\n").replace(/\\"/g, '"').slice(0, maxChars);
}

/** Postgres text cannot hold NUL. */
export function pgText(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return value.includes("\u0000") ? value.replace(/\u0000/g, "") : value;
}

// Not bare "token": inputTokens / max_tokens / tokenUsage are counts, not credentials.
const SECRET_KEY = /(api[_-]?key|access[_-]?key|secret|password|passwd|authorization|cookie|private[_-]?key|credential|^token$|(access|auth|refresh|bearer|session|id|api|github|gh|npm|slack)[_-]?token$)/i;
const SECRET_VALUE = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g,
  /(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+(@)/g,
];

/** Known credential shapes become [redacted]. Applied to everything searchable or agent-readable. */
export function redactText(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE) {
    out = out.replace(pattern, (match, ...groups) => {
      const prefix = typeof groups[0] === "string" && match.startsWith(groups[0]) ? groups[0] : "";
      const suffix = typeof groups[1] === "string" && match.endsWith(groups[1]) && groups[1] !== prefix ? groups[1] : "";
      return `${prefix}[redacted]${suffix}`;
    });
  }
  return out;
}

export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 40) return "[truncated]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) && typeof item === "string" && item.length > 0 ? "[redacted]" : redactJson(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacted text, NUL-free. */
export function pgSafeText(value: string | undefined | null): string | null {
  const text = pgText(value);
  return text === null ? null : redactText(text);
}

/** Exact JSON (no redaction) for records that must round-trip, e.g. accepted-selection.json. */
export function pgRawJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return pgText(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** Redacted JSON for jsonb columns. */
export function pgJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return pgText(JSON.stringify(redactJson(value)));
  } catch {
    return null;
  }
}

export function chunkText(body: string, size = 4000, overlap = 200, maxChunks = 250): string[] {
  const text = body.trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n", end);
      if (breakAt > start + size / 2) end = breakAt;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
