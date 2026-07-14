# CONTEXT

## Purpose

This repo is standardizing on a single living orchestration model:

- **Flow** = composition/grouping/runtime context
- **Node** = executable unit with the contract boundary
- **Flow Runner** = canonical Workbench-free execution service for real Flow runs
- **Flow Workbench** = developer-mode runner for inspecting and accepting Node results inside a Flow

Everything else should be judged against that direction.

## Active architecture

The living implementation surface is under `src/core/`.

### Primary active areas

- `src/core/flows/` — canonical Flow config, compilation, resolved graph, Flow execution seams
- `src/core/nodes/` — configured Nodes, `nodeType`, `nodeId`, node graph execution, registries, Node execution seams
- `src/core/flow-runner/` — canonical Workbench-free Flow execution surface
- `src/core/flow-workbench/` — developer-mode tooling over canonical Flow/Node seams
- `src/core/built-ins/` — intentionally small active built-in Flow package surface; currently `platform-tour` is the active built-in package

## Current architectural rules

1. **New orchestration work goes into the Flow / Node model.**
2. **Nodes own execution contracts.** Flows are structural and contextual.
3. **`nodeType` and `nodeId` are distinct.**
   - `nodeType` = reusable code-owned behavior
   - `nodeId` = configured instance identity in a Flow/library
4. **Flow Runner is the canonical Workbench-free execution surface.** It should run Configured/Resolved Flows through the canonical Node seam without depending on Flow Workbench.
5. **Flow Workbench is not a second runtime.** It is a developer-mode surface over canonical Flow/Node services and should consume or mirror Flow Runner behavior where practical.
6. **Accepted downstream precedent is Node-scoped.** Flow-level progress is derived from accepted Node results.
7. **Execution Policy is contextual.** Flows may provide inherited execution settings for descendant Nodes, but policy does not change Node ownership of contracts or artifacts.
8. **Environment variables are defaults/secrets, not structural policy.** Per-Flow/per-Node execution settings belong in Flow config or run overlays, not named `.env` variables.
9. **Preflight should fail fast** when required accepted upstream artifacts are missing.
10. **Legacy orchestration code should not regain active ownership.** Extract helpers if needed; do not restore deleted historical trees as live dependencies.
11. **Retired pre-Flow/Node substrates stay retired.** Do not add new ownership islands outside the Flow / Node model.

## Repository shape

### Living code

- `src/core/` — living framework/runtime surface and built-in Flow packages
- `src/tools/` — active repo tools and CLIs

### Experiments

- `src/core/experiments/` — parking area for future proving packages only. Keep packages here out of active build/test until they graduate into a normal runnable surface.

### Historical code

Legacy orchestration material is no longer tracked in an in-repo archive. Use git history when historical comparison is needed, and do not reintroduce historical trees as new ownership surfaces. Local-only copies may exist under gitignored `flow-library/archive/`, but those copies are scratch/reference material and are not product documentation or build authority.

## Artifacts

Generated artifacts belong under repo-root `.artifacts/`. Do not commit generated artifact contents.

## Tests and validation

Preferred active validation commands:

- `npm run build`
- `npm run test`
- `npm run test:active`

Active tests should validate living Flow / Node / Flow Workbench surfaces.

## Documentation expectations

- Keep docs close to the code they describe.
- Update docs when behavior or structure changes.
- Prefer small, explicit local READMEs over rebuilding one giant theory document.
- Use historical terms only when discussing historical material.

## Agent / contributor notes

- Read `.current-os` before running commands.
- Follow `AGENTS.md` instructions.
- Respect the open-items and todo contract:
  - open items live under `.agents/open-items/items/`
  - todo JSON sidecars are mutated only via `npm run todos -- ...`
- Use `.agents/` for transient planning and coordination, not as permanent product documentation.

## Short decision summary

- canonical grouping term: **Flow**
- canonical execution term: **Node**
- contracts live at the **Node** boundary
- Execution Policy customizes how Nodes run without changing contract ownership
- `.env` may provide global defaults/secrets, but per-Flow/per-Node policy belongs in Flow config or run overlays
- Flow Runner is the canonical Workbench-free execution surface
- Flow Workbench is a developer-mode runner, not a separate orchestration engine
- accepted results are recorded per Node and used as downstream precedent
- retired pre-Flow/Node substrates stay retired
