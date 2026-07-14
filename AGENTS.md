# Agent / contributor notes

## Current OS / terminal context

- Read `.current-os` at repo root before running commands.
- Treat `.current-os` as the source of truth for active environment (for example: `windows - powershell`, `wsl - bash`).
- Match command style, path format, and env-var syntax to what `.current-os` says.
- **Process Safety**: Avoid running process termination commands targeting `agy` or `agy.exe` without explicitly excluding the current agent's process ID (e.g., `$PID` in PowerShell) to prevent accidental self-termination.


## Repo focus

- **Preferred orchestration model** is **Flow → Node** in the workspace under `src/core/`. Vocabulary and dependency rules: repo-root **`CONTEXT.md`** and **`UBIQUITOUS_LANGUAGE.md`** (read before arguing about names or folder layout).
- Retired pre-Flow/Node surfaces named in `UBIQUITOUS_LANGUAGE.md` are not active ownership islands. Do not restore deleted historical runtime trees or introduce new non-Flow/Node ownership islands.

## Runtime structure expectations

- **`src/core/flows/`** — Flow config, compilation, resolved graph, and Flow execution seams.
- **`src/core/nodes/`** — configured Nodes, node graph execution, registries, and Node execution seams.
- **`src/core/flow-workbench/`** — developer-mode runner over canonical Flow/Node services.
- **`src/core/experiments/`** — retained proving-ground packages only; they are not active build/test authority until explicitly wired back in.

When adding new orchestration surfaces, prefer **explicit Flow + Node contracts** over informal sequencing and retired pre-Flow/Node terminology.

## Documentation expectations

- Keep docs and tests colocated with the code they describe.
- Large or depended-on modules should have local README or design notes explaining purpose, file map, invariants, and test entrypoints.
- **New Flow/Node-oriented work:** document packages under `src/core/` with local READMEs; follow patterns described in **`CONTEXT.md`**.
- Update the relevant tracked docs in the same change when behavior or structure changes.
- Use `docs/` for orientation guides; use `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`, and local READMEs as active source-of-truth docs.
- Use `changelog/` for user-visible change notes and release history; do not recreate root `CHANGELOG.md`.

## In-code signals for agents (`[@agents-focus]`)

### In plain terms

It is a **bookmark in source**: one line in a normal line comment that says “this spot is easy to misunderstand—read here before you edit.” Humans use it so the next person (or agent) does not “tidy” away something subtle. It is **not** for random TODOs; it is for **intent and invariants** tied to real code.

### What to write (authors)

- Put **`[@agents-focus]`** inside a line comment in that file’s language (`//`, `#`, `<!-- -->`, …).
- On the **same line**, add a **short** reason: why this code matters, or what must not break.
- Optionally add **`see: relative/path/from/repo/root.ts`** (several paths separated by **`;`**) so readers open the right files.
- Optional **line pin** on any `see:` path: **`path/to/file.ts#L10-L42`** (inclusive) or **`path/to/file.ts#L10`** so readers jump to an exact span. Refresh `#L` ranges when you edit those lines.

### What to do (agents / contributors)

- If your task touches code near an **`[@agents-focus]`** comment, read that surrounding area and any **`see:`** paths **before** proposing edits. If a `see:` URL includes **`#L`**, read that span first. Prefer **preserving the documented intent** over drive-by cleanup.

**Discovery:** `rg '\[@agents-focus\]'` lists all anchors.

## `.agents/` workspace (gitignored, transient)

- **`.agents/`** is **gitignored** scratch: planning notes, handoffs, local ADR-style decision notes, anything that helps **continuity between agent sessions**. Treat it as **transient**—operators may **delete or prune** when done; it is **not** permanent product documentation (that belongs in tracked paths: `docs/`, `CONTEXT.md`, `UBIQUITOUS_LANGUAGE.md`, module READMEs, etc.).
- **`.agents/adr/`** is for local agent-facing decision notes when useful. Promote durable architectural rules into tracked docs instead of relying on ignored agent scratch.
- **`.agents/planning/`** is for active shared planning only—not a home for framework assets that belong in the real tree.

## Tracked agent work

- **Open items** (durable work records) live at `.agents/open-items/items/OI-####.md`; mutate via the rules in `.pi/skills/open-items/SKILL.md` (bulk reads: `npm run open-items -- list`).
- **Execution todos** live at `.agents/open-items/items/OI-####.todo.json` and are **mutated only via `npm run todos -- <verb>`** — see `.pi/skills/todo-contract/SKILL.md` for the verb table. Hand-editing `*.todo.json` is a contract violation; if a needed verb is missing, escalate to the operator and extend the CLI rather than bypass it.

## Local build/test guidance

- Prefer running Node/npm in the WSL-backed environment when path/tooling mismatches appear on Windows-integrated terminals.
- **Flow execution gating:** When actively collaborating on Flow/Node implementation, do **not** run Flow CLIs or dogfood commands that execute real flows unless the operator expressly asks for that run. Flow runs can be time-consuming and may consume model/provider quota. Deterministic unit tests and `npm run build` are okay unless the operator says otherwise; live/model-backed suites remain opt-in.
- Primary validation commands are expected to stay centered on:
  - `npm run build`
  - `npm run test`
  - `npm run dogfood`
- Where the repo uses the filename split: **`*.test.ts`** — default suites, **must not** require live models (mocks/fixtures/fakes); **`*.model.test.ts`** — opt-in real-provider suites (keys/env documented beside those tests). Exact npm script names live in root **`package.json`** and may evolve.

## Artifacts

- Generated runtime artifacts belong under repo-root `.artifacts/`.
- Do not commit generated contents from `.artifacts/`.
