---
name: skill-surface-parity
description: Mirror skills from `.pi/skills/` into the local `.codex/skills/`, `.claude/skills/`, `.cursor/skills/`, and `.antigravitycli/skills/` surfaces. Use when the user asks to sync, duplicate, or report parity for repo-local skills across harness directories.
---

# Skill Surface Parity

Maintain repo-local skill parity: **`.pi/skills/`** is the default source; the CLI mirrors into **`.codex/skills/`**, **`.claude/skills/`**, **`.cursor/skills/`**, and **`.antigravitycli/skills/`** unless you override roots (see `README.md` in the CLI folder).

## Repo skill roots

| Role | Path |
| --- | --- |
| Source of truth | `.pi/skills/` |
| Default targets (mirrored from source) | `.codex/skills/`, `.claude/skills/`, `.cursor/skills/`, `.antigravitycli/skills/` |

## Mandatory first reads

Read these before making changes:
- `src/tools/skill-surface-parity/README.md`
- any target skill files you expect to overwrite when investigating a mismatch manually

## Natural-language commands

Examples:
- "sync all skills to codex, claude, and cursor"
- "report skill parity"
- "duplicate `todo-monitor` to the other harness skill dirs"
- "sync only `open-items`"

Infer whether the user wants report-only or write mode.

## Source and targets

Default source of truth:
- `.pi/skills/`

Default targets:
- `.codex/skills/`
- `.claude/skills/`
- `.cursor/skills/`
- `.antigravitycli/skills/`

## Preferred execution path

Use the helper CLI:

```bash
npm run skills:sync:report
npm run skills:sync
```

For one or more named skills, pass `--skill`:

```bash
npm run skills:sync -- --skill todo-monitor
npm run skills:sync -- --skill open-items --skill todo-monitor
```

## Behavior contract

- preserve target-only skills
- copy missing files
- overwrite outdated files from `.pi/skills/`
- do not delete unmatched target skills
- summarize which target roots changed

## Suggested response shape

### Action
- what was requested

### Changes
- target roots updated
- skills/files synchronized

### Verification
- report-only output after sync
- any follow-up issues
