# Event behavior

Owns event fan-out inside the core runner.

## Includes

- Appending typed events to in-memory run event lists.
- Forwarding events to `onEvent` sinks.
- Projecting events to optional log lines.
- Carrying generic Node-internal progress via `node-progress` events (`queue`, `count`, or `message`) so views do not need built-in-specific progress bridges.

## Invariants

- Typed events are canonical; logs are projections.
- Event emission should not decide control flow.
