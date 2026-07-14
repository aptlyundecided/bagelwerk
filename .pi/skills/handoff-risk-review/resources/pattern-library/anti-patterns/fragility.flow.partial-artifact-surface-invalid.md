---
id: fragility.flow.partial-artifact-surface-invalid
title: Degraded result publishes a partial artifact surface that violates Flow invariants
tier: mechanical
---

# Anti-pattern: degraded publication leaks invalid artifact-surface entries

## Symptom

- A Flow or Node run completes under fallback or degraded posture.
- Its primary output is usable.
- The published ranked artifact surface still includes empty or placeholder paths for optional or missing artifacts.
- The parent flow rejects the whole runtime unit because the artifact surface itself is invalid.

## Why it hurts

- The Flow or Node run appears successful locally but fails at the Flow boundary.
- Degraded completion cannot travel upward safely.
- Operators see late orchestration failure caused by publication hygiene, not by missing meaning.

## Review questions

- Are published artifact entries filtered to only valid, usable paths?
- Does degraded publication preserve flow-boundary invariants?
- Are optional artifacts omitted cleanly rather than emitted as empty placeholders?

## Related runtime notes

Observed when `behavior-extraction-ralph` completed in degraded posture but `make-different` published an empty-path critique artifact entry that `FlowRunner` rejected.
