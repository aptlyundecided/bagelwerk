# Flow catalog

Discovery and operator-facing metadata for external Flow workspaces.

## Purpose

The Flow catalog is the shared foundation for pleasant external Flow runs. It lets tools discover runnable Flows, resolve human aliases, ask Flow-specific run questions, and hand the selected Flow to Flow Runner or Flow Supervisor without requiring operators to memorize `--cwd`, qualified ids, or input JSON shapes.

## Intended UX

```powershell
npm run flow:supervisor
npm run flow:supervisor -- list
npm run flow:supervisor -- run recipes
```

No-arg Supervisor mode should open an interactive picker, then prompt for metadata-declared inputs before running the selected Flow.

## Boundary

- The catalog discovers and describes runnable Flows.
- Flow Runner still loads/resolves/executes external Flow bindings.
- Flow Supervisor uses catalog metadata to choose friendly defaults and collect inputs.
- Flow metadata does not move contracts away from Nodes.

## V1 sources

- Explicit `cwd` containing a `flow.config.json`.
- Local dogfood workspaces under repo-root `flow-library/*/flow.config.json`.

Future sources can include `bagelwerk.config.*`, package-installed Flow libraries, or built-ins, but should reuse the same catalog entry shape.

## Metadata

`flow.config.json` entries may optionally declare:

- `aliases` — human-friendly names such as `recipes`.
- `requirements` — runtime/network/state expectations.
- `prompts` — input prompts for interactive runs.
- `supervisor` — default run-mode/session/workspace hints.
- `profiles` — named presets with input defaults and optional execution plans.

These fields are optional so existing v1 configs remain valid.

## Run modes

Initial Supervisor-friendly modes:

- `advanced` — explicit `run-flow` command with caller-provided `cwd`, session, and target worktree.
- `local` — run directly from a discovered local Flow workspace; useful for gitignored `flow-library/` dogfood Flows.
- future `managed-worktree` / `sandbox` — prepare isolated execution workspaces automatically.

## Invariants

- Alias resolution must fail clearly on ambiguity.
- Discovery should collect diagnostics rather than hide malformed sources.
- Interactive prompts must have non-interactive seams for tests.
- Catalog metadata is descriptive/defaulting policy, not a second runtime.
