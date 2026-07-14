# Open-items skill notes

Maintains the repo's lightweight open-items system.

## File map

- `SKILL.md` — core behavior
- `ideas.md` — roadmap, CLI/script ideas, multi-agent orchestration (non-normative)
- `cli/openItemsCli.ts` — CLI entry (list / validate / index / init / capture / where, with optional `--project` scoping); **edit only under `.pi/skills/`**, then run skill parity sync
- `cli/openItemsLib.ts` — parsing, index generation, validation
- `CAPTURE-FORMAT.md` — inbox rules
- `ITEM-FORMAT.md` — item file contract
- `INDEX-FORMAT.md` — index contract
- `OPERATIONS.md` — natural-language actions
- `VERIFICATION.md` — verification checklist

## Portability (another repo)

Copy the whole `open-items` skill directory (this repo: `.pi/skills/open-items/` after you have synced from source). You need:

1. Repo layout the skill expects: `OPEN_ITEMS_CAPTURE.md` at repo root, `.agents/open-items/items/OI-####.md`, and `.agents/open-items/INDEX.md`.
2. **Node + `tsx`** to run TypeScript (add `tsx` as a devDependency if missing).

**`package.json` scripts (recommended):**

```json
"open-items": "tsx .pi/skills/open-items/cli/openItemsCli.ts"
```

Then: `npm run open-items -- list` (etc.) from the repo root.

Project/Flow-local queues can be targeted without changing repo root:

```powershell
npm run open-items -- init --project crossfit
npm run open-items -- list --project crossfit
npm run open-items -- where --project flow-library/crossfit
```

Bare project names resolve as `flow-library/<name>`; path-like project values resolve relative to the repo root and are refused if they escape the repo.

**Without adding a script** (still from repo root, path matches a Pi-layout checkout):

```bash
npx tsx .pi/skills/open-items/cli/openItemsCli.ts list
```

If your new repo only mirrors skills under `.cursor/skills/open-items/`, point `tsx` at that path instead, or run parity sync from `.pi` first and keep the `.pi` path as the single script target.

## Example capture input

```md
Purpose: User entered items that have not been formally moved into open items yet and need elaboration.

Begin Items Capture
---

# Example item title
This first paragraph becomes the summary.

This later paragraph becomes notes/discoveries.
```

## Example promoted item

```md
# Example item title

## id
OI-0001

## state
new

## summary
This first paragraph becomes the summary.

## notes/discoveries
This later paragraph becomes notes/discoveries.
```

## Example open-items index

```md
# Open Items Index

- OI-0001 — Example item title — state: new — ./items/OI-0001.md

## Counter (next OI id)
OI-0002
```

## Invariants

- This skill directory is the policy source of truth for the open-items system.
- `OPEN_ITEMS_CAPTURE.md` is the only required repo-root open-items file and acts as a staging inbox.
- Promoted capture entries are removed from it.
- Per-item files are the source of truth.
- `INDEX.md` is derived and excludes `done` and `archived`.
