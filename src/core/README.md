# `src/core` — Flow / Node orchestration workspace

This directory is the living orchestration surface for the repo.
Deleted legacy runtime material should be recovered from git history only when historical comparison is needed; it should not be treated as an active authority.

## Intent

- Standardize on **Flow / Node** vocabulary and contracts.
- Keep the framework core small: Flow config/compilation, Node config/registry/execution, and Flow Workbench tooling.
- Keep only active product/proving workflows in `built-ins/`; move bespoke/demo/private flows to external library surfaces or rely on git history.
- Prefer small, reviewable modules over monoliths.

## Rules of the road

1. **No new active wiring** into deleted historical runtime trees.
2. **Do not restore retired pre-Flow/Node execution substrates**; extract useful helpers into active Flow/Node-shaped packages instead.
3. If a helper from historical code is still useful, extract it into an active Flow/Node-shaped `src/core/` or `src/tools/` surface instead of restoring a live dependency.
4. **Tests** live next to code (`*.test.ts`) and active validation should target the living Flow / Node / Flow Workbench surfaces only.

## Where to start

- `nodes/README.md` — Node config/runtime surface (`nodeType`, `nodeId`, registry aliases, node graph execution).
- `flows/README.md` — Flow config/runtime surface (nested authoring, resolved graph compilation, configured-flow execution seams).
- `flow-workbench/README.md` — developer-mode runner over canonical Flow/Node services.
- `built-ins/README.md` — active built-in Flow package policy and removal record; the current built-in is the Platform Tour (`npm run flow:tour`).
