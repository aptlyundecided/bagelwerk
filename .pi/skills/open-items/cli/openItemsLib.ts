import path from "node:path";
import { promises as fs } from "node:fs";
import { listTodoJsonStems } from "../../todo-contract/cli/todoContractLib";

export const ALLOWED_STATES = new Set([
  "new",
  "triaged",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "archived",
]);

const CANONICAL_SECTION_ORDER = ["id", "state", "summary", "notes/discoveries"] as const;

const CANONICAL_SECTION_NAMES = new Set<string>(CANONICAL_SECTION_ORDER);

export type ParsedOpenItem = {
  filePath: string;
  /** Repo-relative POSIX path */
  relativePath: string;
  stem: string;
  title: string;
  id: string;
  state: string;
  summary: string;
  isOpen: boolean;
};

export type ParsedOpenItemCore = Omit<ParsedOpenItem, "relativePath">;

export type ParseItemIssue = { filePath: string; message: string };

function normalizeNewlines(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

/** First line `# …` title, or empty if missing. */
export function extractTitleLine(source: string): string {
  const first = normalizeNewlines(source).split("\n")[0]?.trim() ?? "";
  if (!first.startsWith("# ")) {
    return "";
  }
  return first.slice(2).trim();
}

export function extractSectionMap(source: string): Map<string, string> {
  const text = normalizeNewlines(source);
  const lines = text.split("\n");
  const map = new Map<string, string>();
  let current: string | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current !== null) {
      map.set(current, buffer.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""));
    }
    buffer.length = 0;
  };

  for (const line of lines) {
    const heading = /^## (?!#)([^\n]+)$/.exec(line);
    if (heading) {
      const name = heading[1].trim();
      if (CANONICAL_SECTION_NAMES.has(name)) {
        flush();
        current = name;
        continue;
      }
    }
    if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return map;
}

export function parseNumericId(stem: string): number | null {
  const match = /^OI-(\d{4})$/.exec(stem);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

export function validateSectionOrder(source: string): string | null {
  const text = normalizeNewlines(source);
  const headings: string[] = [];
  for (const line of text.split("\n")) {
    const heading = /^## (?!#)([^\n]+)$/.exec(line);
    if (!heading) {
      continue;
    }
    const name = heading[1].trim();
    if (CANONICAL_SECTION_NAMES.has(name)) {
      headings.push(name);
    }
  }
  const expected = [...CANONICAL_SECTION_ORDER];
  for (let index = 0; index < expected.length; index += 1) {
    if (headings[index] !== expected[index]) {
      return `Expected section ## ${expected[index]} at canonical position ${index + 1}, found ## ${headings[index] ?? "(missing)"}`;
    }
  }
  return null;
}

export function parseItemFile(
  filePath: string,
  stem: string,
  source: string,
): ParsedOpenItemCore | ParseItemIssue {
  const orderIssue = validateSectionOrder(source);
  if (orderIssue) {
    return { filePath, message: orderIssue };
  }
  const title = extractTitleLine(source);
  if (!title) {
    return { filePath, message: "Missing top-level # title line" };
  }
  const sections = extractSectionMap(source);
  const id = (sections.get("id") ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const state = (sections.get("state") ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const summary = (sections.get("summary") ?? "").trim();

  if (id !== stem) {
    return { filePath, message: `## id is "${id}" but filename is ${stem}.md` };
  }
  if (!ALLOWED_STATES.has(state)) {
    return { filePath, message: `Invalid ## state "${state}"` };
  }

  return {
    filePath,
    stem,
    title,
    id,
    state,
    summary,
    isOpen: state !== "done" && state !== "archived",
  };
}

export function truncateTitleForIndex(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 5) {
    return title.trim();
  }
  return `${words.slice(0, 5).join(" ")} …`;
}

export function formatIndexContent(items: ParsedOpenItem[], nextId: string): string {
  const open = items.filter((item) => item.isOpen).sort((a, b) => a.id.localeCompare(b.id));
  const lines: string[] = ["# Open Items Index", ""];
  for (const item of open) {
    const shortTitle = truncateTitleForIndex(item.title);
    lines.push(`- ${item.id} — ${shortTitle} — state: ${item.state} — ./items/${item.stem}.md`);
  }
  lines.push("");
  lines.push("## Counter (next OI id)");
  lines.push(nextId);
  lines.push("");
  return lines.join("\n");
}

export function computeNextIdFromStems(stems: string[]): string {
  let max = 0;
  for (const stem of stems) {
    const n = parseNumericId(stem);
    if (n !== null && n > max) {
      max = n;
    }
  }
  const next = max + 1;
  return `OI-${String(next).padStart(4, "0")}`;
}

export async function listItemStems(itemsDir: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(itemsDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^OI-\d{4}\.md$/.test(name) && !name.endsWith(".todo.md"))
    .map((name) => name.replace(/\.md$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

export async function loadAllItems(params: {
  itemsDir: string;
  repoRoot: string;
}): Promise<{
  items: ParsedOpenItem[];
  issues: ParseItemIssue[];
}> {
  const { itemsDir, repoRoot } = params;
  const stems = await listItemStems(itemsDir);
  const items: ParsedOpenItem[] = [];
  const issues: ParseItemIssue[] = [];
  for (const stem of stems) {
    const filePath = path.join(itemsDir, `${stem}.md`);
    const source = await fs.readFile(filePath, "utf8");
    const parsed = parseItemFile(filePath, stem, source);
    if ("message" in parsed) {
      issues.push(parsed);
    } else {
      items.push({
        ...parsed,
        relativePath: path.relative(repoRoot, filePath).split(path.sep).join("/"),
      });
    }
  }
  return { items, issues };
}

export function parseIndexCounter(indexText: string): string | null {
  const text = normalizeNewlines(indexText);
  const counterMatch = /## Counter \(next OI id\)\s*\n(OI-\d{4})\b/.exec(text);
  return counterMatch ? counterMatch[1] : null;
}

export type CapturePending = { title: string; lineNumber: number };

export function listPendingCaptureEntries(captureText: string): CapturePending[] {
  const text = normalizeNewlines(captureText);
  const boundary = "Begin Items Capture\n---";
  const boundaryIndex = text.indexOf(boundary);
  if (boundaryIndex === -1) {
    return [];
  }
  const after = text.slice(boundaryIndex + boundary.length);
  const lines = after.split("\n");
  const results: CapturePending[] = [];
  const lineOffset = text.slice(0, boundaryIndex + boundary.length).split("\n").length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const h1 = /^# (.+)$/.exec(line);
    if (h1) {
      results.push({ title: h1[1].trim(), lineNumber: lineOffset + index + 1 });
    }
  }
  return results;
}

export type ValidateIssue = { level: "error" | "warn"; path: string; message: string };

export async function validateOpenItemsWorkspace(params: {
  repoRoot: string;
}): Promise<ValidateIssue[]> {
  const issues: ValidateIssue[] = [];
  const itemsDir = path.join(params.repoRoot, ".agents", "open-items", "items");
  const indexPath = path.join(params.repoRoot, ".agents", "open-items", "INDEX.md");
  const capturePath = path.join(params.repoRoot, "OPEN_ITEMS_CAPTURE.md");

  const { items, issues: parseIssues } = await loadAllItems({ itemsDir, repoRoot: params.repoRoot });
  for (const issue of parseIssues) {
    issues.push({ level: "error", path: issue.filePath, message: issue.message });
  }

  const stems = await listItemStems(itemsDir);
  const expectedNext = computeNextIdFromStems(stems);

  let indexText = "";
  try {
    indexText = await fs.readFile(indexPath, "utf8");
  } catch {
    issues.push({ level: "error", path: indexPath, message: "INDEX.md missing" });
  }

  const counter = parseIndexCounter(indexText);
  if (counter && counter !== expectedNext) {
    issues.push({
      level: "error",
      path: indexPath,
      message: `Counter is ${counter} but computed next id from item files is ${expectedNext}`,
    });
  }

  const generated = formatIndexContent(items, expectedNext);
  if (normalizeNewlines(indexText) !== normalizeNewlines(generated)) {
    issues.push({
      level: "warn",
      path: indexPath,
      message: "INDEX.md content does not match regenerated output; run `npm run open-items -- index`",
    });
  }

  for (const line of indexText.split("\n")) {
    const bullet = /^- (OI-\d{4}) — .+ — state: (\S+) — \.\/items\/(OI-\d{4})\.md\s*$/.exec(line);
    if (!bullet) {
      continue;
    }
    const id = bullet[1];
    const stateInIndex = bullet[2];
    const stem = bullet[3];
    const item = items.find((entry) => entry.stem === stem);
    if (!item) {
      issues.push({ level: "error", path: indexPath, message: `Index references missing item ${id}` });
      continue;
    }
    if (item.state !== stateInIndex) {
      issues.push({
        level: "error",
        path: indexPath,
        message: `Index state for ${id} (${stateInIndex}) disagrees with item file (${item.state})`,
      });
    }
    if (!item.isOpen) {
      issues.push({ level: "error", path: indexPath, message: `Index lists closed item ${id} (state ${item.state})` });
    }
  }

  let captureText = "";
  try {
    captureText = await fs.readFile(capturePath, "utf8");
  } catch {
    issues.push({ level: "warn", path: capturePath, message: "OPEN_ITEMS_CAPTURE.md missing" });
  }
  const pending = listPendingCaptureEntries(captureText);
  if (pending.length > 0) {
    issues.push({
      level: "warn",
      path: capturePath,
      message: `${pending.length} capture H1 entr${pending.length === 1 ? "y" : "ies"} pending promotion`,
    });
  }

  let todoNames: string[] = [];
  try {
    todoNames = await fs.readdir(itemsDir);
  } catch {
    todoNames = [];
  }

  async function pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  for (const name of todoNames) {
    const match = /^(OI-\d{4})\.todo\.md$/.exec(name);
    if (!match) {
      continue;
    }
    const stem = match[1];
    const item = items.find((entry) => entry.stem === stem);
    const todoPath = path.join(itemsDir, name);
    if (!item) {
      issues.push({ level: "warn", path: todoPath, message: `Todo sidecar without item file ${stem}.md` });
      continue;
    }
    if (item.state === "done" || item.state === "archived") {
      issues.push({
        level: "warn",
        path: todoPath,
        message: `Todo sidecar exists but ${stem} is ${item.state}; consider deleting`,
      });
    }
  }

  const jsonStems = await listTodoJsonStems(itemsDir);
  for (const stem of jsonStems) {
    const item = items.find((entry) => entry.stem === stem);
    const todoPath = path.join(itemsDir, `${stem}.todo.json`);
    if (!item) {
      issues.push({ level: "warn", path: todoPath, message: `Todo JSON sidecar without item file ${stem}.md` });
      continue;
    }
    if (item.state === "done" || item.state === "archived") {
      issues.push({
        level: "warn",
        path: todoPath,
        message: `Todo JSON sidecar exists but ${stem} is ${item.state}; consider deleting`,
      });
    }
  }

  for (const item of items) {
    const mdPath = path.join(itemsDir, `${item.stem}.todo.md`);
    const jsonPath = path.join(itemsDir, `${item.stem}.todo.json`);
    const hasMd = await pathExists(mdPath);
    const hasJson = await pathExists(jsonPath);
    if (hasMd && hasJson) {
      issues.push({
        level: "warn",
        path: mdPath,
        message: `Both ${item.stem}.todo.md and ${item.stem}.todo.json exist; keep only one sidecar format`,
      });
    }
    if (item.state === "in_progress" && !hasMd && !hasJson) {
      issues.push({
        level: "warn",
        path: path.join(itemsDir, `${item.stem}.md`),
        message: `Open item ${item.stem} is in_progress but has no todo sidecar (.todo.md or .todo.json)`,
      });
    }
  }

  return issues;
}
