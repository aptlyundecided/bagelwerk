# Node-run behavior

Owns execution of exactly one resolved Node through the Flow Runner runtime context.

## Includes

- Target Node resolution and parameter validation.
- Node run record creation and launch snapshot construction.
- Runtime input creation (`runtime`).
- Node invocation through the Node registry entry.
- Artifact observation/copying, auto-acceptance, events, and sidecar persistence.

## Invariants

- This behavior runs one Node; graph traversal belongs in plans/traversal.
- Nodes should use `input.runtime`; Workbench compatibility belongs in future middleware/adapters, not core input shape.
- Artifact/acceptance side effects should stay explicit and reviewable.
