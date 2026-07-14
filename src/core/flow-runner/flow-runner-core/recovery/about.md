# Recovery behavior

Owns graph-first unhandled failure fallback integration.

## Includes

- Detecting when graph transitions do not handle a terminal failure.
- Invoking an optional unhandled failure resolver.
- Applying replacement results and repaired artifacts when recovery succeeds.

## Invariants

- Explicit graph failure/timed_out transitions always win.
- Fallback is like an unhandled-exception hook, not normal routing.
