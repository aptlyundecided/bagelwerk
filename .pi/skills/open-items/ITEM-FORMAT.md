# Open-item file format

Each open item lives in its own file under `.agents/open-items/items/`.

## Canonical template

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

## Rules

- Keep one item per file.
- Filename must match the id: `OI-0001.md`.
- `## state` must be one of: `new`, `triaged`, `ready`, `in_progress`, `blocked`, `done`, `archived`.
- Keep the full title in the H1 even if the index renders a shortened form.
- `## summary` should stay compact.
- `## notes/discoveries` may be multi-paragraph and preserve capture wording.
- Handoff/resume notes live inside `## notes/discoveries`, not as new top-level item sections.
- When a handoff is recorded, use the canonical block from `HANDOFF-FORMAT.md`.
