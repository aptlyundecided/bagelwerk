import assert from "node:assert/strict";
import test from "node:test";

import {
  PROBE_LIMITS,
  probeAttr,
  probeFind,
  probeJsonLd,
  probeList,
  probeMicrodata,
  probeOutline,
  probeQuery,
  probeText,
  runProbe,
} from "./cheerioProbe";

const RECIPE_HTML = `<!doctype html><html><head>
  <script type="application/ld+json">{"@type":"WebSite","name":"Site"}</script>
  <script type="application/ld+json">{"@type":"Recipe","name":"Beans Bowl","recipeIngredient":["1 cup beans","2 tbsp oil"]}</script>
</head><body>
  <article>
    <h1>Beans Bowl</h1>
    <h2>Ingredients</h2>
    <ul class="ing"><li>1 cup beans</li><li>2 tbsp oil</li><li>salt</li></ul>
    <h2>Instructions</h2>
    <ol class="steps"><li>Mix.</li><li>Serve.</li></ol>
    <img class="hero" src="https://x.test/bowl.jpg">
  </article>
</body></html>`;

test("probeOutline returns the heading skeleton", () => {
  const outline = probeOutline(RECIPE_HTML);
  assert.deepEqual(outline, [
    { level: 1, text: "Beans Bowl" },
    { level: 2, text: "Ingredients" },
    { level: 2, text: "Instructions" },
  ]);
});

test("probeJsonLd flattens blocks and honours preferType", () => {
  const r = probeJsonLd(RECIPE_HTML, "recipe");
  assert.equal(r.count, 2);
  assert.equal(r.blocks[0]?.["@type"], "Recipe");
  assert.deepEqual(r.blocks[0]?.recipeIngredient, ["1 cup beans", "2 tbsp oil"]);
});

test("probeList / probeQuery / probeText / probeAttr pull bounded pieces", () => {
  assert.deepEqual(probeList(RECIPE_HTML, ".ing li").items, ["1 cup beans", "2 tbsp oil", "salt"]);
  assert.equal(probeList(RECIPE_HTML, ".ing li").matchCount, 3);

  const q = probeQuery(RECIPE_HTML, ".steps li");
  assert.equal(q.matchCount, 2);
  assert.ok(q.samples.length <= PROBE_LIMITS.maxSamples);

  // .text() on a container concatenates descendant text directly (use `list` for per-item separation).
  assert.equal(probeText(RECIPE_HTML, ".steps").text, "Mix.Serve.");
  assert.deepEqual(probeAttr(RECIPE_HTML, "img.hero", "src").values, ["https://x.test/bowl.jpg"]);
});

test("probeMicrodata returns itemscope props", () => {
  const html = `<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="name">M</span><li itemprop="recipeIngredient">beans</li></div>`;
  const r = probeMicrodata(html);
  assert.equal(r.items[0]?.type, "https://schema.org/Recipe");
  assert.deepEqual(r.items[0]?.props.recipeIngredient, ["beans"]);
});

test("probeFind locates section landmarks mentioning a keyword", () => {
  const r = probeFind(RECIPE_HTML, "ingredients");
  assert.equal(r.matchCount, 1);
  assert.equal(r.hits[0]?.tag, "h2");
  assert.match(r.hits[0]?.snippet ?? "", /Ingredients/);
});

test("probe ops are bounded — a huge list is capped at maxItems", () => {
  const lis = Array.from({ length: 500 }, (_, i) => `<li>item ${i}</li>`).join("");
  const html = `<ul class="big">${lis}</ul>`;
  const r = probeList(html, ".big li");
  assert.equal(r.matchCount, 500);
  assert.ok(r.items.length <= PROBE_LIMITS.maxItems, `items ${r.items.length} <= ${PROBE_LIMITS.maxItems}`);
  assert.equal(r.truncated, true);
});

test("runProbe dispatches ops and surfaces missing-arg errors", () => {
  assert.equal((runProbe(RECIPE_HTML, "outline").outline as unknown[]).length, 3);
  assert.deepEqual((runProbe(RECIPE_HTML, "list", { selector: ".ing li" }).items as string[]), ["1 cup beans", "2 tbsp oil", "salt"]);
  assert.throws(() => runProbe(RECIPE_HTML, "list"), /--selector' is required/);
  assert.throws(() => runProbe(RECIPE_HTML, "attr", { selector: "img" }), /--name' is required/);
  assert.throws(() => runProbe(RECIPE_HTML, "find"), /--keyword' is required/);
});
