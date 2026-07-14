# Execution policy behavior

Owns run-level execution policy overlay discovery.

## Includes

- Reading execution policy overlays from explicit run params.
- Reading execution policy overlays from `input.executionPolicy` when no explicit param is provided.

## Invariants

- Explicit params win over input-embedded policy.
- This behavior does not reshape `userInput`; Nodes should read effective policy from `input.runtime.launchSnapshot.executionPolicy`.
- Workbench/legacy input compatibility belongs in future middleware/adapters, not this core policy behavior.
