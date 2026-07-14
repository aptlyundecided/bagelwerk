# Open-item handoff format

Use handoff notes inside the existing `## notes/discoveries` section of an item file.

## Canonical block

```md
## Handoff 2026-05-08

### Current state
{1-3 sentences on what is true now}

### Next actions
- {next action}
- {next action}

### Important artifacts
- {path or artifact note}
- {path or artifact note}

### Risks / open questions
- {risk or unresolved question}
- {risk or unresolved question}
```

## Rules

- Append handoff blocks under `## notes/discoveries`; do not add new top-level sections to the item file.
- Use the literal heading `## Handoff <date>`.
- Keep `Current state` short and resume-oriented.
- Prefer concrete file paths under `Important artifacts` when they matter.
- If there are no special artifacts or risks, write `- none` rather than omitting the subsection.
- Multiple handoff blocks may exist; the latest one is the default resume surface.

## Resume behavior

When resuming an item, summarize the latest handoff block first if one exists.
If no handoff block exists, fall back to the item summary plus the latest notes/discoveries content.
