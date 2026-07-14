# Result behavior

Owns small NodeResult validation and synthetic result helpers.

## Includes

- Runtime validation that Node implementations returned a valid terminal result.
- Synthetic failed run results for deterministic preflight failure paths.

## Invariants

- NodeResult statuses are limited to graph-terminal statuses accepted by the runner.
- Validation helpers should remain dependency-light and deterministic.
