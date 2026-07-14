# Path reference resolution

Owns small utilities for turning Flow-local references into qualified graph paths.

## Includes

- Joining path parts into `a.b.c` qualified paths.
- Prefix checks for nested Flow ownership.
- Local ref qualification against a `FlowBoundary`.
- Ref-kind detection: Node path versus child Flow boundary path.

## Invariants

- Local refs are resolved relative to their owning Flow boundary.
- Dotted refs are treated as already qualified.
- Missing refs fail during resolution, not at runtime.
