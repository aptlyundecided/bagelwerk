# `src/core/built-ins`

Active built-in Flow packages that are maintained as part of the core repo.

The active built-ins surface is intentionally small. Bespoke demos, onboarding flows, experimental repair flows, and operator-specific automation should live outside this directory unless they are current product/proving surfaces with build/test ownership.

## Active packages

- `platform-tour/` — the Bagelwerk hero / welcome flow (`npm run flow:tour`). A durable, re-runnable teacher: real Nodes that create files, a nested context-handoff sub-flow, a Mermaid graph the Flow draws of itself (SVG), and a summary. Built on the current Flow Runner API; the worked example referenced by `GETTING-STARTED.md`.

## Recent removal

**PR Magic** — the `src/core/built-ins/pr-magic/` package, its run-profile metadata, and the `npm run flow:pr-magic` CLI were removed from the active built-ins surface and all code wiring. The `flow:pr-magic` script is no longer defined in `package.json`; `platform-tour/` (`npm run flow:tour`) is now the sole active built-in and the worked example for new Flows.

Documentation was updated to remove or repoint every PR Magic / `flow:pr-magic` reference: root `README.md`, `GETTING-STARTED.md`, `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`, `src/core/README.md`, this file, `src/core/built-ins/platform-tour/README.md` (and the `nodes/summarize.ts` next-step line), `src/core/flow-runner/README.md`, `flow-runner-core` `api/about.md` + `tests/about.md`, `src/core/notifications/README.md` and `notifications/demo.ts`, `src/tools/flow-runner/ink/README.md`, the `mermaid-graph-viewer` and `handoff-risk-review` skill docs across all mirrored surfaces (`.pi/`, `.claude/`, `.cursor/`, `.antigravitycli/`), the `version-release` skill, and `.env.example`.

Historical release notes under `changelog/releases/` still name PR Magic; those entries are intentionally left intact as immutable release history. The only other surviving mentions are this removal record and the matching `changelog/unreleased.md` entry. See `changelog/unreleased.md` and git history for the full removal record.

## Removed from active source

The following packages were removed from the active built-ins surface:

- `flow-doctor/`
- `github-pr-setup/`
- `guided-flow-builder/`
- `onboarding/`
- `pr-magic/` — removed 2026-07; see *Recent removal* above.
- `submit-current-work/`

Use git history for durable historical comparison. An operator may keep local, gitignored scratch copies under `flow-library/archive/`, but those copies are not part of a fresh clone, product documentation, or build authority. Do not reintroduce a tracked historical archive as a new ownership surface.
