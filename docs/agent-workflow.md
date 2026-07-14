# Agent workflow orientation

This repo supports agent-assisted development, but agent state has different durability levels. Use the right surface for the work.

## Main surfaces

| Surface | Purpose |
| --- | --- |
| `AGENTS.md` | Repo-wide operating rules for agents and contributors. |
| `.pi/skills/` | Canonical repo-local skills used by this harness. |
| `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, `.antigravitycli/skills/` | Mirrored skill surfaces for other harnesses. |
| `.agents/open-items/items/` | Tracked open-item records. |
| `.agents/open-items/items/OI-####.todo.json` | Per-open-item execution todo sidecars. Mutate only with `npm run todos -- ...`. |
| `.agents/adr/` | Local agent-facing decision notes, when present. |
| `.artifacts/` | Generated runtime artifacts; do not commit generated contents. |

## Open items and todos

Open items are durable work records. Todo sidecars are execution plans attached to a specific open item.

Rules that matter:

- mutate open items through the open-items workflow/CLI where applicable,
- mutate todo JSON only through `npm run todos -- <verb>`,
- do not hand-edit `*.todo.json`,
- if a needed todo verb is missing, pause and extend the CLI instead of bypassing it.

This strictness exists so agent sessions can hand work off without corrupting task state or silently drifting IDs, dates, and status vocabulary.

## Skills

`.pi/skills/` is the canonical skill surface in this repo. Mirrored harness folders should stay aligned when skill behavior changes. Use the skill-surface parity workflow when syncing those surfaces.

## Decision notes

ADR-style notes may live under `.agents/adr/` for now. Treat them as local agent context, not as the primary public documentation surface. If a decision becomes broadly important, promote the rule or explanation into `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`, a local README, or a focused file under `docs/`.

## Process safety

Before running commands, read `.current-os` and match the command style to that environment. Avoid process termination commands that could kill the current agent process.

## Flow execution caution

Do not run Flow CLIs or dogfood commands that execute real flows unless the operator explicitly asks. Deterministic unit tests and `npm run build` are usually fine; live/model-backed or quota-consuming runs are opt-in.
