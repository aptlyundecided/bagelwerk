# Flow boundary resolution

Owns initial-node and exit-node calculation for each Flow boundary.

## Includes

- Resolving a ref used as an edge target: Flow refs become the child Flow initial Node.
- Resolving a ref used as an edge source: Flow refs become all child Flow exit Nodes.
- Computing `nodePaths`, `initialNodePath`, and `exitNodePaths` for each boundary.

## Invariants

- Child boundaries are computed before parent boundaries.
- A Flow exit is any Node inside that Flow boundary without an outgoing edge to another Node inside that same boundary.
