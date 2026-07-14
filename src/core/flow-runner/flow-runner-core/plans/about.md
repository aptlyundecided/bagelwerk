# Execution-plans behavior

Owns whole-Flow orchestration over resolved Flow graphs.

## Includes

- Whole-flow execution.
- Prefix execution.
- Lane execution with bounded concurrency and optional join.
- Iteration/cycle guards.
- Flow-level run records and run-tree persistence.

## Invariants

- Execution-plan names stay neutral: `whole-flow`, `prefix`, `lanes`.
- This behavior coordinates traversal and node-run behavior; domain-specific modes map in from adapters.
