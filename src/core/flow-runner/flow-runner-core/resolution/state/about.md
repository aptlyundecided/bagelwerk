# Resolution state

Owns the temporary data structures used while building a resolved Flow graph.

## Includes

- `FlowBoundary` — mutable working record for one Flow boundary while resolving nested graphs.
- `RawFlowEdge` — an edge before node/flow refs are expanded to concrete Node paths.
- `ResolveState` — scratch maps/lists accumulated by the resolution pipeline.

## Invariants

- These types are implementation details of graph resolution, not public Flow Runner API.
- Public graph output remains `ResolvedFlowGraph` from the Flow config contracts.
