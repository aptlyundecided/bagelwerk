# Getting Started with Bagelwerk

The shortest path from a fresh clone to a Flow you wrote yourself is three moves:

1. **Run a real Flow** — the **Platform Tour** built-in (`npm run flow:tour`) is the worked example.
2. **Read it as code** — its source under `src/core/built-ins/platform-tour/` is small, focused, and meant to be copied.
3. **Build your own** — scaffold a starter Flow with `npm run flow:init`, then run it under the Flow Supervisor.

The sections below follow that same arc, with the exact commands. The Platform Tour is the only built-in Flow and the reference shape for "a real Flow," so this guide never asks you to run anything else first.

## 1. Prerequisites

- **Node.js** (current LTS) and **npm**
- **git**, with read access to this repo
- An **agent harness** for the agent-backed steps, installed and signed in. Supported runtimes: **cursor** (`cursor-agent`), **claude-code** (`claude`), **opencode**, and **pi**. (agy/jules are not supported.)

## 2. Clone & install

```powershell
git clone https://github.com/aptlyundecided/bagelwerk.git
cd bagelwerk
npm install
```

> `npm run build` is optional — the CLIs run through `tsx`, so you don't need to compile first. Run it only to validate the install.

## 3. Configure your environment

```powershell
Copy-Item .env.example .env   # bash: cp .env.example .env
```

Then edit `.env`:

- **`FLOW_AGENT_RUNTIME`** — `cursor` (default), `claude-code`, `opencode`, or `pi`. This is the harness the Platform Tour's agent-backed Nodes run on.
- **`BAGELWERK_AGENT_ARTIFACTS_ROOT`** — defaults to repo-relative `.artifacts/agents`. Keep as-is unless you want a fixed path. The run creates this directory if missing, so it only needs to be **set and writable**; the Platform Tour also supplies a session-local fallback when it's unset, but leave it pointed at `.artifacts/agents` so your *own* agent-backed Flows share one artifacts root.
- **claude-code** runs headless and defaults to `bypassPermissions`, so no extra config is needed. Set `CLAUDE_CODE_PATH` only if `claude` is not on your PATH.
- **cursor** — set `CURSOR_AGENT_PATH` only if `cursor-agent` is not on your PATH. **opencode** — set `OPENCODE_PATH` only if `opencode` is not on your PATH, and give `FLOW_MODEL` in `provider/model` form.
- **pi** manages its own providers, auth, and model config. Pin the provider in `FLOW_MODEL` (for example `openai-codex/gpt-5.4-mini:low`) — pi fuzzy-matches a model pattern across *all* its configured providers, so an unqualified name can land on the wrong one. A `:<thinking>` suffix (`off|minimal|low|medium|high|xhigh`) trades speed for review depth.

Sign your chosen harness in once, using its own flow (run `claude` interactively for Claude Code, sign in to Cursor for `cursor-agent`, or use pi's provider login).

## 4. Agent-harness preflight (one-time, automatic)

Every agent-backed run starts with an **agent-harness preflight**: the runner verifies that the selected runtime's CLI (from step 3) is installed. If it's missing, the run stops early and writes a `harness-status` artifact that tells you exactly what to install or sign into — instead of failing deep inside a Flow. You don't do anything extra here beyond steps 1–3; this just explains why a run can stop early with clear guidance when your harness isn't ready.

## 5. Run a real Flow — the Platform Tour (no model cost)

Begin with the **dry-run playthrough**, which spends no model quota:

```powershell
npm run flow:tour -- --present --auto
```

`--present --auto` runs the Platform Tour one Node at a time as a narrated, CI-safe playthrough: it creates real files and draws a Mermaid graph of itself **without calling a model**. On the agent-note beats it writes a clearly-labelled dry-run sample note (the note reports `dry-run/sample`) instead of spending quota. Drop `--auto` to step through manually — press **Enter** to run each Node, `a` to auto-run the rest, `q` to quit, `o` to open the SVG at the end.

What the Tour does, beat by beat (each beat is a real Node that leaves real files behind):

- **intro** — a tiny code Node writes `toy-welcome.md`.
- **demo-code-node / agent-thinking** — the generic `core.timer` Node: plain, model-free code is a first-class Flow citizen.
- **explain-code-node** — what an agent-written note looks like inside a Flow (a dry-run sample here; a real agent note in step 6).
- **context-handoff-demo** — a **nested sub-flow**: one Node mints `handoff-packet.json`, a downstream Node opens it into a readable note. Context moves forward through files, not memory.
- **draft-tour-graph / render-tour-graph** — the Flow draws a Mermaid graph of *itself* and renders it to SVG.
- **summarize** — an index of everything the run produced.

Artifacts land under `.artifacts/platform-tour/<session>/...`, and the run prints the accepted `summaryPath` and `svgPath`.

## 6. Run a real Flow — live, with your harness

When you're ready to exercise the agent-backed Nodes against your configured harness:

```powershell
npm run flow:tour
```

Optional flags:

```powershell
npm run flow:tour -- --operator "Alex"     # personalized intro
npm run flow:tour -- --session demo --quiet
npm run flow:tour -- --present --live     # step through one Node at a time, calling a real agent each step
npm run flow:tour -- --json               # runtime progress events as JSON lines
```

Run `npm run flow:tour -- --help` for the authoritative flag list — the examples above are the ones you'll reach for first; the CLI is the source of truth if flags change.

This is the same worked example as step 5, now running the agent-backed Nodes for real (the default autonomous run uses your configured harness; `--present --live` keeps the step-by-step TUI but opts into the real agent on the agent-note beats). Generated artifacts still land under `.artifacts/platform-tour/`.

## 7. Read the worked example as code

The Tour isn't a slide deck — it's the reference Flow. Its source lives at `src/core/built-ins/platform-tour/`:

- `nodes/` — small focused Node files (one per beat above), each doing one thing.
- A **nested sub-flow** (`context-handoff-demo`) showing how context is handed forward through files.
- A Mermaid renderer injected via `createPlatformTourNodeRegistry({ renderMermaidSvg })`, so tests run without the real CLI.

Read `src/core/built-ins/platform-tour/README.md` for the file map and invariants. This is the shape to copy when you build your own.

## 8. Build your own Flow

**Scaffold a starter Flow** — `flow:init` writes a runnable, two-Node chained starter Flow (write a data file, then read it back) into `flow-library/<name>/`:

```powershell
npm run flow:init -- my-first-flow
```

**Run it through the Flow Supervisor (recommended).** The Supervisor wraps the run with a workspace-safety guard and writes a reliability report (health, metrics, fragility signals, and remedy recommendations). Your scaffolded Flow is discovered automatically:

```powershell
npm run flow:supervisor -- list                       # discover runnable Flows
npm run flow:supervisor -- run my-first-flow:starter  # guarded run + reliability report
```

The run prints a `summary.md` path — open it for the health report. `npm run flow:supervisor` with no arguments opens an interactive picker.

**Raw / advanced runs.** For a lower-level run *without* supervision (no workspace guard, no report), call the Generic Flow Runner directly — this is the same command the scaffold prints:

```powershell
npm run flow:runner -- run-flow my-first-flow:starter demo --cwd flow-library/my-first-flow
```

This **raw runner surface** is experimental and may require refactoring as the framework evolves; the scaffold + Supervisor path above is the recommended one.

## Troubleshooting

- **`BAGELWERK_AGENT_ARTIFACTS_ROOT is required / not accessible`** — it's unset or not writable. Point it at a writable path in `.env` (the run creates it if missing); an absolute path avoids any cwd ambiguity.
- **Run stops at the harness check** — the selected runtime's CLI isn't on PATH; install it or set its `*_PATH` in `.env` (see step 3). Open the `harness-status` artifact for the exact guidance.
- **Agent step errors on auth / hangs** — confirm your chosen harness is installed and signed in (see step 3).
- **Mermaid SVG step fails** — install the Mermaid CLI (`mmdc`); `npm run mermaid:render` uses the same binary.

---

See **[README.md](./README.md)** for the broader project overview and **[docs/README.md](./docs/README.md)** for architecture and onboarding.
