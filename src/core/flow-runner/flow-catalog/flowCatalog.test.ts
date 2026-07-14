import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverExternalFlowCatalog, resolveExternalFlowCatalogEntry } from "./flowCatalog";

async function writeFlowWorkspace(root: string, args: {
  id: string;
  label?: string;
  aliases?: string[];
  prompts?: unknown[];
  requirements?: Record<string, unknown>;
}): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "flowModule.mjs"), "export default { flow: {}, configuredNodes: [], nodeRegistry: { get() {}, list() { return []; } } };\n", "utf8");
  await writeFile(path.join(root, "flow.config.json"), `${JSON.stringify({
    schemaVersion: 1,
    flows: [{ module: "./flowModule.mjs", ...args }],
  }, null, 2)}\n`, "utf8");
}

test("discoverExternalFlowCatalog discovers flow-library workspaces and metadata", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-catalog-"));
  await writeFlowWorkspace(path.join(repoRoot, "flow-library", "recipe-discovery"), {
    id: "recipe-discovery",
    label: "Recipe Discovery",
    aliases: ["recipes", "recipe"],
    requirements: { network: true, agentRuntime: "cursor", writesDurableState: true },
    prompts: [{ key: "recipesPerRun", kind: "number", label: "How many recipes?", default: 5 }],
  });

  const catalog = await discoverExternalFlowCatalog({ repoRoot });

  assert.equal(catalog.diagnostics.length, 0);
  assert.equal(catalog.flows.length, 1);
  const [entry] = catalog.flows;
  assert.ok(entry);
  assert.equal(entry.id, "recipe-discovery:recipe-discovery");
  assert.deepEqual(entry.aliases, ["recipes", "recipe"]);
  assert.equal(entry.source.kind, "flow-library");
  assert.equal(entry.requirements?.agentRuntime, "cursor");
  assert.equal(entry.prompts?.[0]?.key, "recipesPerRun");
});

test("resolveExternalFlowCatalogEntry resolves id, local id, and alias", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-catalog-"));
  await writeFlowWorkspace(path.join(repoRoot, "flow-library", "recipe-discovery"), { id: "recipe-discovery", aliases: ["recipes"] });
  const catalog = await discoverExternalFlowCatalog({ repoRoot });

  assert.equal(resolveExternalFlowCatalogEntry(catalog, "recipe-discovery:recipe-discovery").ok, true);
  assert.equal(resolveExternalFlowCatalogEntry(catalog, "recipe-discovery").ok, true);
  const aliasResult = resolveExternalFlowCatalogEntry(catalog, "recipes");
  assert.equal(aliasResult.ok, true);
  if (aliasResult.ok) assert.equal(aliasResult.matchedBy, "alias");
});

test("resolveExternalFlowCatalogEntry reports ambiguous aliases", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-catalog-"));
  await writeFlowWorkspace(path.join(repoRoot, "flow-library", "one"), { id: "one", aliases: ["same"] });
  await writeFlowWorkspace(path.join(repoRoot, "flow-library", "two"), { id: "two", aliases: ["same"] });
  const catalog = await discoverExternalFlowCatalog({ repoRoot });

  const result = resolveExternalFlowCatalogEntry(catalog, "same");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "ambiguous");
    assert.equal(result.matches?.length, 2);
  }
});

test("discoverExternalFlowCatalog returns empty catalog when no sources exist", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-catalog-empty-"));
  const catalog = await discoverExternalFlowCatalog({ repoRoot });
  assert.deepEqual(catalog, { flows: [], diagnostics: [] });
  const result = resolveExternalFlowCatalogEntry(catalog, "missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "empty-catalog");
});
