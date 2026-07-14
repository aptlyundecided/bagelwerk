# API contracts behavior

Owns the typed boundary for callers and for Flow Runner core modules.

## Includes

- Public run parameter shapes for binding, resolved-graph, and single-Node execution.
- Policy option types for acceptance, resume, iteration, and unhandled failure recovery.
- Public result shapes returned by Flow Runner APIs.

## Invariants

- Contracts should describe real caller choices; callers should not need dummy fields.
- Stable task/runtime records stay in `../runRecords.ts` and `../runtimeContext.ts`; this behavior composes them into API shapes.
- Domain-specific built-in concepts (for example, `platform-tour`'s run-profile metadata) do not belong here.
