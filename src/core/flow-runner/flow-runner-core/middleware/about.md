# Flow Runner middleware

Owns lightweight lifecycle hooks around Flow and Node execution.

## Includes

- Middleware contracts for Flow start/complete, Node enter/exit/crash, and inter-node transition time.
- Ordered hook execution helper.
- Console progress middleware for CLI/user-visible progress projection.

## Invariants

- Middleware extends runner behavior; it should not replace graph semantics.
- The Flow graph remains authoritative for transitions.
- Core middleware is simple ordered hooks for now; onion/`next()` semantics can be added later if a use case requires it.
