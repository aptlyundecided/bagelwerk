---
name: todo-enforcer
description: Enforce the per-open-item todo contract (strict CLI-only mutation via `npm run todos --`; no hand-edits to `*.todo.json`) so tracked agent work stays focused, isolated, and linked to an open item.
---

# Todo Enforcer

Enforce the work-tracking methodology.

Read and follow `.pi/skills/todo-contract/SKILL.md` before deciding whether work may proceed.

## Rules (Hard — No Exceptions)

1. **No open item, no tracked work:** If non-trivial tracked work has no owning `OI-####`, stop and create or promote one first.
2. **One todo list per open item, CLI only:** Tracked execution work lives in `.agents/open-items/items/OI-####.todo.json` and is mutated **only** via `npm run todos -- …` (see `todo-contract` § CLI tooling). **Never hand-edit** `*.todo.json`; **never create** a new `.todo.md` sidecar or repo-root `TODO.md`.
3. **No mixed workstreams:** Do not place tasks for multiple open items into one sidecar.
4. **Complete before branching:** If a task is `in_progress`, finish it or explicitly mark it `blocked` before moving to another task (`set-task-status`).
5. **Discover → report or spawn:** If you discover meaningful new work for a different concept, `add-task` only if it advances the same OI; otherwise create or promote a separate open item with its own sidecar.
6. **Keep tracking current:** Mark tasks `in_progress`, `blocked`, or `completed` as soon as their state changes (CLI only).
7. **Missing verb → escalate, not bypass:** If the operation you need isn’t exposed by the CLI, stop and report to the operator so the CLI is extended. Do **not** hand-edit the JSON as a workaround.

## Enforcement questions

Ask before acting:

- What is the owning `OI-####`?
- Am I mutating only that item's sidecar via **`npm run todos --`**?
- Is this task already reflected (`npm run todos -- show` / `list`)?
- Am I about to create work that really belongs to a different open item?

## Encountering legacy artifacts

- **Stray `OI-####.todo.md`:** Treat as drift; surface via `npm run open-items -- validate` and delete (or replace via `npm run todos -- create OI-####` + `add-task` calls).
- **Repo-root `TODO.md`:** Treat as a pre-contract artifact; split its content into the appropriate `OI-####` sidecars (`add-task`) and delete the file.
- **Mixed or ownerless legacy todo files:** Reject further tracked execution against them until they are split per owning OI.

## Reporting format

```
TODO ENFORCEMENT REPORT:
Open item: OI-####
Current task: T-XXX [description]
Issue: [missing open item / mixed workstreams / out-of-scope discovery / malformed todo / hand-edited JSON / missing CLI verb]
Impact: [why work should pause or split]
Recommended next action: [create open item / split todo / add-task via CLI / ask operator to extend CLI]
```
