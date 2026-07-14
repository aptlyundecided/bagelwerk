# Open-items operations

The open-items skill accepts natural-language requests and maps them onto these core mutations.

## Move state

Example requests:
- `move OI-0001 to triaged`
- `mark OI-0004 blocked`
- `archive OI-0007`

Behavior:
- read the target item file
- update only the `## state` section
- regenerate `INDEX.md` from all item files
- if the new state is `done` or `archived`, omit the item from the regenerated index
- preserve the counter block at the bottom of `INDEX.md`

## Append notes/discoveries

Example requests:
- `append this note to OI-0001: needs owner decision`
- `add discovery to OI-0003 that the launcher path already exists`

Behavior:
- read the target item file
- append the new text under `## notes/discoveries`
- preserve existing notes
- do not rewrite the title or id
- regenerate `INDEX.md` only if state/title handling changed elsewhere

## Record handoff

Example requests:
- `add a handoff to OI-0010`
- `record handoff for OI-0004`
- `handoff OI-0007`

Behavior:
- read the target item file
- read `HANDOFF-FORMAT.md`
- append one canonical handoff block under `## notes/discoveries`
- preserve existing notes and file section order
- do not change state unless explicitly requested
- regenerate `INDEX.md` only if some other state/title mutation happened too

## Resume from handoff

Example requests:
- `resume OI-0010`
- `summarize latest handoff for OI-0004`

Behavior:
- read the target item file
- find the latest handoff block if present
- summarize its current state, next actions, important artifacts, and risks/open questions first
- if no handoff block exists, fall back to the item summary plus latest notes/discoveries content

## Regenerate index

Example requests:
- `refresh the open-items index`
- `rebuild INDEX.md from items`

Behavior:
- scan `.agents/open-items/items/OI-*.md`
- sort by id ascending
- include only items not in `done` or `archived`
- write the canonical bullet format
- keep `## Counter (next OI id)` at the bottom

Preferred implementation from repo root: `npm run open-items -- index` (rewrites `INDEX.md` from the same rules as this doc). Use `npm run open-items -- validate` afterward in CI or before commits when many items changed.

## Summarize queue

Example requests:
- `summarize the open items`
- `what's currently pending in open items?`

Behavior:
- summarize only open items
- keep the summary compact and operator-friendly
- prefer grouping by state or id order

## Cleanup and todo sidecars

Agent execution uses per-item JSON sidecars: `.agents/open-items/items/OI-####.todo.json`, mutated only via `npm run todos -- …` (see `.pi/skills/todo-contract/`). Legacy markdown `.todo.md` may still appear during transition; delete both formats when cleaning up a closed item.

### When an open item reaches `done` or `archived`

- Delete `OI-####.todo.json` if it exists, and delete legacy `OI-####.todo.md` if it exists. The item file is the durable record; the sidecar is only for in-flight execution.
- If you moved state in the same change, you already regenerated `INDEX.md`; no extra index action for deleting the sidecar alone.

### When deferring work on an open item

- Prefer `npm run todos -- set-status OI-#### paused`, finishing or clearing tasks with notes, or `npm run todos -- delete OI-####` until work resumes (`create` again when restarting). For legacy `.todo.md` only, the old markdown pause rules apply until that file is removed.

### Queue hygiene

- While refreshing the index or summarizing the queue, flag stray sidecars (for example `.todo.json` or `.todo.md` whose owning item is `done` or `archived`) and offer cleanup.
- Some agent environments cannot delete under `.agents/`; if removal fails in-tool, the operator should delete the path locally (for example `Remove-Item` on Windows PowerShell).
