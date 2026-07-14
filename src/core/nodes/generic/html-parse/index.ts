import * as cheerio from "cheerio";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { readAcceptedArtifactText, resolveRunDir, writeArtifactFile } from "../runtimeAccess";

// core.html-parse — a GENERIC, domain-neutral distillation node (cheerio). Its job is to keep a wall
// of raw HTML from ever reaching a model: it runs a deterministic ladder (structured data → caller
// selector fields → bounded readable text) and ALWAYS emits a size-bounded payload, with per-probe
// failure reasons so a caller can see exactly what could not be extracted. Recipe (or any domain)
// semantics live in the caller, injected via the `fields` selector map — this node never knows what
// an "ingredient" is.

/** One itemscope's flattened microdata properties. */
export type MicrodataItem = { type?: string; props: Record<string, string[]> };

/** Telemetry for one caller field-selector attempt — the raw material of the capability-gap ledger. */
export type FieldProbe = { field: string; selector: string; matchCount: number; emitted: number; reason?: "no_match" | "matched_empty" };

export type HtmlParseResult = {
  title?: string;
  description?: string;
  /** Parsed application/ld+json objects (flattened from arrays/@graph); preferJsonLdType bubbles to front. */
  jsonLd: Record<string, unknown>[];
  /** itemscope/itemprop microdata as a fallback when JSON-LD is absent. */
  microdata: MicrodataItem[];
  /** Caller-named fields: text under each field's selectors (deduped). Empty arrays when nothing matched. */
  fields: Record<string, string[]>;
  /** h1–h6 outline of the main content (post-boilerplate-chop). */
  outline: { level: number; text: string }[];
  /** Boilerplate-stripped main content as compact markdown, capped at maxChars. */
  condensed: string;
  /** Which rung of the ladder produced usable signal — "none" tells the caller to drop the page. */
  extraction: "structured" | "fields" | "readable" | "none";
  probes: FieldProbe[];
  stats: { originalChars: number; condensedChars: number; reductionPct: number; truncated: boolean };
};

export type ParseHtmlOptions = {
  /** Named field → CSS selectors; the node returns matched text per field (caller maps it to meaning). */
  fields?: Record<string, string[]>;
  /** Extra boilerplate selectors to drop, on top of the conservative default set. */
  exclude?: string[];
  /** Hard cap on the condensed readable payload (chars). Backstop only — structured-first usually wins. */
  maxChars?: number;
  /** JSON-LD blocks whose @type contains this string are sorted first (e.g. "recipe"). */
  preferJsonLdType?: string;
};

export type HtmlParseArtifact = {
  schemaVersion: 1;
  nodeType: "core.html-parse";
  nodeId: string;
  parsedAt: string;
} & HtmlParseResult;

export type HtmlParseNodePayload = {
  finalVerdict: "html_parse_completed" | "html_parse_empty";
  result: HtmlParseResult;
  artifactFiles: EmittedNodeArtifactRecord[];
};

const DEFAULT_MAX_CHARS = 8000;

// Conservative chop set: structural non-content + KNOWN ad/nav/footer/comment containers only.
// Deliberately avoids broad `[class*=ad]` matching, which false-positives on content like
// `ingredient-add` / `add-to-list`. Targeted field selectors do the real precision work.
const DEFAULT_DROP = [
  "script", "style", "noscript", "template", "svg", "iframe", "form", "button", "input", "select", "label",
  "nav", "header", "footer", "aside",
  "[role=navigation]", "[role=banner]", "[role=contentinfo]", "[aria-hidden=true]",
  "#comments", ".comments", "[id*=comment]",
  ".related", "[class*=related-]", ".newsletter", "[class*=newsletter]", ".social", "[class*=share-]",
  "ins.adsbygoogle", ".ad", ".ads", ".advert", "[class*=advert]", "[id*=google_ads]",
];

function tagOf($el: cheerio.Cheerio<never>): string {
  return ($el.prop("tagName") ?? "").toLowerCase();
}

function typeMatches(typeValue: unknown, needle: string): boolean {
  const n = needle.toLowerCase();
  if (typeof typeValue === "string") return typeValue.toLowerCase().includes(n);
  if (Array.isArray(typeValue)) return typeValue.some((t) => typeof t === "string" && t.toLowerCase().includes(n));
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Flatten an application/ld+json payload (object, array, or {@graph:[...]}) into top-level nodes. */
function flattenJsonLd(parsed: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(parsed)) {
    for (const entry of parsed) flattenJsonLd(entry, out);
    return;
  }
  if (!isRecord(parsed)) return;
  if (Array.isArray(parsed["@graph"])) {
    for (const entry of parsed["@graph"]) flattenJsonLd(entry, out);
    return;
  }
  out.push(parsed);
}

function extractJsonLd($: cheerio.CheerioAPI, preferType?: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const body = $(el).contents().text().trim();
    if (!body) return;
    try {
      flattenJsonLd(JSON.parse(body), blocks);
    } catch {
      // Skip malformed JSON-LD rather than failing the parse.
    }
  });
  if (preferType) {
    blocks.sort((a, b) => Number(typeMatches(b["@type"], preferType)) - Number(typeMatches(a["@type"], preferType)));
  }
  return blocks;
}

function extractMicrodata($: cheerio.CheerioAPI): MicrodataItem[] {
  const items: MicrodataItem[] = [];
  $("[itemscope]").each((_, el) => {
    const $el = $(el);
    const props: Record<string, string[]> = {};
    $el.find("[itemprop]").each((_, p) => {
      const $p = $(p);
      const name = $p.attr("itemprop");
      if (!name) return;
      const val = ($p.attr("content") || $p.text() || "").replace(/\s+/g, " ").trim();
      if (!val) return;
      (props[name] ??= []).push(val);
    });
    if (Object.keys(props).length === 0) return;
    const type = $el.attr("itemtype");
    items.push(type ? { type, props } : { props });
  });
  return items.slice(0, 50);
}

function extractMeta($: cheerio.CheerioAPI): { title?: string; description?: string } {
  const title = ($('meta[property="og:title"]').attr("content") || $("title").first().text() || "").replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "").replace(/\s+/g, " ").trim();
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
}

function runFields($: cheerio.CheerioAPI, fields: Record<string, string[]> | undefined): { fields: Record<string, string[]>; probes: FieldProbe[] } {
  const out: Record<string, string[]> = {};
  const probes: FieldProbe[] = [];
  for (const [field, selectors] of Object.entries(fields ?? {})) {
    const collected: string[] = [];
    for (const selector of selectors) {
      const before = collected.length;
      let matchCount = 0;
      $(selector).each((_, el) => {
        matchCount += 1;
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text) collected.push(text);
      });
      const emitted = collected.length - before;
      probes.push({ field, selector, matchCount, emitted, ...(matchCount === 0 ? { reason: "no_match" as const } : emitted === 0 ? { reason: "matched_empty" as const } : {}) });
    }
    out[field] = [...new Set(collected)];
  }
  return { fields: out, probes };
}

function pickMainRegion($: cheerio.CheerioAPI): cheerio.Cheerio<never> {
  for (const selector of ["main", "article", "[role=main]"]) {
    const found = $(selector).first() as cheerio.Cheerio<never>;
    if (found.length && found.text().trim().length > 200) return found;
  }
  const body = $("body").first() as cheerio.Cheerio<never>;
  return body.length ? body : ($.root() as cheerio.Cheerio<never>);
}

function regionToMarkdown($: cheerio.CheerioAPI, region: cheerio.Cheerio<never>): string {
  const parts: string[] = [];
  region.find("h1,h2,h3,h4,h5,h6,p,li,blockquote").each((_, el) => {
    const $el = $(el) as cheerio.Cheerio<never>;
    const tag = tagOf($el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (/^h[1-6]$/.test(tag)) parts.push(`${"#".repeat(Number(tag[1]))} ${text}`);
    else if (tag === "li") parts.push(`- ${text}`);
    else parts.push(text);
  });
  // Drop consecutive duplicates (nested block elements repeat their descendants' text).
  return parts.filter((line, i) => line !== parts[i - 1]).join("\n");
}

function buildOutline($: cheerio.CheerioAPI, region: cheerio.Cheerio<never>): { level: number; text: string }[] {
  const outline: { level: number; text: string }[] = [];
  region.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const $el = $(el) as cheerio.Cheerio<never>;
    const tag = tagOf($el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text) outline.push({ level: Number(tag[1]), text });
  });
  return outline.slice(0, 60);
}

/**
 * Parse raw HTML into a compact, bounded, model-ready result. NEVER returns raw HTML. Structured
 * data (JSON-LD / microdata) and caller field selectors are read from the ORIGINAL document; the
 * readable markdown pass runs AFTER boilerplate is chopped and is hard-capped at maxChars.
 */
export function parseHtml(html: string, options: ParseHtmlOptions = {}): HtmlParseResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const $ = cheerio.load(html);

  // 1) Structured + meta + caller fields — BEFORE chopping (script/JSON-LD would otherwise be removed).
  const { title, description } = extractMeta($);
  const jsonLd = extractJsonLd($, options.preferJsonLdType);
  const microdata = extractMicrodata($);
  const { fields, probes } = runFields($, options.fields);

  // 2) Chop boilerplate for the readable pass.
  for (const selector of [...DEFAULT_DROP, ...(options.exclude ?? [])]) {
    try {
      $(selector).remove();
    } catch {
      // Ignore an invalid caller selector rather than failing the whole parse.
    }
  }

  // 3) Readable main content → compact markdown, hard-capped.
  const region = pickMainRegion($);
  const outline = buildOutline($, region);
  const fullMarkdown = regionToMarkdown($, region);
  let condensed = fullMarkdown;
  let truncated = false;
  if (condensed.length > maxChars) {
    const cut = condensed.slice(0, maxChars);
    const lastBreak = cut.lastIndexOf("\n");
    condensed = (lastBreak > maxChars * 0.5 ? cut.slice(0, lastBreak) : cut).trimEnd();
    truncated = true;
  }

  const hasFields = Object.values(fields).some((values) => values.length > 0);
  const extraction: HtmlParseResult["extraction"] = jsonLd.length || microdata.length
    ? "structured"
    : hasFields
      ? "fields"
      : condensed
        ? "readable"
        : "none";

  const originalChars = html.length;
  const condensedChars = condensed.length;
  const reductionPct = originalChars > 0 ? Math.round((1 - condensedChars / originalChars) * 100) : 0;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    jsonLd,
    microdata,
    fields,
    outline,
    condensed,
    extraction,
    probes,
    stats: { originalChars, condensedChars, reductionPct, truncated },
  };
}

export const HtmlParseNodeParamsSchema = z.object({
  htmlRelativePath: z.string().trim().min(1).default("page.html"),
  fields: z.record(z.array(z.string().trim().min(1))).optional(),
  exclude: z.array(z.string().trim().min(1)).optional(),
  maxChars: z.number().int().positive().max(200000).default(DEFAULT_MAX_CHARS),
  preferJsonLdType: z.string().trim().min(1).optional(),
  artifactBaseName: z.string().trim().min(1).regex(/^[a-zA-Z0-9._-]+$/, "artifactBaseName must be a safe file base name").default("html-parse"),
}).strict();

export type HtmlParseNodeParams = z.infer<typeof HtmlParseNodeParamsSchema>;

export async function runHtmlParseNode(args: {
  nodeId: string;
  params: HtmlParseNodeParams;
  input: unknown;
  /** Inject HTML directly (tests); otherwise read the upstream raw-HTML artifact. */
  html?: string;
  now?: () => Date;
}): Promise<NodeResult<HtmlParseNodePayload>> {
  const html = args.html ?? await readAcceptedArtifactText(args.input, args.params.htmlRelativePath);
  const result = parseHtml(html, {
    ...(args.params.fields ? { fields: args.params.fields } : {}),
    ...(args.params.exclude ? { exclude: args.params.exclude } : {}),
    maxChars: args.params.maxChars,
    ...(args.params.preferJsonLdType ? { preferJsonLdType: args.params.preferJsonLdType } : {}),
  });

  const artifact: HtmlParseArtifact = {
    schemaVersion: 1,
    nodeType: "core.html-parse",
    nodeId: args.nodeId,
    parsedAt: (args.now ?? (() => new Date()))().toISOString(),
    ...result,
  };

  const file = await writeArtifactFile(resolveRunDir(args.input), `${args.params.artifactBaseName}.json`, JSON.stringify(artifact, null, 2), "Parsed HTML JSON");

  return {
    status: "completed",
    note: `Parsed HTML (${result.extraction}); ${result.stats.reductionPct}% size reduction, ${result.condensed.length} condensed char(s).`,
    payload: {
      finalVerdict: result.extraction === "none" ? "html_parse_empty" : "html_parse_completed",
      result,
      artifactFiles: [file],
    },
  };
}

export const coreHtmlParseNodeTypeEntry: NodeTypeEntry<HtmlParseNodeParams, unknown, HtmlParseNodePayload> = {
  nodeType: "core.html-parse",
  label: "Core HTML Parse",
  validateParams: (value: unknown) => HtmlParseNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runHtmlParseNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = HtmlParseNodeParamsSchema.parse(params);
    return {
      outputs: [{ key: `${parsed.artifactBaseName}.json`, label: "Parsed HTML JSON", relativePath: `${parsed.artifactBaseName}.json`, kind: "contract" }],
    };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
