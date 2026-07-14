import * as cheerio from "cheerio";

// cheerio-probe — the sanctioned, BOUNDED cheerio toolset an agent uses to interrogate a downloaded
// HTML artifact "a bit at a time". It is the agent's ONLY door to the page: raw-HTML file read is
// withheld from the agent's workspace (enforced at the finder wiring), so the agent cannot slurp the
// document — every op here returns a small, capped result. Domain-neutral: it exposes DOM queries,
// not recipe semantics. Failures (no match / empty) are returned, not thrown, so they can feed the
// capability-gap ledger.

export const PROBE_LIMITS = {
  maxItems: 60,
  maxItemChars: 300,
  maxTextChars: 4000,
  maxSamples: 6,
  maxJsonLd: 20,
  maxJsonLdKeyChars: 8000,
  maxFind: 20,
} as const;

export type ProbeOp = "outline" | "jsonld" | "microdata" | "query" | "list" | "text" | "attr" | "find";

export const PROBE_OPS: ProbeOp[] = ["outline", "jsonld", "microdata", "query", "list", "text", "attr", "find"];

export type ProbeArgs = { selector?: string; name?: string; keyword?: string; preferType?: string };

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function tagOf($el: cheerio.Cheerio<never>): string {
  return ($el.prop("tagName") ?? "").toLowerCase();
}

function typeMatches(typeValue: unknown, needle: string): boolean {
  const n = needle.toLowerCase();
  if (typeof typeValue === "string") return typeValue.toLowerCase().includes(n);
  if (Array.isArray(typeValue)) return typeValue.some((t) => typeof t === "string" && t.toLowerCase().includes(n));
  return false;
}

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

/** Replace any top-level value that stringifies huge with a marker, so a block stays bounded. */
function boundBlock(block: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    const serialized = JSON.stringify(value) ?? "";
    out[key] = serialized.length > PROBE_LIMITS.maxJsonLdKeyChars ? `[omitted: ${serialized.length} chars]` : value;
  }
  return out;
}

export function probeOutline(html: string): { level: number; text: string }[] {
  const $ = cheerio.load(html);
  const out: { level: number; text: string }[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    if (out.length >= PROBE_LIMITS.maxItems) return;
    const $el = $(el) as cheerio.Cheerio<never>;
    const text = norm($el.text());
    if (text) out.push({ level: Number(tagOf($el)[1]), text: clamp(text, PROBE_LIMITS.maxItemChars) });
  });
  return out;
}

export function probeJsonLd(html: string, preferType?: string): { count: number; blocks: Record<string, unknown>[]; truncated: boolean } {
  const $ = cheerio.load(html);
  const blocks: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const body = $(el).contents().text().trim();
    if (!body) return;
    try {
      flattenJsonLd(JSON.parse(body), blocks);
    } catch {
      // skip malformed
    }
  });
  if (preferType) blocks.sort((a, b) => Number(typeMatches(b["@type"], preferType)) - Number(typeMatches(a["@type"], preferType)));
  const capped = blocks.slice(0, PROBE_LIMITS.maxJsonLd).map(boundBlock);
  return { count: blocks.length, blocks: capped, truncated: blocks.length > capped.length };
}

export function probeMicrodata(html: string): { count: number; items: { type?: string; props: Record<string, string[]> }[] } {
  const $ = cheerio.load(html);
  const items: { type?: string; props: Record<string, string[]> }[] = [];
  $("[itemscope]").each((_, el) => {
    if (items.length >= PROBE_LIMITS.maxItems) return;
    const $el = $(el);
    const props: Record<string, string[]> = {};
    $el.find("[itemprop]").each((_, p) => {
      const $p = $(p);
      const name = $p.attr("itemprop");
      if (!name) return;
      const val = norm($p.attr("content") || $p.text() || "");
      if (!val) return;
      (props[name] ??= []).push(clamp(val, PROBE_LIMITS.maxItemChars));
    });
    if (Object.keys(props).length === 0) return;
    const type = $el.attr("itemtype");
    items.push(type ? { type, props } : { props });
  });
  return { count: items.length, items };
}

export function probeQuery(html: string, selector: string): { selector: string; matchCount: number; samples: string[] } {
  const $ = cheerio.load(html);
  const all = $(selector);
  const samples: string[] = [];
  all.each((_, el) => {
    if (samples.length >= PROBE_LIMITS.maxSamples) return;
    samples.push(clamp(norm($(el).text()), PROBE_LIMITS.maxItemChars));
  });
  return { selector, matchCount: all.length, samples };
}

export function probeList(html: string, selector: string): { selector: string; matchCount: number; items: string[]; truncated: boolean } {
  const $ = cheerio.load(html);
  const all = $(selector);
  const items: string[] = [];
  all.each((_, el) => {
    if (items.length >= PROBE_LIMITS.maxItems) return;
    const text = norm($(el).text());
    if (text) items.push(clamp(text, PROBE_LIMITS.maxItemChars));
  });
  return { selector, matchCount: all.length, items, truncated: all.length > items.length };
}

export function probeText(html: string, selector: string): { selector: string; matchCount: number; text: string; truncated: boolean } {
  const $ = cheerio.load(html);
  const all = $(selector);
  const joined = norm(all.map((_, el) => $(el).text()).get().join(" "));
  return { selector, matchCount: all.length, text: clamp(joined, PROBE_LIMITS.maxTextChars), truncated: joined.length > PROBE_LIMITS.maxTextChars };
}

export function probeAttr(html: string, selector: string, name: string): { selector: string; name: string; matchCount: number; values: string[] } {
  const $ = cheerio.load(html);
  const all = $(selector);
  const values: string[] = [];
  all.each((_, el) => {
    if (values.length >= PROBE_LIMITS.maxItems) return;
    const value = $(el).attr(name);
    if (value) values.push(clamp(norm(value), PROBE_LIMITS.maxItemChars));
  });
  return { selector, name, matchCount: all.length, values };
}

export function probeFind(html: string, keyword: string): { keyword: string; matchCount: number; hits: { tag: string; id?: string; class?: string; snippet: string }[] } {
  const $ = cheerio.load(html);
  const needle = keyword.toLowerCase();
  const hits: { tag: string; id?: string; class?: string; snippet: string }[] = [];
  // Section landmarks where a keyword like "ingredients" / "instructions" tends to be labelled.
  $("h1,h2,h3,h4,h5,h6,th,dt,strong,b,label,summary,legend").each((_, el) => {
    if (hits.length >= PROBE_LIMITS.maxFind) return;
    const $el = $(el) as cheerio.Cheerio<never>;
    const text = norm($el.text());
    if (!text.toLowerCase().includes(needle)) return;
    const id = $el.attr("id");
    const cls = $el.attr("class");
    hits.push({
      tag: tagOf($el),
      ...(id ? { id } : {}),
      ...(cls ? { class: clamp(cls, 120) } : {}),
      snippet: clamp(text, 160),
    });
  });
  return { keyword, matchCount: hits.length, hits };
}

function requireArg(value: string | undefined, flag: string): string {
  if (!value || !value.trim()) throw new Error(`'${flag}' is required for this probe op.`);
  return value;
}

/** Dispatch a single bounded probe op against the HTML. Never returns raw HTML. */
export function runProbe(html: string, op: ProbeOp, args: ProbeArgs = {}): Record<string, unknown> {
  switch (op) {
    case "outline":
      return { op, outline: probeOutline(html) };
    case "jsonld":
      return { op, ...probeJsonLd(html, args.preferType) };
    case "microdata":
      return { op, ...probeMicrodata(html) };
    case "query":
      return { op, ...probeQuery(html, requireArg(args.selector, "--selector")) };
    case "list":
      return { op, ...probeList(html, requireArg(args.selector, "--selector")) };
    case "text":
      return { op, ...probeText(html, requireArg(args.selector, "--selector")) };
    case "attr":
      return { op, ...probeAttr(html, requireArg(args.selector, "--selector"), requireArg(args.name, "--name")) };
    case "find":
      return { op, ...probeFind(html, requireArg(args.keyword, "--keyword")) };
    default:
      throw new Error(`Unknown probe op '${op as string}'. Valid ops: ${PROBE_OPS.join(", ")}.`);
  }
}
