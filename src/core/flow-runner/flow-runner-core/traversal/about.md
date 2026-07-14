# Traversal behavior

Owns graph transition helpers and run-tree projection.

## Includes

- Turning a node run result into a persisted run-tree node record.
- Resolving the next qualified Node path from graph edges and terminal status.

## Invariants

- Graph transitions are authoritative.
- Multiple matching transitions for the same status are an error, not an arbitrary choice.
