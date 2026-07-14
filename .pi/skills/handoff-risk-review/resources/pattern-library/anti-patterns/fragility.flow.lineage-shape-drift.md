---
id: fragility.flow.lineage-shape-drift
title: Equivalent lineage seeds appear in different surface sections
tier: mechanical
---

# Anti-pattern: lineage shape drift across equivalent seed surfaces

## Symptom

- A fork / resume source run is semantically complete.
- The needed upstream seed data exists.
- The same semantics appear under a different lineage section or presentation shape than the hydrator expects.
- Recovery fails because the reader keys on one exact lineage layout.

## Why it hurts

- Resume logic rejects valid source runs for presentation-shape reasons.
- Fork-from-fork scenarios break even though the durable runtime history is present.
- Operators see missing-upstream or missing-row failures that hide the real issue: lineage interpretation rigidity.

## Review questions

- Does recovery rely on one exact lineage section such as `Execution order`?
- Are semantically equivalent lineage surfaces (`Child runtime surfaces`, similar) also considered?
- Is the lineage reader validating meaning, or just matching one rendering shape?

## Related runtime notes

Observed during `make-different` fork hydration when seeded upstream nodes were present under `## Child runtime surfaces` rather than only `## Execution order`.
