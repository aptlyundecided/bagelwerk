# Flow flattening

Owns recursive collection of nested Flow definitions into resolution state.

## Includes

- Creating `FlowBoundary` records.
- Registering configured Nodes by qualified path.
- Recording child Flow paths.
- Capturing raw edges with their owning Flow path.
- Carrying inherited Flow execution policy into child Flows and Nodes.

## Invariants

- Flattening gathers facts; edge expansion and exit calculation happen later.
- Node ids are resolved through the provided `FlowNodeLibrary`.
