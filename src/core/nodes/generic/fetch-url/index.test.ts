import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractJsonLd, extractLinks, fetchUrlContent, FetchUrlNodeParamsSchema, htmlToText, runFetchUrlNode, type FetchLike } from "./index";

const RECIPE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Sheet-Pan Tofu Bowls",
  recipeIngredient: ["1 block tofu", "2 cups broccoli"],
  recipeYield: "4 servings",
};

function htmlWithJsonLd(extra = ""): string {
  return `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({ "@type": "WebSite", name: "Site" })}</script>
    <script type="application/ld+json">${JSON.stringify(RECIPE_JSONLD)}</script>
    <style>.x{color:red}</style></head>
    <body><script>var a=1;</script><h1>Tofu Bowls</h1><p>Delicious &nbsp; bowls.</p>${extra}</body></html>`;
}

function fakeFetch(body: string, opts: { ok?: boolean; status?: number; url?: string } = {}): FetchLike {
  return async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.status === 404 ? "Not Found" : "OK",
    url: opts.url ?? "https://example.com/final",
    async text() {
      return body;
    },
  });
}

test("extractJsonLd pulls all blocks and sorts Recipe types first; handles @graph + arrays", () => {
  const blocks = extractJsonLd(htmlWithJsonLd());
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!["@type"], "Recipe"); // Recipe sorted ahead of WebSite

  const graph = `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Person" }, RECIPE_JSONLD] })}</script>`;
  const fromGraph = extractJsonLd(graph);
  assert.equal(fromGraph.length, 2);
  assert.equal(fromGraph[0]!["@type"], "Recipe");

  // Malformed blocks are skipped, not fatal.
  assert.deepEqual(extractJsonLd(`<script type="application/ld+json">{not json}</script>`), []);
});

test("htmlToText strips scripts/styles/tags and collapses whitespace", () => {
  const text = htmlToText(htmlWithJsonLd());
  assert.match(text, /Tofu Bowls/);
  assert.match(text, /Delicious bowls\./);
  assert.doesNotMatch(text, /var a=1/);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /</);
});

test("extractLinks absolutizes against the base URL, strips anchor-text tags, dedups, and skips non-http(s)", () => {
  const html = `
    <a href="/turkey-bowl/">Turkey <b>Bowl</b></a>
    <a href="https://other.example/tofu-salad/">Tofu Salad</a>
    <a href="https://other.example/tofu-salad/#comments">Tofu Salad (frag dup)</a>
    <a href="/turkey-bowl/">dup</a>
    <a href="mailto:hi@example.com">mail</a>
    <a href="javascript:void(0)">js</a>
    <a href="#top">frag only</a>`;
  const links = extractLinks(html, "https://example.com/roundup/");
  assert.deepEqual(links.map((l) => l.url), ["https://example.com/turkey-bowl/", "https://other.example/tofu-salad/"]);
  assert.equal(links[0]!.text, "Turkey Bowl"); // inner tags stripped
});

test("fetchUrlContent extracts JSON-LD + text and reports the final (redirected) URL", async () => {
  const result = await fetchUrlContent({
    url: "https://example.com/tofu",
    timeoutMs: 5000,
    maxBytes: 1_000_000,
    fetchImpl: fakeFetch(htmlWithJsonLd(), { url: "https://example.com/tofu-bowls" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, "https://example.com/tofu-bowls");
  assert.equal(result.jsonLd[0]!["@type"], "Recipe");
  assert.match(result.contentText, /Tofu Bowls/);
});

test("fetchUrlContent never throws on network error — returns ok:false with error", async () => {
  const result = await fetchUrlContent({
    url: "https://example.com/down",
    timeoutMs: 5000,
    maxBytes: 1_000_000,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /ECONNREFUSED/);
});

test("fetchUrlContent caps body to maxBytes", async () => {
  const big = "<p>" + "a".repeat(5000) + "</p>";
  const result = await fetchUrlContent({ url: "https://example.com/big", timeoutMs: 5000, maxBytes: 100, fetchImpl: fakeFetch(big) });
  assert.ok(result.contentText.length <= 100);
});

test("runFetchUrlNode writes an artifact and completes on success, fails on non-2xx", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bagelwerk-fetch-url-"));
  try {
    const runDir = path.join(tempRoot, "run");
    const ok = await runFetchUrlNode({
      nodeId: "node.fetch",
      params: FetchUrlNodeParamsSchema.parse({ url: "https://example.com/tofu", artifactBaseName: "page" }),
      input: { runtime: { record: { runDir } } },
      now: () => new Date("2026-06-09T00:00:00.000Z"),
      fetchImpl: fakeFetch(htmlWithJsonLd()),
    });
    assert.equal(ok.status, "completed");
    assert.equal(ok.payload.artifactFiles.length, 1);
    const artifact = JSON.parse(await readFile(path.join(runDir, "page.json"), "utf8"));
    assert.equal(artifact.nodeType, "core.fetch-url");
    assert.equal(artifact.jsonLd[0]["@type"], "Recipe");

    const notFound = await runFetchUrlNode({
      nodeId: "node.fetch",
      params: FetchUrlNodeParamsSchema.parse({ url: "https://example.com/missing" }),
      input: { runtime: { record: { runDir } } },
      fetchImpl: fakeFetch("nope", { ok: false, status: 404 }),
    });
    assert.equal(notFound.status, "failed");
    assert.equal(notFound.payload.finalVerdict, "fetch_url_failed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
