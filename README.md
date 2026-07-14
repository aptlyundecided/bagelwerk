# Reuben Goldberg Bagelwerk

> **Agent Workflow Engine**

Bagelwerk lets you build highly capable AI agents by composing linked agent skills that enable prompt chaining, routing, parallelization, reflection, tool use, planning, multi-agent collaboration, memory management, and other agent orchestration capabilities.

Its simple **Flows** and **Nodes** orchestration handles the hard parts—like state management and intelligent context trimming so you can focus on creating powerful developer tools.

---

## 📖 Core Concepts

- **Flow**: The composition and runtime context. A Flow groups together operations and defines the shape of the workflow.
- **Node**: The executable unit and contract boundary. Nodes do the actual work and produce accepted results.
- **Flow Runner**: The canonical, headless execution service for real Flow runs.
- **Flow Workbench**: The developer-mode runner for visually inspecting and debugging Node results.

*(For a deeper dive into our architecture and terminology, see [CONTEXT.md](./CONTEXT.md) and [UBIQUITOUS_LANGUAGE.md](./UBIQUITOUS_LANGUAGE.md)).*

## 🚀 Quick Start

New here, or sharing with a colleague? Start with **[GETTING-STARTED.md](./GETTING-STARTED.md)** — run the Platform Tour and build your first Flow from a fresh clone.

Get up and running quickly:

```powershell
npm install
npm run build
npm run test
```

## 🛠️ Usage & Validation

### Dry Runs & Exploring
To get a feel for the tooling without triggering live agent workflows or consuming model quota, start with these local commands:

```powershell
# See available runner options
npm run flow:runner -- --help

# Explore the Platform Tour built-in
npm run flow:tour -- --help
npm run flow:tour -- --present --auto
```

### Running Real Workflows
When you are ready for a live run (e.g., a real Flow run through the Flow Supervisor that inspects workspace state and invokes configured agent providers), use:

```powershell
npm run flow:tour                          # live tour run (real agent-backed Nodes via your configured harness)
npm run flow:tour -- --present --live       # same tour, stepped one Node at a time, with a real agent per step
```
> **Note**: Live runs are opt-in. Please confirm your credentials, provider/model defaults, and target Flow before running. The narrated `npm run flow:tour -- --present --auto` playthrough is model-free (a dry-run); add `--live` to either `--present` form to spend model quota on the agent-note beats.

> **Unsupported provider — Agy**: We do **not** support the **Agy** agent provider. Its terminal execution is too unreliable for dependable Flow/Node runs. Use a supported provider instead.

### External Flow Libraries *(Experimental)*
Scaffold your own Flow, then run it through the **Flow Supervisor** — the recommended runner, which guards the target workspace and writes a reliability report (health, metrics, fragility signals, remedy recommendations):

```powershell
npm run flow:init -- my-first-flow                    # scaffold a runnable starter Flow
npm run flow:supervisor -- list                       # discover runnable Flows
npm run flow:supervisor -- run my-first-flow:starter  # guarded run + report
```

For a lower-level run *without* supervision, use the Generic Flow Runner directly (`npm run flow:runner -- --help`). This surface is not fully tested or formally supported yet; Flows built this way may require refactoring as the framework evolves.

### Validation Commands
Preferred commands for repo-level validation before committing:

```powershell
npm run build
npm run test
npm run test:active
```

## 📂 Repository Structure

### Active Surface (`src/core/`)
- `flows/` — Flow config, compilation, resolved graph, execution seams
- `nodes/` — Configured Nodes, node graph execution, registries, execution seams
- `flow-runner/` — Canonical headless Flow execution surface
- `flow-supervisor/` — Reliability wrapper over one Flow Runner run: workspace guard, health/metrics, fragility signals, remedy report **(recommended way to run a Flow)**
- `flow-workbench/` — Developer-mode tooling over canonical services **(experimental)**
- `built-ins/` — Active built-ins surface (currently features the Platform Tour)

### Other Key Areas
- `src/tools/` — Repo tools and CLIs
- `docs/` — Orientation guides for future developers and agents
- `changelog/` — User-visible change notes and release history
- `.agents/adr/` — Local agent-facing decision notes for now
- `src/core/experiments/` — Parking area for future proving packages (not active build/test authority)
- `.agents/` — Durable feature plans and tracked open items (transient coordination)
- `flow-library/` — Gitignored local dogfood workspace for non-built-in Flow libraries

## 📦 Artifacts
Flow Smithy runs produce artifacts: durable runtime files such as Node inputs and outputs, accepted results, run trees, logs, diagnostics, launch snapshots, and other state needed to inspect, resume, replay, compare, or hand downstream Nodes the exact outputs they depend on.

Artifacts are not optional scratch files. Their location is part of the Flow runtime contract: downstream Nodes read upstream results from artifact paths, runner and Workbench tools inspect them, and failed runs are debugged or resumed from them. If the artifact root moves or is deleted unexpectedly, Flows can lose their handoff state.

By default, generated runtime state belongs under the repo-local `.artifacts/` directory. Platform Tour run artifacts default to `.artifacts/platform-tour/`. External Flow Runner workspaces write to `.artifacts/flows/external/`.

> **Warning**: Do not commit generated artifact contents. Treat `.artifacts/` as local runtime state unless a specific artifact has been intentionally promoted into tracked documentation or fixtures.

## 📚 Where to Read Next

- **[CONTEXT.md](./CONTEXT.md)** — Architectural rules and purpose
- **[UBIQUITOUS_LANGUAGE.md](./UBIQUITOUS_LANGUAGE.md)** — Glossary of canonical terms
- **[AGENTS.md](./AGENTS.md)** — Rules for AI agents and contributors working in this repo
- **[docs/README.md](./docs/README.md)** — Documentation map and onboarding path
- **[src/core/flow-runner/README.md](./src/core/flow-runner/README.md)**
- **[src/core/flow-supervisor/README.md](./src/core/flow-supervisor/README.md)** — the recommended runner; workspace guard + reliability report
- **[src/core/built-ins/README.md](./src/core/built-ins/README.md)**

## License

Bagelwerk is licensed under the [Mozilla Public License, v. 2.0](./LICENSE).

---
*Note: We prefer **Flow / Node** terminology over retired pre-Flow/Node terms. Please keep documentation close to the code it describes and update it alongside behavior changes. Preserve accepted Node result contracts when changing downstream dependencies.*
