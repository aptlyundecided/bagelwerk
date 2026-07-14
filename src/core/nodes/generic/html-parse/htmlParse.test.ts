import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseHtml, runHtmlParseNode, HtmlParseNodeParamsSchema } from "./index";

test("parseHtml prefers Recipe JSON-LD, extracts meta, and reports the structured tier", () => {
  const html = `<!doctype html><html><head>
    <title>Turkey Hummus Bowl</title>
    <meta name="description" content="A fast high-protein lunch.">
    <script type="application/ld+json">{"@type":"WebSite","name":"Site"}</script>
    <script type="application/ld+json">{"@type":"Recipe","name":"Turkey Hummus Bowl","recipeIngredient":["turkey","hummus"]}</script>
  </head><body><article><h1>Turkey Hummus Bowl</h1><p>Assemble.</p></article></body></html>`;

  const r = parseHtml(html, { preferJsonLdType: "recipe" });
  assert.equal(r.extraction, "structured");
  assert.equal(r.title, "Turkey Hummus Bowl");
  assert.equal(r.description, "A fast high-protein lunch.");
  assert.equal(r.jsonLd.length, 2);
  assert.equal(r.jsonLd[0]?.["@type"], "Recipe", "Recipe block bubbles to the front");
});

test("parseHtml falls back to microdata when there is no JSON-LD", () => {
  const html = `<html><body><div itemscope itemtype="https://schema.org/Recipe">
    <span itemprop="name">Microdata Bowl</span>
    <li itemprop="recipeIngredient">beans</li>
    <li itemprop="recipeIngredient">rice</li>
  </div></body></html>`;

  const r = parseHtml(html);
  assert.equal(r.jsonLd.length, 0);
  assert.equal(r.extraction, "structured");
  assert.equal(r.microdata[0]?.type, "https://schema.org/Recipe");
  assert.deepEqual(r.microdata[0]?.props.recipeIngredient, ["beans", "rice"]);
});

test("parseHtml extracts caller-named fields and reports per-probe failure reasons", () => {
  const html = `<html><body><div class="recipe">
    <ul class="ing"><li>1 cup beans</li><li>2 tbsp oil</li></ul>
    <ol class="steps"><li>Mix.</li><li>Serve.</li></ol>
  </div></body></html>`;

  const r = parseHtml(html, {
    fields: { ingredients: [".ing li"], steps: [".steps li"], nutrition: [".nutrition-table"] },
  });
  assert.deepEqual(r.fields.ingredients, ["1 cup beans", "2 tbsp oil"]);
  assert.deepEqual(r.fields.steps, ["Mix.", "Serve."]);
  assert.deepEqual(r.fields.nutrition, []);

  const missed = r.probes.find((p) => p.selector === ".nutrition-table");
  assert.equal(missed?.matchCount, 0);
  assert.equal(missed?.reason, "no_match");
  const hit = r.probes.find((p) => p.selector === ".ing li");
  assert.equal(hit?.matchCount, 2);
  assert.equal(hit?.emitted, 2);
});

test("parseHtml chops boilerplate, keeps article content, and hard-caps the condensed payload", () => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `<p>Step ${i}: cook the beans thoroughly until they are tender and well seasoned.</p>`).join("");
  const body = `<nav>HOME RECIPES SUBSCRIBE NOW</nav>
    <article><h2>Method</h2>${paragraphs}</article>
    <footer>Copyright 2026 — Privacy Policy</footer>
    <ins class="adsbygoogle">SPONSORED AD UNIT</ins>`;
  const html = `<html><body>${body}</body></html>`;

  const r = parseHtml(html, { maxChars: 300 });
  assert.equal(r.extraction, "readable");
  assert.ok(r.condensed.length <= 300, `condensed ${r.condensed.length} <= 300`);
  assert.equal(r.stats.truncated, true);
  assert.ok(r.stats.reductionPct > 50, `reductionPct ${r.stats.reductionPct} > 50`);
  // Boilerplate is gone; article content survives.
  assert.doesNotMatch(r.condensed, /SUBSCRIBE|Copyright|SPONSORED/);
  assert.match(r.condensed, /cook the beans/i);
});

test("parseHtml reports extraction:none for content-free HTML", () => {
  const r = parseHtml("<html><body></body></html>");
  assert.equal(r.extraction, "none");
  assert.equal(r.condensed, "");
});

test("runHtmlParseNode writes a bounded artifact from injected HTML", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bagelwerk-html-parse-"));
  try {
    const runDir = path.join(tempRoot, "run");
    const result = await runHtmlParseNode({
      nodeId: "node.html-parse",
      params: HtmlParseNodeParamsSchema.parse({ preferJsonLdType: "recipe", artifactBaseName: "parsed" }),
      input: { runtime: { record: { runDir } } },
      html: `<html><head><title>T</title><script type="application/ld+json">{"@type":"Recipe","name":"T"}</script></head><body><article><p>hi there friends</p></article></body></html>`,
      now: () => new Date("2026-06-16T00:00:00.000Z"),
    });

    assert.equal(result.status, "completed");
    assert.equal(result.payload.finalVerdict, "html_parse_completed");
    const artifact = JSON.parse(await readFile(path.join(runDir, "parsed.json"), "utf8"));
    assert.equal(artifact.nodeType, "core.html-parse");
    assert.equal(artifact.parsedAt, "2026-06-16T00:00:00.000Z");
    assert.equal(artifact.extraction, "structured");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
