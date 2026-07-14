---
name: todo-contract
description: Defines the canonical per-open-item todo JSON sidecar, strict CLI-only mutation, status vocabulary, and linkage rules.
---

# Todo Contract

The todo system is an execution-tracking surface for agent work, not a generic project backlog.

## Core distinction

- **Open Item** = durable conceptual work record (`OI-####.md`)
- **Agent todo list** = execution task list for exactly one open item (`OI-####.todo.json`)

## Storage contract

Use **one JSON sidecar** per open item:

```text
.agents/open-items/items/OI-####.todo.json
```

Do not create a repo-wide shared `TODO.md` for tracked agent work.

**Legacy:** Markdown sidecars `OI-####.todo.md` and repo-root `TODO.md` are **retired**. Any that still exist are drift; the open-items validator surfaces them (see `todo-enforcer` § Encountering legacy artifacts).

## CLI tooling (strict mutation)

TypeScript CLI: `.pi/skills/todo-contract/cli/todoContractCli.ts` (with `todoContractLib.ts`). **Edit only under `.pi/skills/`**; run `npm run skills:sync -- --skill todo-contract` so `.claude/`, `.cursor/`, and `.codex/` copies stay identical.

From repo root: `npm run todos -- <command>`. Fallback: `npx tsx .pi/skills/todo-contract/cli/todoContractCli.ts <command>`.

| Command | Purpose |
| --- | --- |
| `create <OI-####>` | Create sidecar (parent item must exist; not `done`/`archived`). |
| `show <OI-####> [--json\|--ordered]` | Read one sidecar, or print ordered task rows only. |
| `plan <OI-####>` | Print ordered task rows only (`<order> <T-###> <status> <task>`); tasks without `order` are disregarded. |
| `list [--json] [--all]` | Bulk read (default excludes todo-files in `completed` status). Default format is rigid compact lines — see § `list` output format. |
| `validate` | Structural + cross-surface checks (stderr; exit 1 on errors). |
| `delete <OI-####>` | Remove sidecar (e.g. after parent item is `done`/`archived`). |
| `set-status <OI-####> <active\|paused\|completed>` | Todo-file status. |
| `add-task <OI-####> --task <text>` | Append task (`T-###` and date assigned by CLI). |
| `set-task-status <OI-####> <T-###> <status> [--notes <text>]` | Update task status (and optionally replace notes). |
| `update-task <OI-####> <T-###> [--task <text>] [--notes <text>]` | Edit task text and/or notes. |
| `set-task-order <OI-####> <T-###> <number\|none>` | Assign or clear a sparse numeric execution order. Suggested coarse values: `10000`, `20000`, `30000`; use in-between values for inserted or related work. |
| `clear-completed-orders <OI-####>` | Clear `order` from all completed tasks so priority views disregard them. |
| `delete-task <OI-####> <T-###>` | Remove a task row. |
| `add-note <OI-####> --text <text>` | Append to top-level `notes` array. |
| `set-meta <OI-####> --json <object>` | Shallow-merge JSON object into `meta`. |

Optional: `--root <path>` on any command.

**Project-scoped queues:** `--project <name-or-path>` targets a Flow/project-local todo queue, mirroring the open-items resolver. Bare names resolve under `flow-library/<name>`; path-like values resolve relative to `--root`; targets outside `--root` are refused. The sidecar then lives beside its project-scoped parent item, e.g. `flow-library/<name>/.agents/open-items/items/OI-####.todo.json`. Use the **same** flag value for `open-items` and `todos` so both surfaces operate on one queue:

```bash
npm run open-items -- init --project strategy-graph
npm run todos -- create OI-0001 --project strategy-graph
npm run todos -- list --project strategy-graph
```

Default commands without `--project` use the repo-level queue under repo-root `.agents/open-items/`.

### Mutation authority (hard)

- **Never hand-edit** `OI-####.todo.json`. All writes go through the CLI above.
- If the operation you need is not expressible with these verbs, **stop**, report to the operator, extend the CLI, then resume. Do not bypass with direct file edits.
- **Reads** may use `show` / `list` / `validate` (preferred for bulk) or read the file in the editor — but treat non-canonical bytes as corruption and escalate.

### `list` output format

`npm run todos -- list` prints **one row per sidecar**, space-separated, no header, no markdown table syntax (rigid for agents, cheap on tokens):

```
<OI-id> <file-status> <pending>/<in_progress>/<blocked>/<completed> <repo-relative-path>
```

Example:

```
OI-0011 active 5/0/0/0 .agents/open-items/items/OI-0011.todo.json
OI-0042 active 6/1/0/3 .agents/open-items/items/OI-0042.todo.json
```

Notes:

- **4 fields per line**, in fixed order. The path is **last**, so a parser may safely split on whitespace into 4 tokens (path absorbs any trailing spaces).
- Counts collapse to `p/ip/b/c` (`pending` / `in_progress` / `blocked` / `completed`). The order is fixed; agents should not infer it from a header.
- Rows are sorted ascending by OI id. Sidecars with file status `completed` are excluded by default; pass `--all` to include them.
- Pass `--json` for the structured form (preferred for programmatic consumers).

### When agents should prefer CLI stdout

- Operator asks for a token-cheap overview of execution todos — run `list` (rigid lines) or `list --json` (structured).
- Before or after bulk validation — `npm run todos -- validate` (and `npm run open-items -- validate` for cross-surface hygiene).

## Ownership rules

- Every sidecar must name exactly one owning `OI-####` in `openItem` and match the filename stem.
- Every todo task exists to advance its owning open item.
- If there is no open item, create or promote one before tracked todo work proceeds.
- Do not mix tasks for multiple open items in one sidecar.

## Canonical JSON shape

On disk the file is **pretty-printed JSON** (2-space indent), **stable key order**, trailing newline, and `tasks` sorted ascending by `id`. The CLI is the only writer; this is enforced at read time for mutations.

```json
{
  "openItem": "OI-0042",
  "status": "active",
  "generated": "2026-05-13",
  "tasks": [
    {
      "id": "T-001",
      "date": "2026-05-13",
      "order": 10000,
      "status": "pending",
      "task": "Example task text",
      "notes": ""
    }
  ],
  "notes": [],
  "meta": {}
}
```

- **`order`:** optional sparse positive integer for execution priority. Tasks without `order` are valid and are ignored by ordered/plan views. Prefer coarse values (`10000`, `20000`, `30000`) and insert related work between them (`11000`, `11100`, etc.) instead of renumbering task ids.
- **`meta`:** optional extension bag (shallow-merged via `set-meta`). Keep small; bulk listing tools may ignore it.
- **`notes`:** array of strings; execution-local bullets or reminders for this OI.

## Task id convention

- Local sequential ids: `T-001`, `T-002`, … assigned by the CLI (`add-task`). **Never reuse** a deleted id number in the same file.
- Task ids are local to one sidecar, not global across the repo.

## Status vocabulary

### Todo-file status (`status`)

- `active`
- `paused`
- `completed`

### Todo-task status (`tasks[].status`)

- `pending`
- `in_progress`
- `blocked`
- `completed`

## Mutation rules (via CLI only)

- **`add-task`** dates the task on creation (CLI-supplied date).
- **`set-task-status`:** mark `in_progress` when starting a task; `completed` when finishing; `blocked` when work cannot continue.
- Add newly discovered in-scope work with **`add-task`** instead of silently doing it off-book. `add-task` creates an unordered task by default; assign priority explicitly with **`set-task-order`**.
- If **all** tasks are `completed`, set todo-file status to `completed` via **`set-status`**.
- If work is paused awaiting operator input or external dependency, set todo-file status to **`paused`** via **`set-status`**.
- Preserve one-open-item isolation at all times.
- When a completed task should disappear from priority-focused views, run **`clear-completed-orders <OI-####>`** or clear that task's order with **`set-task-order <OI-####> <T-###> none`**.

## Cross-surface lifecycle (with open items)

- **`todos create`** requires the parent `OI-####.md` to exist and **not** be `done`/`archived`.
- When the owning open item becomes **`done`** or **`archived`**, run **`todos delete <OI-####>`** explicitly (no implicit cascade from other tools).
- **`npm run open-items -- validate`** and **`npm run todos -- validate`** both surface cross-surface drift (orphan sidecar, closed parent with sidecar, ghost `in_progress` without any sidecar, both `.todo.md` and `.todo.json` present).

## Cleanup / lifecycle

- **Owning open item is `done` or `archived`:** Delete `OI-####.todo.json` (and any legacy `OI-####.todo.md`) per open-items cleanup. Completed execution history belongs in the item’s notes or git history, not as a leftover sidecar.
- **Deferring work:** `set-status` to `paused`, complete/clear tasks with a short note, or **`delete`** the sidecar until work resumes (`create` again when restarting).
- **Queue-wide hygiene:** Open-items operators follow `.pi/skills/open-items/OPERATIONS.md` (Cleanup and todo sidecars).

## Mutation examples (CLI)

### Starting a task

```bash
npm run todos -- set-task-status OI-0042 T-002 in_progress
```

### Finishing a task

```bash
npm run todos -- set-task-status OI-0042 T-002 completed --notes "Implemented lib"
```

### Blocking

```bash
npm run todos -- set-task-status OI-0042 T-002 blocked --notes "Waiting on API key"
npm run todos -- set-status OI-0042 paused
```

### New in-scope work

```bash
npm run todos -- add-task OI-0042 --task "Add cross-surface warning to open-items validate"
```
