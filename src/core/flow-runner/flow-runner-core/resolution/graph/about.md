# Graph resolution orchestration

Owns the high-level pipeline that turns raw Flow config plus a Node library into a `ResolvedFlowGraph`.

## Pipeline

1. Parse the configured Flow.
2. Flatten nested Flows and Nodes into resolution state.
3. Compute Flow boundary initial and exit Nodes.
4. Expand Flow-authored edges into concrete Node-to-Node edges.
5. Apply execution-policy overlays.
6. Validate/attach edges and assemble the public resolved graph.

## Invariants

- This file should remain orchestration only; sub-behavior mechanics live in sibling directories.
- Resolution does not execute Nodes, create records, or touch artifacts.
