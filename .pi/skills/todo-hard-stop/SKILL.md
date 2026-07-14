---
name: todo-hard-stop
description: Execute a per-open-item todo list via the `npm run todos --` CLI under the canonical todo contract, pausing after each completed task for operator feedback.
---

# Todo Hard Stop

Use the same per-open-item todo contract as `todo-monitor`, but with operator-gated progression.

Read and follow `.pi/skills/todo-contract/SKILL.md` before creating or mutating a todo sidecar.

## Preconditions

- A target open item `OI-####` must exist.
- Use only that open item's JSON sidecar (`OI-####.todo.json`) and the **`npm run todos --`** CLI for all mutations.

## Behavior

1. Start the next task: `npm run todos -- set-task-status OI-#### T-### in_progress`.
2. Complete the work, then: `npm run todos -- set-task-status OI-#### T-### completed` (add `--notes` when useful).
3. Stop and report current state (include `npm run todos -- show OI-#### --json` or a concise summary).
4. Wait for operator feedback before continuing to the next task.

## Use this mode when

- the operator wants tight control
- each task completion should be reviewed before proceeding
- the work is risky, ambiguous, or likely to branch

## Contrast with todo-monitor

- `todo-monitor` keeps iterating without pausing after each task
- `todo-hard-stop` pauses after every completed task
