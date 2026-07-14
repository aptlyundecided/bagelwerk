#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  atomicWriteUtf8,
  canonicalTodoSidecar,
  emptyTodoSidecar,
  listTodoJsonStems,
  loadTodoSidecar,
  nextTaskId,
  readParentOpenItemInfo,
  serializeTodoSidecarCanonical,
  TASK_STATUSES,
  TODO_FILE_STATUSES,
  todayStamp,
  validateAllTodoJsonSidecars,
  validateTodoAgainstParent,
  validateTodoInternalConsistency,
  validateTodoStemMatchesOpenItem,
  type TodoSidecar,
  type TodoTaskRow,
} from "./todoContractLib";

function usage(): string {
  return [
    "todo-contract CLI — JSON sidecar at .agents/open-items/items/OI-####.todo.json",
    "",
    "Usage: npm run todos -- <command> [options]",
    "   or: npx tsx .pi/skills/todo-contract/cli/todoContractCli.ts <command> [options]",
    "",
    "Commands:",
    "  create <OI-####>              Create sidecar (parent OI must exist and not be done/archived).",
    "  show <OI-####> [--json|--ordered] Print one sidecar, or ordered task rows.",
    "  plan <OI-####>                Print ordered task rows only.",
    "  list [--json] [--all]         List sidecars (default: active|paused only).",
    "  validate                      Structural + cross-surface checks.",
    "  delete <OI-####>              Remove sidecar file.",
    "  set-status <OI-####> <active|paused|completed>",
    "  add-task <OI-####> --task <text>",
    "  set-task-status <OI-####> <T-###> <status> [--notes <text>]",
    "  update-task <OI-####> <T-###> [--task <text>] [--notes <text>]",
    "  set-task-order <OI-####> <T-###> <number|none>",
    "  clear-completed-orders <OI-####>",
    "  delete-task <OI-####> <T-###>",
    "  add-note <OI-####> --text <text>",
    "  set-meta <OI-####> --json <json-object>",
    "",
    "Options:",
    "  --root <path>                 Repo root (default: cwd).",
    "  --project <name-or-path>      Target a project-local queue (bare name -> flow-library/<name>;",
    "                                paths resolve relative to --root; refused if outside --root).",
    "  -h, --help                    Show help.",
  ].join("\n");
}

const OI_STEM = /^OI-\d{4}$/;

function itemsDirFor(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "open-items", "items");
}

function todoPathFor(itemsDir: string, stem: string): string {
  return path.join(itemsDir, `${stem}.todo.json`);
}

function isPathLike(value: string): boolean {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\") || value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.startsWith(".\\") || value.startsWith("..\\");
}

function assertInsideRepo(repoRoot: string, target: string): void {
  const relative = path.relative(repoRoot, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`Refusing to target todo workspace outside --root. repoRoot=${repoRoot}; target=${target}`);
}

// Mirrors open-items `--project` resolution so a Flow/project-local queue is targeted
// safely. The whole CLI keys off `repoRoot` to find `.agents/open-items/items/`, so a
// project scope is just a redirected effective root (refused if it escapes the base root).
function parseArgs(argv: string[]): { repoRoot: string; rest: string[] } {
  let baseRoot = process.cwd();
  let project: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --root");
      }
      baseRoot = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--project") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("Missing value for --project");
      }
      project = next;
      i += 1;
      continue;
    }
    rest.push(arg);
  }
  const normalizedRoot = path.resolve(baseRoot);
  const scopeRoot = project
    ? path.resolve(normalizedRoot, isPathLike(project) ? project : path.join("flow-library", project))
    : normalizedRoot;
  assertInsideRepo(normalizedRoot, scopeRoot);
  return { repoRoot: scopeRoot, rest };
}

function takeFlag(rest: string[], name: string): string | null {
  const idx = rest.indexOf(name);
  if (idx === -1 || idx === rest.length - 1) {
    return null;
  }
  const value = rest[idx + 1];
  rest.splice(idx, 2);
  return value;
}

async function cmdCreate(repoRoot: string, stem: string): Promise<number> {
  if (!OI_STEM.test(stem)) {
    console.error(`Invalid open item id: ${stem}`);
    return 1;
  }
  const itemsDir = itemsDirFor(repoRoot);
  const filePath = todoPathFor(itemsDir, stem);
  try {
    await fs.access(filePath);
    console.error(`Already exists: ${filePath}`);
    return 1;
  } catch {
    /* ok */
  }
  const parent = await readParentOpenItemInfo(itemsDir, stem);
  if (!parent.exists) {
    console.error(`Parent missing: ${path.join(itemsDir, `${stem}.md`)}`);
    return 1;
  }
  if (parent.state && (parent.state === "done" || parent.state === "archived")) {
    console.error(`Parent open item is ${parent.state}; cannot create todo sidecar`);
    return 1;
  }
  const doc = emptyTodoSidecar(stem, todayStamp());
  await atomicWriteUtf8(filePath, serializeTodoSidecarCanonical(doc));
  console.error(`Created ${path.relative(repoRoot, filePath)}`);
  return 0;
}

function orderedTaskRows(doc: TodoSidecar): TodoTaskRow[] {
  return doc.tasks
    .filter((task) => task.order !== undefined)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

function orderedTaskLine(task: TodoTaskRow): string {
  return `${task.order} ${task.id} ${task.status} ${task.task}`;
}

function printOrderedTasks(doc: TodoSidecar): void {
  const ordered = orderedTaskRows(doc);
  if (ordered.length === 0) {
    console.log(`${doc.openItem} has no ordered tasks.`);
    return;
  }
  for (const task of ordered) {
    console.log(orderedTaskLine(task));
  }
}

async function cmdShow(repoRoot: string, stem: string, json: boolean, ordered: boolean): Promise<number> {
  const filePath = todoPathFor(itemsDirFor(repoRoot), stem);
  const loaded = await loadTodoSidecar(filePath);
  if (!loaded.ok) {
    console.error(`${filePath}: ${loaded.message}`);
    return 1;
  }
  if (ordered && json) {
    console.error("Use either --json or --ordered, not both");
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(loaded.doc, null, 2));
  } else if (ordered) {
    printOrderedTasks(loaded.doc);
  } else {
    console.log(serializeTodoSidecarCanonical(loaded.doc).trimEnd());
  }
  return 0;
}

async function cmdPlan(repoRoot: string, stem: string): Promise<number> {
  const filePath = todoPathFor(itemsDirFor(repoRoot), stem);
  const loaded = await loadTodoSidecar(filePath);
  if (!loaded.ok) {
    console.error(`${filePath}: ${loaded.message}`);
    return 1;
  }
  printOrderedTasks(loaded.doc);
  return 0;
}

function taskStatusCounts(doc: TodoSidecar): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of TASK_STATUSES) {
    counts[s] = 0;
  }
  for (const t of doc.tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  return counts;
}

async function cmdList(repoRoot: string, json: boolean, all: boolean): Promise<number> {
  const itemsDir = itemsDirFor(repoRoot);
  const stems = await listTodoJsonStems(itemsDir);
  let hadError = 0;
  const rows: Array<{
    stem: string;
    status: string;
    counts: Record<string, number>;
    rel: string;
  }> = [];
  for (const stem of stems) {
    const filePath = todoPathFor(itemsDir, stem);
    const loaded = await loadTodoSidecar(filePath);
    if (!loaded.ok) {
      console.error(`ERROR ${filePath}: ${loaded.message}`);
      hadError = 1;
      continue;
    }
    const { doc } = loaded;
    if (!all && doc.status === "completed") {
      continue;
    }
    rows.push({
      stem,
      status: doc.status,
      counts: taskStatusCounts(doc),
      rel: path.relative(repoRoot, filePath).split(path.sep).join("/"),
    });
  }
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      console.log(
        `${r.stem} ${r.status} ${r.counts.pending}/${r.counts.in_progress}/${r.counts.blocked}/${r.counts.completed} ${r.rel}`,
      );
    }
  }
  return hadError;
}

async function cmdValidate(repoRoot: string): Promise<number> {
  const issues = await validateAllTodoJsonSidecars({ repoRoot });
  let exit = 0;
  for (const issue of issues) {
    console.error(`${issue.level.toUpperCase()} ${issue.path}: ${issue.message}`);
    if (issue.level === "error") {
      exit = 1;
    }
  }
  if (issues.length === 0) {
    console.error("OK");
  }
  return exit;
}

async function cmdDelete(repoRoot: string, stem: string): Promise<number> {
  const filePath = todoPathFor(itemsDirFor(repoRoot), stem);
  try {
    await fs.unlink(filePath);
  } catch (e) {
    console.error(`Could not delete ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  console.error(`Deleted ${path.relative(repoRoot, filePath)}`);
  return 0;
}

async function readMutateWrite(
  repoRoot: string,
  stem: string,
  mutate: (doc: TodoSidecar) => void | string,
): Promise<number> {
  const itemsDir = itemsDirFor(repoRoot);
  const filePath = todoPathFor(itemsDir, stem);
  const loaded = await loadTodoSidecar(filePath);
  if (!loaded.ok) {
    console.error(`${filePath}: ${loaded.message}`);
    return 1;
  }
  const doc = JSON.parse(JSON.stringify(loaded.doc)) as TodoSidecar;
  const err = mutate(doc);
  if (typeof err === "string") {
    console.error(err);
    return 1;
  }
  const normalized = canonicalTodoSidecar(doc);
  const stemMismatch = validateTodoStemMatchesOpenItem(normalized, stem);
  if (stemMismatch) {
    console.error(stemMismatch);
    return 1;
  }
  const internal = validateTodoInternalConsistency(normalized);
  for (const issue of internal) {
    if (issue.level === "error") {
      console.error(`${issue.path}: ${issue.message}`);
      return 1;
    }
  }
  const parent = await readParentOpenItemInfo(itemsDir, stem);
  const cross = validateTodoAgainstParent(filePath, normalized, parent);
  for (const issue of cross) {
    if (issue.level === "error") {
      console.error(`${issue.path}: ${issue.message}`);
      return 1;
    }
  }
  await atomicWriteUtf8(filePath, serializeTodoSidecarCanonical(normalized));
  console.error(`Updated ${path.relative(repoRoot, filePath)}`);
  return 0;
}

async function cmdSetStatus(repoRoot: string, stem: string, status: string): Promise<number> {
  if (!TODO_FILE_STATUSES.includes(status as (typeof TODO_FILE_STATUSES)[number])) {
    console.error(`Invalid status: ${status}`);
    return 1;
  }
  return readMutateWrite(repoRoot, stem, (doc) => {
    doc.status = status as TodoSidecar["status"];
  });
}

async function cmdAddTask(repoRoot: string, stem: string, taskText: string): Promise<number> {
  return readMutateWrite(repoRoot, stem, (doc) => {
    const id = nextTaskId(doc.tasks);
    const row: TodoTaskRow = {
      id,
      date: todayStamp(),
      status: "pending",
      task: taskText,
      notes: "",
    };
    doc.tasks.push(row);
  });
}

async function cmdSetTaskStatus(
  repoRoot: string,
  stem: string,
  taskId: string,
  status: string,
  notes: string | null,
): Promise<number> {
  if (!TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
    console.error(`Invalid task status: ${status}`);
    return 1;
  }
  return readMutateWrite(repoRoot, stem, (doc) => {
    const row = doc.tasks.find((t) => t.id === taskId);
    if (!row) {
      return `No task ${taskId}`;
    }
    row.status = status as TodoTaskRow["status"];
    if (notes !== null) {
      row.notes = notes;
    }
  });
}

async function cmdUpdateTask(
  repoRoot: string,
  stem: string,
  taskId: string,
  taskText: string | null,
  notes: string | null,
): Promise<number> {
  return readMutateWrite(repoRoot, stem, (doc) => {
    const row = doc.tasks.find((t) => t.id === taskId);
    if (!row) {
      return `No task ${taskId}`;
    }
    if (taskText !== null) {
      if (!taskText.trim()) {
        return "Task text must be non-empty";
      }
      row.task = taskText;
    }
    if (notes !== null) {
      row.notes = notes;
    }
    if (taskText === null && notes === null) {
      return "Provide --task and/or --notes";
    }
  });
}

async function cmdSetTaskOrder(repoRoot: string, stem: string, taskId: string, orderText: string): Promise<number> {
  const normalized = orderText.toLowerCase();
  let order: number | undefined;
  if (normalized !== "none" && normalized !== "clear") {
    order = Number.parseInt(orderText, 10);
    if (!Number.isSafeInteger(order) || order <= 0 || String(order) !== orderText) {
      console.error("Order must be a positive integer, 'none', or 'clear'");
      return 1;
    }
  }
  return readMutateWrite(repoRoot, stem, (doc) => {
    const row = doc.tasks.find((t) => t.id === taskId);
    if (!row) {
      return `No task ${taskId}`;
    }
    if (order === undefined) {
      delete row.order;
      return;
    }
    const conflict = doc.tasks.find((t) => t.id !== taskId && t.order === order);
    if (conflict) {
      return `Order ${order} is already assigned to ${conflict.id}`;
    }
    row.order = order;
  });
}

async function cmdClearCompletedOrders(repoRoot: string, stem: string): Promise<number> {
  return readMutateWrite(repoRoot, stem, (doc) => {
    for (const row of doc.tasks) {
      if (row.status === "completed") {
        delete row.order;
      }
    }
  });
}

async function cmdDeleteTask(repoRoot: string, stem: string, taskId: string): Promise<number> {
  return readMutateWrite(repoRoot, stem, (doc) => {
    const before = doc.tasks.length;
    doc.tasks = doc.tasks.filter((t) => t.id !== taskId);
    if (doc.tasks.length === before) {
      return `No task ${taskId}`;
    }
  });
}

async function cmdAddNote(repoRoot: string, stem: string, text: string): Promise<number> {
  return readMutateWrite(repoRoot, stem, (doc) => {
    doc.notes.push(text);
  });
}

async function cmdSetMeta(repoRoot: string, stem: string, jsonText: string): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.error("Invalid JSON for --json");
    return 1;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("--json must be a JSON object");
    return 1;
  }
  return readMutateWrite(repoRoot, stem, (doc) => {
    doc.meta = { ...doc.meta, ...(parsed as Record<string, unknown>) };
  });
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(usage());
    return 0;
  }

  let repoRoot: string;
  let rest: string[];
  try {
    ({ repoRoot, rest } = parseArgs(args));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  const cmd = rest[0];
  const cmdArgs = rest.slice(1);
  if (!cmd) {
    console.log(usage());
    return 0;
  }

  if (cmd === "create") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    return cmdCreate(repoRoot, stem);
  }
  if (cmd === "show") {
    const json = cmdArgs.includes("--json");
    const ordered = cmdArgs.includes("--ordered");
    const stem = cmdArgs.find((a) => a !== "--json" && a !== "--ordered");
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    return cmdShow(repoRoot, stem, json, ordered);
  }
  if (cmd === "plan") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    return cmdPlan(repoRoot, stem);
  }
  if (cmd === "list") {
    const json = cmdArgs.includes("--json");
    const all = cmdArgs.includes("--all");
    return cmdList(repoRoot, json, all);
  }
  if (cmd === "validate") {
    return cmdValidate(repoRoot);
  }
  if (cmd === "delete") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    return cmdDelete(repoRoot, stem);
  }
  if (cmd === "set-status") {
    const stem = cmdArgs[0];
    const status = cmdArgs[1];
    if (!stem || !status) {
      console.error("Usage: set-status <OI-####> <active|paused|completed>");
      return 1;
    }
    return cmdSetStatus(repoRoot, stem, status);
  }
  if (cmd === "add-task") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    const local = cmdArgs.slice(1);
    const taskText = takeFlag(local, "--task");
    if (!taskText) {
      console.error("Missing --task");
      return 1;
    }
    return cmdAddTask(repoRoot, stem, taskText);
  }
  if (cmd === "set-task-status") {
    const stem = cmdArgs[0];
    const taskId = cmdArgs[1];
    const status = cmdArgs[2];
    if (!stem || !taskId || !status) {
      console.error("Usage: set-task-status <OI-####> <T-###> <status> [--notes <text>]");
      return 1;
    }
    const local = cmdArgs.slice(3);
    const notes = takeFlag(local, "--notes");
    return cmdSetTaskStatus(repoRoot, stem, taskId, status, notes);
  }
  if (cmd === "update-task") {
    const stem = cmdArgs[0];
    const taskId = cmdArgs[1];
    if (!stem || !taskId) {
      console.error("Usage: update-task <OI-####> <T-###> [--task <text>] [--notes <text>]");
      return 1;
    }
    const local = cmdArgs.slice(2);
    const taskText = takeFlag(local, "--task");
    const notes = takeFlag(local, "--notes");
    return cmdUpdateTask(repoRoot, stem, taskId, taskText, notes);
  }
  if (cmd === "set-task-order") {
    const stem = cmdArgs[0];
    const taskId = cmdArgs[1];
    const order = cmdArgs[2];
    if (!stem || !taskId || !order) {
      console.error("Usage: set-task-order <OI-####> <T-###> <number|none>");
      return 1;
    }
    return cmdSetTaskOrder(repoRoot, stem, taskId, order);
  }
  if (cmd === "clear-completed-orders") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    return cmdClearCompletedOrders(repoRoot, stem);
  }
  if (cmd === "delete-task") {
    const stem = cmdArgs[0];
    const taskId = cmdArgs[1];
    if (!stem || !taskId) {
      console.error("Usage: delete-task <OI-####> <T-###>");
      return 1;
    }
    return cmdDeleteTask(repoRoot, stem, taskId);
  }
  if (cmd === "add-note") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    const local = cmdArgs.slice(1);
    const text = takeFlag(local, "--text");
    if (!text) {
      console.error("Missing --text");
      return 1;
    }
    return cmdAddNote(repoRoot, stem, text);
  }
  if (cmd === "set-meta") {
    const stem = cmdArgs[0];
    if (!stem) {
      console.error("Missing OI-####");
      return 1;
    }
    const local = cmdArgs.slice(1);
    const jsonText = takeFlag(local, "--json");
    if (!jsonText) {
      console.error("Missing --json");
      return 1;
    }
    return cmdSetMeta(repoRoot, stem, jsonText);
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
