---
name: open-items
description: Maintain the repo's open-items workspace under `.agents/open-items/` by promoting capture entries, regenerating the open-item index, moving item state, appending notes, summarizing the queue, and using the dev CLI for bulk reads and index regeneration.
---

# Open Items

Maintain the repo's lightweight open-items system.

The open-items policy lives with this skill, not in a separate repo-root policy file.

V1 uses:
- capture inbox: `OPEN_ITEMS_CAPTURE.md`
- workspace root: `.agents/open-items/`
- item files: `.agents/open-items/items/OI-####.md`
- derived index: `.agents/open-items/INDEX.md`
- dev CLI (bulk list, validate, regen index, capture snapshot): `npm run open-items -- …` — see § **CLI tooling**

Per-item files are the source of truth. `INDEX.md` is derived.

At repo root, keep only the capture inbox file: `OPEN_ITEMS_CAPTURE.md`.

## Mandatory first reads

This skill directory is the policy source of truth for the open-items system.

Read these before making changes:
- `OPEN_ITEMS_CAPTURE.md`
- `.agents/open-items/INDEX.md` if it exists
- for **read-only “whole queue”** questions, prefer `npm run open-items -- list` or `list --json` (stdout) before opening every item file — § **CLI tooling**
- any target item file being changed under `.agents/open-items/items/`
- supporting docs in this skill directory when the operation depends on format or mutation rules

Supporting docs in this directory:
- `ideas.md` — roadmap, CLI/script ideas, multi-agent orchestration notes (non-normative)
- `CAPTURE-FORMAT.md`
- `ITEM-FORMAT.md`
- `INDEX-FORMAT.md`
- `HANDOFF-FORMAT.md`
- `OPERATIONS.md`

## CLI tooling (repo)

TypeScript CLI: `.pi/skills/open-items/cli/openItemsCli.ts` (with `openItemsLib.ts`). **Edit only under `.pi/skills/`**; run `npm run skills:sync -- --skill open-items` so `.claude/`, `.cursor/`, and `.codex/` copies stay identical. From repo root: `npm run open-items -- <command>` (see root `package.json`). Without a script, from repo root: `npx tsx .pi/skills/open-items/cli/openItemsCli.ts <command>`.

| Command | Output |
| --- | --- |
| `list` | **stdout:** markdown table of **open** items (id, state, title, summary clip, path). |
| `list --json` | **stdout:** JSON array of open items (full summary, paths). |
| `list --all` | Same as `list`, but includes `done` and `archived`. |
| `validate` | **stderr:** errors and warnings; **exit 1** if any **error** (malformed item, index state mismatch, bad counter). |
| `index` | Rewrites `.agents/open-items/INDEX.md` from item files and advances counter to max id + 1. |
| `init` | Creates missing `OPEN_ITEMS_CAPTURE.md`, `.agents/open-items/items/`, and `.agents/open-items/INDEX.md` in the selected scope. |
| `capture` | **stdout:** pending `#` H1 capture titles below the capture boundary (with line numbers). |
| `where` | **stdout:** resolved repo root, selected scope root, items dir, index path, and capture path. |

Optional for every command: `--root <abs-or-rel-path>` to point at another repo checkout.

Project-scoped queues: use `--project <name-or-path>` to target a Flow/project-local open-items queue without changing the repo root. Bare names resolve to `flow-library/<name>`; path-like values resolve relative to `--root`; targets outside `--root` are refused to avoid cross-contamination. Examples:

```powershell
npm run open-items -- init --project crossfit
npm run open-items -- list --project crossfit
npm run open-items -- validate --project flow-library/crossfit
npm run open-items -- where --project crossfit
```

A project-scoped queue uses the same storage contract under the selected scope:

```text
flow-library/<project>/
  OPEN_ITEMS_CAPTURE.md
  .agents/open-items/INDEX.md
  .agents/open-items/items/OI-####.md
```

Default commands without `--project` continue to use the repo-level queue under repo-root `.agents/open-items/`.

### When agents should run the CLI (prefer script stdout over token-heavy file walks)

- **Operator asks for the full queue, a table, or “what is open”** — run `list` or `list --json` and base the answer on script output instead of re-opening every `OI-####.md` manually.
- **Before or after bulk edits to many items** — run `validate` so counter, index bullets, and item shapes are consistent.
- **After changing titles or states across several items** — run `index` to regenerate `INDEX.md` deterministically (same rules as manual regen in this skill).
- **Before promoting capture** — run `capture` to list pending H1 sections explicitly.

Still **open and edit** the specific `OI-####.md` (and `HANDOFF-FORMAT.md`) when recording handoffs, append-only notes, resume, or any prose mutation—the CLI does not replace reading the file you are changing.

**Execution todos:** use `npm run todos -- list` / `list --json` / `validate` for per-item JSON sidecars (see `todo-contract`); `open-items validate` surfaces cross-surface drift with those files.

## Natural-language commands

Examples:
- "promote all capture items"
- "refresh the open-items index"
- "move OI-0003 to blocked"
- "append this note to OI-0004"
- "add a handoff to OI-0010"
- "resume OI-0010"
- "summarize the open-items queue"

Infer the requested action from natural language.

## Storage contract

### Workspace shape

```text
.agents/
  open-items/
    INDEX.md
    items/
      OI-0001.md
      OI-0002.md
```

Create missing directories/files as needed.

### Allowed states

- `new`
- `triaged`
- `ready`
- `in_progress`
- `blocked`
- `done`
- `archived`

### Per-item file contract

Use this exact section order:

```md
# {title}

## id
OI-0001

## state
new

## summary
{first paragraph or compact summary}

## notes/discoveries
{remaining notes}
```

### Index contract

`INDEX.md` includes only open items. Exclude items whose state is:
- `done`
- `archived`

Regenerate the index from item files sorted by id ascending.

Write bullets in this format:

```md
- OI-0001 — {title} — state: {state} — ./items/OI-0001.md
```

At the bottom keep the counter block:

```md
## Counter (next OI id)
OI-0002
```

Store the full next id string in the counter.

### Index title policy

Aim for titles with 5 words or fewer.

Do not fail if a title is longer.
For index rendering only:
- if the title has more than 5 words, render the first 5 words plus `…`

Keep the full title in the item file.

## Capture inbox contract

`OPEN_ITEMS_CAPTURE.md` is a staging inbox, not an archive.

Use this literal boundary:

```md
Begin Items Capture
---
```

Do not remove or rewrite content above that boundary.

Below the boundary, each `# H1` section is one capture entry:
- the `# ...` line becomes the item title
- the section continues until the next `# ` H1 or end-of-file

### Promotion rules

When asked to promote capture items:
1. process all entries in file order
2. allocate sequential ids using the `INDEX.md` counter (or bootstrap from `OI-0001`)
3. create one item file per entry with initial state `new`
4. set `summary` to the first paragraph after the H1 title
5. place the remaining body in `notes/discoveries`
6. remove the processed H1 sections from the capture file
7. regenerate `INDEX.md`
8. advance the counter to the next available `OI-####`

## Mutation rules

### Move state

When asked to move an item:
- update only the `## state` section in the item file
- regenerate `INDEX.md`
- if state becomes `done` or `archived`, remove it from the open-items index
- if state becomes `done` or `archived`, delete `.agents/open-items/items/OI-####.todo.json` if it exists, and delete legacy `.agents/open-items/items/OI-####.todo.md` if it exists (see `OPERATIONS.md` — Cleanup and todo sidecars; follow `todo-contract` if recreating later)

### Append notes

When asked to append notes:
- append to `## notes/discoveries`
- preserve existing content
- regenerate `INDEX.md` only if the title/state changed elsewhere

### Record handoff

When asked to add a handoff:
- read `HANDOFF-FORMAT.md`
- append a canonical handoff block under `## notes/discoveries`
- preserve existing content and section order
- do not change item state unless explicitly asked

### Resume from handoff

When asked to resume an item:
- read the latest handoff block if one exists
- summarize current state, next actions, important artifacts, and risks/open questions from that block first
- if no handoff block exists, fall back to the item summary plus latest notes/discoveries content

### Summarize queue

When summarizing or listing the queue, follow **Operator and agent guidance — Queue-style answers** below. Operationally: use open items only, stay compact, exclude `done` and `archived`.

## Operator and agent guidance

Normative for how agents phrase answers to humans and to parallel agents; does not change storage paths or section order in item files.

### When to use what

| Situation | Where to put it |
| --- | --- |
| Raw idea not ready for an `OI-####` id yet | `OPEN_ITEMS_CAPTURE.md` below the capture boundary (one `#` H1 section per idea). |
| Durable tracked unit of work | Promote capture to `.agents/open-items/items/OI-####.md`, or create an item file directly per `ITEM-FORMAT.md`. |
| Chronological findings without redefining ownership | Append under `## notes/discoveries` on the item file. |
| Session boundary so another human or agent can resume | Append a **Handoff** block per `HANDOFF-FORMAT.md` (adds context; does not replace notes). |
| Executable checklist scoped to one item | `OI-####.todo.json` per `todo-contract` (mutations via `npm run todos -- …`; not the capture inbox). |

### Anti-patterns

- **Eternal capture:** entries that never leave `OPEN_ITEMS_CAPTURE.md` — promote into items or delete intentionally.
- **Notes wall:** very long `notes/discoveries` with no recent **Handoff** — add a handoff when the story is hard to scan or you switch agents.
- **Ghost `in_progress`:** `in_progress` with no todo sidecar (neither `.todo.json` nor legacy `.todo.md`) and no handoff naming who is acting — move to `ready`/`blocked` or record a handoff.
- **Done without verification:** moving to `done` when acceptance or checks named in the item (or `VERIFICATION.md` for the skill) were never satisfied.
- **Todo scope leak:** unrelated work streams in one `OI-####.todo.json` — split into separate open items.

### Queue-style answers (mandatory fields)

When the operator asks to list, show, or summarize open items:

1. **Scope:** open items only — exclude `done` and `archived`.
2. **Markdown table** with columns `ID`, `Title`, `State`, `Summary` (use each item file’s `## summary`; shorten to one clause in the table when long).
3. **Who acts next:** immediately after the table, a short subsection. Per item or grouped by state, state whether **human**, **agent**, or **either** should move it forward, inferred from `state`, latest handoff “Next actions”, and open questions.
4. **Next concrete action:** a short list of **verifiable** next actions (commands to run, paths to open, or explicit mutations like “move OI-0004 to blocked”).

If the queue is empty, say so and mention `OPEN_ITEMS_CAPTURE.md` for new capture.

## Safety rules

- Do not invent ids out of order.
- Keep the `INDEX.md` counter block correct.
- Do not leave promoted capture entries behind.
- Do not delete content above `Begin Items Capture` / `---`.
- If an item file is malformed, repair it to the canonical section order before further mutation.
- Keep todo sidecars aligned with lifecycle: remove `OI-####.todo.json` (and legacy `OI-####.todo.md`) when the owning item is `done` or `archived`; use `paused`/cleared tasks or **`npm run todos -- delete`** when deferring execution work (details in `OPERATIONS.md`).

## Suggested response shape

### Action
- what was requested

### Changes
- files created/updated
- ids created or states moved

### Queue Snapshot
- compact summary of open items using the **Queue-style answers** table plus **Who acts next** and **Next concrete action** from § Operator and agent guidance

### Follow-ups
- anything the operator may want to triage next (include stale handoffs or capture backlog when relevant)
