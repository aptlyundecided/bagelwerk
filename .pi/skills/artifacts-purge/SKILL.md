---
name: artifacts-purge
description: PAUSED / OPERATOR-GATED. Do not invoke autonomously. Tracked under OI-0011. The CLI can delete generated artifact trees, but `.artifacts/` is not uniformly ephemeral; prior Flow/Node run artifacts may be needed for resume, replay, comparison, or active investigations. No purge runs without explicit operator go-ahead.
---

# Artifacts Purge

> **STATUS: paused / operator-gated (2026-05-13).** Tracked under [OI-0011](../../../.agents/open-items/items/OI-0011.md).
>
> The CLI under `.pi/skills/artifacts-purge/cli/` is functional and its low-level safety guards (path-escape rejection, symlink rejection, dry-run default, `--yes` opt-in) all work as designed. **But the skill's original premise is wrong**: it treats every entry under `.artifacts/` as disposable, and that is not true. Some prior Flow/Node run artifacts may be needed for resume, replay, comparison, recovery, or active investigations. Purging them silently can destroy in-flight work.
>
> Until preservation is designed and shipped (OI-0011 preservation tasks), **agents must not invoke `npm run artifacts:purge` against the live repo `.artifacts/` tree.** The script is left registered in `package.json` so existing operator workflows are not surprised, but the operator must explicitly OK every run.

Reclaim disk space and clear stale generated outputs under repo-root `.artifacts/` (or another repo's `.artifacts/` via `--root <path>`).

`.artifacts/` is the standard write target for runtime-generated artifacts across the repo (per `CONTEXT.md` and `AGENTS.md` § Artifacts). It is gitignored and machine-specific. **However, not every entry is cheap to recreate** — see the preservation gap below.

## When to use (post-preservation; not yet)

- `.artifacts/` has grown large and you want to reclaim space.
- Stale artifact runs are confusing new investigations; you want a clean slate.
- Before benchmarking a fresh run that needs a known-empty starting state.
- Before a durable handoff where the operator wants generated state minimized.

Each of the above currently requires operator confirmation **per invocation** and, ideally, an explicit `--keep <glob>` listing the subtrees that must survive. None of that is in place yet.

## Do not use this

- **Autonomously, ever, against the live repo `.artifacts/` tree.** Operator must give explicit go-ahead for each run until preservation lands.
- To delete user-owned files elsewhere in the repo (the CLI refuses).
- To remove the `.artifacts/` directory itself (the CLI preserves it; tools that write to it will recreate subtrees as needed).
- To inspect or restore individual artifacts — use git, file system tools, or the producing Flow/Node surface instead.

## Preservation gap (open)

`.artifacts/` is **not** a uniformly ephemeral directory. Known consumers of prior artifact state include:

- **Flow/Node resume, fork, and replay workflows** that read upstream run outputs from `.artifacts/` to continue or branch from a known state.
- **Replay benches** and dogfood loops that compare against last-known outputs.
- **In-flight open items** whose investigation depends on artifacts produced by earlier sessions.

Until those subtrees are inventoried and the CLI can preserve them by default (planned: a curated default-preserve list plus `--keep <glob>` plus optional `.artifacts/.preserve` sentinel), the purge tool is **not safe to run unattended** even with all its existing path / symlink guards.

Tracked preservation work under OI-0011:

- `T-006` — Discover preservation requirements for active Flow/Node artifact consumers and historical replay/resume assumptions.
- `T-007` — Implement preservation in the CLI (`--keep` / sentinel / default-preserve set).
- `T-008` — Re-run smoke tests using `--root <tempdir>`, never the live tree.
- `T-009` — Re-evaluate operator-gate strength once preservation defaults exist.

## CLI tooling (strict)

TypeScript CLI: `.pi/skills/artifacts-purge/cli/artifactsPurgeCli.ts`. **Do not invoke it unless the operator explicitly asks for that exact purge run.** When changing this skill's warning/quarantine text, edit the canonical `.pi/skills/` copy first and sync mirrors so every harness sees the same operator gate.

From repo root: `npm run artifacts:purge`. Fallback: `npx tsx .pi/skills/artifacts-purge/cli/artifactsPurgeCli.ts`. **Both forms require operator confirmation per invocation until preservation lands.**

| Invocation | Effect |
| --- | --- |
| `npm run artifacts:purge` | **Dry-run.** Lists every top-level entry under `.artifacts/` that would be deleted. No filesystem changes. Exits 0. |
| `npm run artifacts:purge -- --yes` | Deletes the listed entries. Leaves the `.artifacts/` directory itself in place. Exits 0 on full success, 1 if any entry failed. |
| `npm run artifacts:purge -- --root <path>` | Run against a different repo checkout. May be combined with `--yes`. |

## Output format

One line per top-level entry under `.artifacts/`, kind-prefixed and space-separated (rigid for agents, cheap on tokens):

```text
<kind> <repo-relative-path>
```

`<kind>` is one of `dir `, `file`, `link`. Examples:

```text
dir  .artifacts/agents
dir  .artifacts/runs
file .artifacts/last-run.json
```

A summary line is emitted to stderr (`DRY-RUN: would delete N…` or `Removed N entr…`). Stdout carries only the entry list, so it is safe to pipe.

## Safety guarantees

1. **Path resolution is anchored to repo root.** The CLI refuses if the resolved `.artifacts/` path is not exactly `.artifacts` directly under the repo root.
2. **Symlink rejection.** If `.artifacts/` itself is a symbolic link, the CLI refuses (prevents `.artifacts -> /etc` style traps). Symlink entries *inside* `.artifacts/` are removed as symlinks; their targets are not touched.
3. **Dry-run default.** Running without `--yes` never mutates the filesystem.
4. **Directory preservation.** The `.artifacts/` directory itself is preserved; only its contents are removed.
5. **No interactive prompts.** `--yes` is the confirmation. The CLI is usable in CI or scripted contexts only after the operator has explicitly approved that run.

## Out of scope (paused version)

- Recreating placeholder files after purge. Producers should bootstrap their own subtrees.
- Cross-machine remote purges. Use the local CLI in each checkout.
- Running unattended against this repo's live `.artifacts/` tree before preservation defaults exist.

(Note: `--keep <glob>` *was* listed as v1-out-of-scope when this skill was first authored, but the smoke-test incident on 2026-05-13 reframed it as a **v1 prerequisite**. Tracked as T-007 on the OI-0011 sidecar.)
