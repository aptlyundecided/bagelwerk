# Accepted artifact reference resolution

Owns qualification and validation for Flow node `acceptedArtifacts` references.

## Includes

- Resolving local artifact source refs to qualified Node paths.
- Rejecting artifact refs that point at Flow boundaries.

## Invariants

- Accepted artifacts are Node-scoped, not Flow-scoped.
- A Flow-to-Flow artifact handoff should be modeled with an explicit transition/adapter Node.
