/**
 * Runs only the living Flow / Node surface tests.
 * - default: all *.test.ts under active roots except *.model.test.ts
 * - models: only *.model.test.ts under active roots
 */
import { readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const activeRoots = [
  join(repoRoot, "src", "core", "nodes"),
  join(repoRoot, "src", "core", "flows"),
  join(repoRoot, "src", "core", "flow-workbench"),
  join(repoRoot, "src", "core", "flow-runner"),
  join(repoRoot, "src", "core", "flow-supervisor"),
  join(repoRoot, "src", "core", "graph-visualization"),
  join(repoRoot, "src", "core", "agent-execution"),
  join(repoRoot, "src", "core", "built-ins"),
  join(repoRoot, "src", "tools"),
  join(repoRoot, "flow-library", "recipe-discovery"),
  join(repoRoot, "flow-library", "meal-plan-grocery"),
  join(repoRoot, "flow-library", "dinner-plan-grocery"),
  join(repoRoot, "flow-library", "lunch-plan-grocery"),
  join(repoRoot, "flow-library", "recipe-finder"),
  join(repoRoot, "flow-library", "recipe-extract"),
  join(repoRoot, "flow-library", "strategy-graph"),
];

const MODEL_SUFFIX = ".model.test.ts";

function collectTestFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) collectTestFiles(p, acc);
    else if (ent.isFile() && ent.name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

function isModelTestFile(absPath) {
  const norm = absPath.split("\\").join("/");
  return norm.endsWith(MODEL_SUFFIX);
}

const mode = (process.argv[2] || "default").trim();
const all = activeRoots.flatMap((root) => collectTestFiles(root)).sort();
const files = mode === "models" ? all.filter(isModelTestFile) : all.filter((p) => !isModelTestFile(p));

if (files.length === 0) {
  const label = mode === "models" ? "model-tier (*.model.test.ts)" : "default-tier (*.test.ts excluding *.model.test.ts)";
  console.log(`active-surface-test-run: no ${label} files — exiting ok`);
  process.exit(0);
}

const relFiles = files.map((abs) => relative(repoRoot, abs).split("\\").join("/"));
const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "--test", ...relFiles], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
