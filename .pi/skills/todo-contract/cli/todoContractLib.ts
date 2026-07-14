import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";

export const TODO_FILE_STATUSES = ["active", "paused", "completed"] as const;
export type TodoFileStatus = (typeof TODO_FILE_STATUSES)[number];

export const TASK_STATUSES = ["pending", "in_progress", "blocked", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const openItemIdRegex = /^OI-\d{4}$/;
const taskIdRegex = /^T-\d{3}$/;

const taskRowSchema = z.object({
  id: z.string().regex(taskIdRegex, "task id must match T-###"),
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD"),
  order: z.number().int().positive("order must be a positive integer").optional(),
  status: z.enum(TASK_STATUSES),
  task: z.string().min(1, "task text must be non-empty"),
  notes: z.string(),
});

export type TodoTaskRow = z.infer<typeof taskRowSchema>;

export const todoSidecarSchema = z.object({
  openItem: z.string().regex(openItemIdRegex, "openItem must match OI-####"),
  status: z.enum(TODO_FILE_STATUSES),
  generated: z.string().regex(dateRegex, "generated must be YYYY-MM-DD"),
  tasks: z.array(taskRowSchema),
  notes: z.array(z.string()),
  meta: z.record(z.unknown()),
});

export type TodoSidecar = z.infer<typeof todoSidecarSchema>;

export type ValidateTodoIssue = { level: "error" | "warn"; path: string; message: string };

function normalizeNewlines(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

/** Minimal parse of `## id` and `## state` from an open-item markdown file (avoids importing open-items from here). */
export function parseOpenItemIdState(source: string): { id: string; state: string } | null {
  const text = normalizeNewlines(source);
  const sections = new Map<string, string>();
  let current: string | null = null;
  const buffer: string[] = [];

  const flush = () => {
    if (current !== null) {
      sections.set(current, buffer.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""));
    }
    buffer.length = 0;
  };

  for (const line of text.split("\n")) {
    const heading = /^## (?!#)([^\n]+)$/.exec(line);
    if (heading) {
      const name = heading[1].trim();
      if (name === "id" || name === "state") {
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

  const id = (sections.get("id") ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const state = (sections.get("state") ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!id || !state) {
    return null;
  }
  return { id, state };
}

const OPEN_ITEM_CLOSED = new Set(["done", "archived"]);

export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function canonicalTodoSidecar(doc: TodoSidecar): TodoSidecar {
  const sortedTasks = [...doc.tasks].sort((a, b) => a.id.localeCompare(b.id));
  return {
    openItem: doc.openItem,
    status: doc.status,
    generated: doc.generated,
    tasks: sortedTasks.map((row) => ({
      id: row.id,
      date: row.date,
      ...(row.order !== undefined ? { order: row.order } : {}),
      status: row.status,
      task: row.task,
      notes: row.notes,
    })),
    notes: [...doc.notes],
    meta: { ...doc.meta },
  };
}

export function serializeTodoSidecarCanonical(doc: TodoSidecar): string {
  const ordered = {
    openItem: doc.openItem,
    status: doc.status,
    generated: doc.generated,
    tasks: doc.tasks.map((row) => ({
      id: row.id,
      date: row.date,
      ...(row.order !== undefined ? { order: row.order } : {}),
      status: row.status,
      task: row.task,
      notes: row.notes,
    })),
    notes: doc.notes,
    meta: doc.meta,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseTodoSidecarJson(text: string): { ok: true; doc: TodoSidecar } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "Invalid JSON" };
  }
  const parsed = todoSidecarSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg = JSON.stringify(first);
    return { ok: false, message: `Schema: ${msg}` };
  }
  return { ok: true, doc: canonicalTodoSidecar(parsed.data) };
}

export async function atomicWriteUtf8(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

export function stemFromTodoJsonFilename(name: string): string | null {
  const match = /^(OI-\d{4})\.todo\.json$/.exec(name);
  return match ? match[1] : null;
}

export async function listTodoJsonStems(itemsDir: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(itemsDir);
  } catch {
    return [];
  }
  return names
    .map((name) => stemFromTodoJsonFilename(name))
    .filter((stem): stem is string => stem !== null)
    .sort((a, b) => a.localeCompare(b));
}

export function parseTaskNumericId(taskId: string): number | null {
  const match = /^T-(\d{3})$/.exec(taskId);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

export function nextTaskId(existing: TodoTaskRow[]): string {
  let max = 0;
  for (const row of existing) {
    const n = parseTaskNumericId(row.id);
    if (n !== null && n > max) {
      max = n;
    }
  }
  return `T-${String(max + 1).padStart(3, "0")}`;
}

export function validateTodoStemMatchesOpenItem(doc: TodoSidecar, stem: string): string | null {
  if (doc.openItem !== stem) {
    return `openItem "${doc.openItem}" does not match filename stem ${stem}`;
  }
  return null;
}

/** In-file consistency: duplicate ids, ordering, all tasks completed vs file status, in_progress task count. */
export function validateTodoInternalConsistency(doc: TodoSidecar): ValidateTodoIssue[] {
  const issues: ValidateTodoIssue[] = [];
  const pathLabel = doc.openItem;
  const ids = doc.tasks.map((t) => t.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    issues.push({ level: "error", path: pathLabel, message: "Duplicate task ids" });
  }
  const sorted = [...doc.tasks].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < doc.tasks.length; i += 1) {
    if (doc.tasks[i].id !== sorted[i]?.id) {
      issues.push({
        level: "error",
        path: pathLabel,
        message: "tasks[] must be sorted ascending by id (canonical form)",
      });
      break;
    }
  }
  const orderedTasks = doc.tasks.filter((t) => t.order !== undefined);
  const uniqueOrders = new Set(orderedTasks.map((t) => t.order));
  if (uniqueOrders.size !== orderedTasks.length) {
    issues.push({ level: "error", path: pathLabel, message: "Duplicate task order values" });
  }
  const inProgress = doc.tasks.filter((t) => t.status === "in_progress");
  if (inProgress.length > 1) {
    issues.push({ level: "error", path: pathLabel, message: "More than one task in_progress" });
  }
  const allCompleted = doc.tasks.length > 0 && doc.tasks.every((t) => t.status === "completed");
  if (allCompleted && doc.status !== "completed") {
    issues.push({
      level: "warn",
      path: pathLabel,
      message: "All tasks completed but todo-file status is not completed",
    });
  }
  if (doc.tasks.length === 0 && doc.status === "completed") {
    issues.push({
      level: "warn",
      path: pathLabel,
      message: "Todo-file status completed but tasks[] is empty",
    });
  }
  return issues;
}

export type ParentOpenItemInfo = { exists: boolean; id: string; state: string | null };

export function validateTodoAgainstParent(
  filePath: string,
  doc: TodoSidecar,
  parent: ParentOpenItemInfo,
): ValidateTodoIssue[] {
  const issues: ValidateTodoIssue[] = [];
  if (!parent.exists) {
    issues.push({ level: "error", path: filePath, message: `Parent open item ${doc.openItem}.md missing` });
    return issues;
  }
  if (parent.id !== doc.openItem) {
    issues.push({
      level: "error",
      path: filePath,
      message: `Parent ## id "${parent.id}" does not match openItem ${doc.openItem}`,
    });
  }
  if (parent.state && OPEN_ITEM_CLOSED.has(parent.state)) {
    issues.push({
      level: "error",
      path: filePath,
      message: `Parent open item is ${parent.state}; todo sidecar should be deleted`,
    });
  }
  if (parent.state === "in_progress" && doc.status === "completed") {
    issues.push({
      level: "warn",
      path: filePath,
      message: "Parent open item is in_progress but todo-file status is completed",
    });
  }
  return issues;
}

export async function readParentOpenItemInfo(
  itemsDir: string,
  stem: string,
): Promise<ParentOpenItemInfo> {
  const mdPath = path.join(itemsDir, `${stem}.md`);
  try {
    const text = await fs.readFile(mdPath, "utf8");
    const parsed = parseOpenItemIdState(text);
    if (!parsed) {
      return { exists: true, id: stem, state: null };
    }
    return { exists: true, id: parsed.id, state: parsed.state };
  } catch {
    return { exists: false, id: stem, state: null };
  }
}

export async function loadTodoSidecar(filePath: string): Promise<
  | { ok: true; doc: TodoSidecar; raw: string }
  | { ok: false; message: string }
> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return { ok: false, message: "File not found" };
  }
  const parsed = parseTodoSidecarJson(raw);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const canonical = serializeTodoSidecarCanonical(parsed.doc);
  if (normalizeNewlines(raw) !== normalizeNewlines(canonical)) {
    return { ok: false, message: "File is not in canonical form (strict CLI-only mutation)" };
  }
  return { ok: true, doc: parsed.doc, raw };
}

export async function validateAllTodoJsonSidecars(params: {
  repoRoot: string;
}): Promise<ValidateTodoIssue[]> {
  const itemsDir = path.join(params.repoRoot, ".agents", "open-items", "items");
  const issues: ValidateTodoIssue[] = [];
  const stems = await listTodoJsonStems(itemsDir);
  for (const stem of stems) {
    const filePath = path.join(itemsDir, `${stem}.todo.json`);
    const loaded = await loadTodoSidecar(filePath);
    if (!loaded.ok) {
      issues.push({ level: "error", path: filePath, message: loaded.message });
      continue;
    }
    const { doc } = loaded;
    const stemMismatch = validateTodoStemMatchesOpenItem(doc, stem);
    if (stemMismatch) {
      issues.push({ level: "error", path: filePath, message: stemMismatch });
    }
    issues.push(...validateTodoInternalConsistency(doc).map((i) => ({ ...i, path: filePath })));
    const parent = await readParentOpenItemInfo(itemsDir, stem);
    issues.push(...validateTodoAgainstParent(filePath, doc, parent));
  }
  return issues;
}

export function emptyTodoSidecar(stem: string, generated: string): TodoSidecar {
  return canonicalTodoSidecar({
    openItem: stem,
    status: "active",
    generated,
    tasks: [],
    notes: [],
    meta: {},
  });
}
