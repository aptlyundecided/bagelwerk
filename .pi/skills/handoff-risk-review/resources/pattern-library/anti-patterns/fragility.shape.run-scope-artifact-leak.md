---
id: fragility.shape.run-scope-artifact-leak
title: Supposedly local handoff artifacts are staged in a shared or weakly scoped location
tier: mechanical
---

# Anti-pattern: run-scope artifact leak

## Symptom

- A Node or binding stages handoff artifacts in a path that is shared across runs, attempts, or neighboring invocations.
- The code treats those artifacts as if they were private to one handoff.
- Later reads cannot rely on path identity alone to know which run produced the bytes.

## Why it hurts

- Creates collision risk between adjacent runs or retries.
- Makes debugging lineage and recovery harder because artifact ownership is ambiguous.
- Turns a clean handoff contract into an implicit global mutable surface.

## Review questions

- Are staged artifacts placed under a run- or observation-scoped directory?
- Could two invocations overwrite or reuse the same path while believing it is local state?
- Does downstream code rely on these paths as if they were durable evidence for one specific handoff?

## Related runtime notes

Use when path scoping itself is part of the fragility, even if the artifact contents are valid.
