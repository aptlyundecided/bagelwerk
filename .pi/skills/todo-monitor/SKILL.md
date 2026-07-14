---
name: todo-monitor
description: Create and advance a per-open-item agent todo list using the `npm run todos --` CLI without pausing after each task. Follows todo-contract (strict CLI-only mutation) and todo-enforcer rules.
---

# Todo Monitor

Create and manage an **Agent todo list** for exactly one **Open Item**. This is the normal autonomous execution mode.

Read and follow `.pi/skills/todo-contract/SKILL.md` before creating or mutating a todo sidecar.

## Preconditions

- A target open item `OI-####` must exist before tracked todo work begins.
- If no open item exists, stop and create or promote one first.
- Operate on only one open item at a time.

## Process

### 1. Resolve the target open item

1. Identify the owning `OI-####`.
2. Read the open-item file (`OI-####.md`).
3. Ensure a JSON sidecar exists: if `.agents/open-items/items/OI-####.todo.json` is missing, run `npm run todos -- create OI-####` (requires parent item). If it already exists, continue.

### 2. Generate or refresh the todo list

1. Extract the concrete agent-work actions needed for the current execution pass.
2. For each planned action, **`npm run todos -- add-task OI-#### --task "…"`** (the CLI assigns `T-###` ids and dates).
3. Keep the sidecar scoped to that one open item only.

### 3. Execute normally

- **`set-task-status`** to `in_progress` when starting a task.
- **`set-task-status`** to `completed` immediately when done (optionally `--notes`).
- Continue to the next task without pausing for operator approval.
- Stop only when blocked, halted, or when operator input is actually required.

Prefer **`npm run todos -- list --json`** when you need a token-cheap overview of execution todos.

## Behavioral rule

`todo-monitor` is the non-pausing mode: iterate through the todo tasks in order, updating the sidecar **only through the todos CLI** as work progresses.

## Encountering legacy artifacts

If you find a working-directory `TODO.md` or an `OI-####.todo.md`, treat it as drift: split its tasks by owning open item, recreate them with `npm run todos -- create` + `add-task`, and delete the legacy file. See `todo-enforcer` § Encountering legacy artifacts.

## Usage

- Use when non-trivial tracked work begins for an existing open item.
- Use when an existing per-open-item todo list needs to be generated or refreshed.
- Use when the agent should keep moving through tasks autonomously rather than stopping after each one.
