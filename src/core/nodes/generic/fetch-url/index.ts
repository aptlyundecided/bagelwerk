import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";

/** One in-page anchor: absolutized href + its visible text (tag-stripped). */
export type PageLink = { url: string; text?: string };

/** A single fetched page: real content + any embedded schema.org JSON-LD (Recipe blocks first). */
export type FetchUrlResult = {
  requestedUrl: string;
  ok: boolean;
  status: number;
  finalUrl: string;
  /** Script/style stripped, tag-stripped, whitespace-collapsed page text (capped). */
  contentText: string;
  /** Parsed `application/ld+json` objects (flattened from arrays/@graph), Recipe types first. */
  jsonLd: Record<string, unknown>[];
  /** http(s) anchors found on the page, absolutized against finalUrl, deduped, capped. */
  links: PageLink[];
  /** Raw (byte-capped) HTML — populated ONLY when called with includeRawHtml (e.g. for a downstream
   * core.html-parse pass). Omitted by default so the fetch-url node artifact stays lean. */
  html?: string;
  error?: string;
};

export type FetchUrlArtifact = {
  schemaVersion: 1;
  nodeType: "core.fetch-url";
  nodeId: string;
  fetchedAt: string;
} & FetchUrlResult;

export type FetchUrlNodePayload = {
  finalVerdict: "fetch_url_completed" | "fetch_url_failed";
  result: FetchUrlResult;
  artifactFiles: EmittedNodeArtifactRecord[];
};

export type FetchLike = (input: string | URL, init?: { signal?: AbortSignal; redirect?: "follow" }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  url?: string;
  text(): Promise<string>;
}>;

const MAX_CONTENT_TEXT_CHARS = 20000;
const MAX_LINKS = 200;

export const FetchUrlNodeParamsSchema = z.object({
  url: z.string().trim().url(),
  timeoutMs: z.number().int().positive().max(120000).default(12000),
  maxBytes: z.number().int().positive().max(20_000_000).default(2_000_000),
  artifactBaseName: z.string().trim().min(1).regex(/^[a-zA-Z0-9._-]+$/, "artifactBaseName must be a safe file base name").default("fetch-url"),
}).strict();

export type FetchUrlNodeParams = z.infer<typeof FetchUrlNodeParamsSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveRunDir(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const runtime = input.runtime;
  if (isRecord(runtime) && isRecord(runtime.record) && typeof runtime.record.runDir === "string") {
    return runtime.record.runDir;
  }
  const workbench = input.workbench;
  if (isRecord(workbench) && isRecord(workbench.record) && typeof workbench.record.runDir === "string") {
    return workbench.record.runDir;
  }
  return undefined;
}

function typeContainsRecipe(value: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("recipe");
  if (Array.isArray(value)) return value.some((entry) => typeof entry === "string" && entry.toLowerCase().includes("recipe"));
  return false;
}

/** Flatten an `application/ld+json` payload (object, array, or {@graph:[...]}) into top-level nodes. */
function flattenJsonLd(parsed: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(parsed)) {
    for (const entry of parsed) flattenJsonLd(entry, out);
    return;
  }
  if (!isRecord(parsed)) return;
  if (Array.isArray(parsed["@graph"])) {
    for (const entry of parsed["@graph"]) flattenJsonLd(entry, out);
    // keep the wrapper too in case it carries useful context, but graph nodes are what we want
    return;
  }
  out.push(parsed);
}

/** Extract every JSON-LD block from raw HTML, returning Recipe-typed nodes first. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      flattenJsonLd(JSON.parse(body), blocks);
    } catch {
      // Skip malformed JSON-LD blocks rather than failing the fetch.
    }
  }
  return blocks.sort((a, b) => Number(typeContainsRecipe(b["@type"])) - Number(typeContainsRecipe(a["@type"])));
}

/** Pull http(s) anchors out of raw HTML — absolutized against baseUrl, deduped, capped. */
export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const regex = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null && links.length < MAX_LINKS) {
    const href = match[1]!.trim();
    if (!href || href.startsWith("#")) continue;
    let absolute: string;
    try {
      const parsed = new URL(href, baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      parsed.hash = "";
      absolute = parsed.toString();
    } catch {
      continue;
    }
    const key = absolute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = match[2]!.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    links.push(text ? { url: absolute, text } : { url: absolute });
  }
  return links;
}

/** Strip a page to readable text (no scripts/styles/tags), collapse whitespace, cap length. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_TEXT_CHARS);
}

/**
 * Fetch one URL and extract its content + JSON-LD. NEVER throws — a network error, non-2xx, or
 * timeout resolves to `{ ok: false, error }` so callers (especially parallel fan-out) can skip a
 * bad candidate without failing the whole run.
 */
export async function fetchUrlContent(args: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  fetchImpl?: FetchLike;
  /** Also return the raw (capped) HTML on `result.html` — for a downstream cheerio/html-parse pass. */
  includeRawHtml?: boolean;
}): Promise<FetchUrlResult> {
  const base: FetchUrlResult = { requestedUrl: args.url, ok: false, status: 0, finalUrl: args.url, contentText: "", jsonLd: [], links: [] };
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) return { ...base, error: "global fetch is unavailable; core.fetch-url requires a fetch implementation." };

  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), args.timeoutMs) : undefined;
  try {
    const response = await fetchImpl(args.url, { redirect: "follow", ...(controller ? { signal: controller.signal } : {}) });
    const raw = await response.text();
    const html = raw.length > args.maxBytes ? raw.slice(0, args.maxBytes) : raw;
    const result: FetchUrlResult = {
      requestedUrl: args.url,
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || args.url,
      contentText: htmlToText(html),
      jsonLd: extractJsonLd(html),
      links: extractLinks(html, response.url || args.url),
      ...(args.includeRawHtml ? { html } : {}),
    };
    if (!response.ok) result.error = `HTTP ${response.status} ${response.statusText}`;
    return result;
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeFetchUrlArtifacts(args: {
  runDir: string | undefined;
  artifactBaseName: string;
  artifact: FetchUrlArtifact;
}): Promise<EmittedNodeArtifactRecord[]> {
  if (!args.runDir) return [];
  await mkdir(args.runDir, { recursive: true });
  const jsonRelativePath = `${args.artifactBaseName}.json`;
  const jsonPath = path.join(args.runDir, jsonRelativePath);
  await writeFile(jsonPath, `${JSON.stringify(args.artifact, null, 2)}\n`, "utf8");
  return [{ key: jsonRelativePath, label: "Fetched Page JSON", path: jsonPath, relativePath: jsonRelativePath, required: true }];
}

export async function runFetchUrlNode(args: {
  nodeId: string;
  params: FetchUrlNodeParams;
  input: unknown;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<NodeResult<FetchUrlNodePayload>> {
  const result = await fetchUrlContent({ url: args.params.url, timeoutMs: args.params.timeoutMs, maxBytes: args.params.maxBytes, fetchImpl: args.fetchImpl });
  const artifact: FetchUrlArtifact = {
    schemaVersion: 1,
    nodeType: "core.fetch-url",
    nodeId: args.nodeId,
    fetchedAt: (args.now ?? (() => new Date()))().toISOString(),
    ...result,
  };
  const artifactFiles = await writeFetchUrlArtifacts({
    runDir: resolveRunDir(args.input),
    artifactBaseName: args.params.artifactBaseName,
    artifact,
  });

  if (!result.ok) {
    return {
      status: "failed",
      note: `Fetch failed for ${args.params.url}: ${result.error ?? "unknown error"}.`,
      payload: { finalVerdict: "fetch_url_failed", result, artifactFiles },
    };
  }
  return {
    status: "completed",
    note: `Fetched ${result.finalUrl} (${result.jsonLd.length} JSON-LD block(s), ${result.contentText.length} text char(s)).`,
    payload: { finalVerdict: "fetch_url_completed", result, artifactFiles },
  };
}

export const coreFetchUrlNodeTypeEntry: NodeTypeEntry<FetchUrlNodeParams, unknown, FetchUrlNodePayload> = {
  nodeType: "core.fetch-url",
  label: "Core Fetch URL",
  validateParams: (value: unknown) => FetchUrlNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runFetchUrlNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = FetchUrlNodeParamsSchema.parse(params);
    return {
      outputs: [{ key: `${parsed.artifactBaseName}.json`, label: "Fetched Page JSON", relativePath: `${parsed.artifactBaseName}.json`, kind: "contract" }],
    };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
