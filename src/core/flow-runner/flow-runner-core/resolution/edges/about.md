# Edge expansion

Owns conversion from Flow-authored edges to concrete Node-to-Node graph edges.

## Includes

- Expanding child Flow targets to their initial Node.
- Expanding child Flow sources to their exit Nodes.
- Preserving edge status/label metadata while adding qualified source/target paths.

## Invariants

- The resolved graph contains concrete Node edges only.
- Flow-boundary refs are conveniences in authoring, not runtime graph nodes.
