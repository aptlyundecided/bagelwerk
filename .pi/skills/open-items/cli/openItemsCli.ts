#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  computeNextIdFromStems,
  formatIndexContent,
  listItemStems,
  listPendingCaptureEntries,
  loadAllItems,
  validateOpenItemsWorkspace,
} from "./openItemsLib";

function usage(): string {
  return [
    "open-items CLI — lives beside this skill under cli/ (see SKILL.md § CLI tooling).",
    "",
    "Usage: npm run open-items -- <command> [options]",
    "   or: npx tsx .pi/skills/open-items/cli/openItemsCli.ts <command> [options]",
    "",
    "Commands:",
    "  list [--json] [--all]     Print items to stdout (markdown table or JSON).",
    "  validate                  Structural checks; stderr only; exit 1 on errors.",
    "  index                     Regenerate .agents/open-items/INDEX.md from item files.",
    "  init                      Create missing INDEX.md and OPEN_ITEMS_CAPTURE.md in the selected scope.",
    "  capture                   Print pending # H1 capture titles (below capture boundary).",
    "  where                     Print resolved open-items workspace paths.",
    "",
    "Options:",
    "  --root <path>             Repo root (default: cwd).",
    "  --project <name-or-path>  Target a project-local queue without changing repo root.",
    "                           Bare names resolve under flow-library/<name>; paths resolve relative to --root.",
    "  -h, --help                Show help.",
  ].join("\n");
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

type OpenItemsWorkspace = {
  repoRoot: string;
  scopeRoot: string;
  scopeLabel: string;
  itemsDir: string;
  indexPath: string;
  capturePath: string;
};

function isPathLike(value: string): boolean {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\") || value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\");
}

function assertInsideRepo(repoRoot: string, target: string): void {
  const relative = path.relative(repoRoot, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`Refusing to target open-items workspace outside --root. repoRoot=${repoRoot}; target=${target}`);
}

function resolveWorkspace(repoRoot: string, project: string | null): OpenItemsWorkspace {
  const normalizedRoot = path.resolve(repoRoot);
  const scopeRoot = project
    ? path.resolve(normalizedRoot, isPathLike(project) ? project : path.join("flow-library", project))
    : normalizedRoot;
  assertInsideRepo(normalizedRoot, scopeRoot);
  const scopeLabel = path.relative(normalizedRoot, scopeRoot) || ".";
  return {
    repoRoot: normalizedRoot,
    scopeRoot,
    scopeLabel,
    itemsDir: path.join(scopeRoot, ".agents", "open-items", "items"),
    indexPath: path.join(scopeRoot, ".agents", "open-items", "INDEX.md"),
    capturePath: path.join(scopeRoot, "OPEN_ITEMS_CAPTURE.md"),
  };
}

function printScope(workspace: OpenItemsWorkspace): void {
  if (workspace.scopeRoot !== workspace.repoRoot) {
    console.error(`Open-items scope: ${workspace.scopeLabel}`);
  }
}

async function cmdList(workspace: OpenItemsWorkspace, json: boolean, all: boolean): Promise<number> {
  const { items, issues } = await loadAllItems({ itemsDir: workspace.itemsDir, repoRoot: workspace.repoRoot });
  for (const issue of issues) {
    console.error(`${issue.filePath}: ${issue.message}`);
  }
  const filtered = all
    ? [...items].sort((left, right) => left.id.localeCompare(right.id))
    : items.filter((item) => item.isOpen).sort((left, right) => left.id.localeCompare(right.id));
  if (json) {
    console.log(
      JSON.stringify(
        filtered.map((item) => ({
          id: item.id,
          title: item.title,
          state: item.state,
          summary: item.summary,
          path: item.relativePath,
          open: item.isOpen,
        })),
        null,
        2,
      ),
    );
  } else {
    console.log("| ID | State | Title | Summary | Path |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const item of filtered) {
      const clipped = item.summary.length > 200 ? `${item.summary.slice(0, 200)}…` : item.summary;
      console.log(
        `| ${item.id} | ${item.state} | ${escapeMarkdownCell(item.title)} | ${escapeMarkdownCell(clipped)} | ${item.relativePath} |`,
      );
    }
  }
  return issues.length > 0 ? 1 : 0;
}

async function cmdIndex(workspace: OpenItemsWorkspace): Promise<number> {
  const { items, issues } = await loadAllItems({ itemsDir: workspace.itemsDir, repoRoot: workspace.repoRoot });
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`error: ${issue.filePath}: ${issue.message}`);
    }
    return 1;
  }
  const stems = await listItemStems(workspace.itemsDir);
  const nextId = computeNextIdFromStems(stems);
  const content = formatIndexContent(items, nextId);
  await fs.mkdir(path.dirname(workspace.indexPath), { recursive: true });
  await fs.writeFile(workspace.indexPath, content, "utf8");
  const openCount = items.filter((item) => item.isOpen).length;
  console.error(`Wrote ${path.relative(workspace.repoRoot, workspace.indexPath)} (${openCount} open).`);
  return 0;
}

async function cmdInit(workspace: OpenItemsWorkspace): Promise<number> {
  await fs.mkdir(workspace.itemsDir, { recursive: true });
  try {
    await fs.access(workspace.capturePath);
  } catch {
    const content = ["# Open Items Capture", "", "Begin Items Capture", "---", ""].join("\n");
    await fs.writeFile(workspace.capturePath, content, "utf8");
    console.error(`Created ${path.relative(workspace.repoRoot, workspace.capturePath)}`);
  }
  return cmdIndex(workspace);
}

async function cmdValidate(workspace: OpenItemsWorkspace): Promise<number> {
  const issues = await validateOpenItemsWorkspace({ repoRoot: workspace.scopeRoot });
  let exit = 0;
  for (const issue of issues) {
    const line = `${issue.level.toUpperCase()} ${issue.path}: ${issue.message}`;
    console.error(line);
    if (issue.level === "error") {
      exit = 1;
    }
  }
  if (issues.length === 0) {
    console.error("OK");
  }
  return exit;
}

async function cmdCapture(workspace: OpenItemsWorkspace): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(workspace.capturePath, "utf8");
  } catch {
    console.error(`Missing ${path.relative(workspace.repoRoot, workspace.capturePath)}`);
    return 1;
  }
  const pending = listPendingCaptureEntries(text);
  if (pending.length === 0) {
    console.log("(no pending capture H1 sections below boundary)");
    return 0;
  }
  for (const entry of pending) {
    console.log(`${entry.lineNumber}: ${entry.title}`);
  }
  return 0;
}

function cmdWhere(workspace: OpenItemsWorkspace): number {
  console.log(`repoRoot: ${workspace.repoRoot}`);
  console.log(`scope: ${workspace.scopeLabel}`);
  console.log(`scopeRoot: ${workspace.scopeRoot}`);
  console.log(`itemsDir: ${workspace.itemsDir}`);
  console.log(`indexPath: ${workspace.indexPath}`);
  console.log(`capturePath: ${workspace.capturePath}`);
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(usage());
    return 0;
  }

  let repoRoot = process.cwd();
  let project: string | null = null;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const next = args[index + 1];
      if (!next) {
        console.error("Missing value for --root");
        return 1;
      }
      repoRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--project") {
      const next = args[index + 1];
      if (!next) {
        console.error("Missing value for --project");
        return 1;
      }
      project = next;
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  let workspace: OpenItemsWorkspace;
  try {
    workspace = resolveWorkspace(repoRoot, project);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const cmd = rest[0];
  const cmdArgs = rest.slice(1);
  if (!cmd) {
    console.log(usage());
    return 0;
  }

  if (cmd === "list") {
    printScope(workspace);
    const json = cmdArgs.includes("--json");
    const all = cmdArgs.includes("--all");
    return cmdList(workspace, json, all);
  }
  if (cmd === "index") {
    printScope(workspace);
    return cmdIndex(workspace);
  }
  if (cmd === "init") {
    printScope(workspace);
    return cmdInit(workspace);
  }
  if (cmd === "validate") {
    printScope(workspace);
    return cmdValidate(workspace);
  }
  if (cmd === "capture") {
    printScope(workspace);
    return cmdCapture(workspace);
  }
  if (cmd === "where") {
    return cmdWhere(workspace);
  }

  console.error(`Unknown command: ${cmd}`);
  console.error(usage());
  return 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
