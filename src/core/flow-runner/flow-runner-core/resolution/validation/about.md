# Resolved graph validation and assembly

Owns final checks and public graph assembly after resolution behaviors have populated state.

## Includes

- Verifying every resolved edge source and target exists.
- Attaching outgoing edges to resolved Node records.
- Requiring a valid root initial Node.
- Converting mutable `FlowBoundary` records into public `ResolvedFlowBoundary` records.
- Building the final `ResolvedFlowGraph`.

## Invariants

- Invalid graph references fail before execution.
- Public output is immutable-by-convention data derived from resolution state.
