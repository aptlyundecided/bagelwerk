# Preflight behavior

Owns accepted-upstream-artifact dependency lookup before Node execution.

## Includes

- Resolving accepted artifact references from the resolved graph.
- Checking canonical accepted paths and source-node-id fallback paths.
- Producing dependency records for runtime context and launch snapshots.

## Invariants

- Preflight observes artifact availability; it does not run Nodes.
- Missing required artifacts become execution input for node-run behavior to fail deterministically.
