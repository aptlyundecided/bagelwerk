---
id: fragility.flow.reference-only-artifact-assumption
title: Resume logic assumes local artifact ownership instead of durable references
tier: mechanical
---

# Anti-pattern: reference-only artifact assumption failure

## Symptom

- A forked or resumed run needs an upstream artifact.
- The source lineage or published handoff points at the needed artifact semantically.
- Recovery logic assumes the source run also owns a local Node-run artifact tree.
- Hydration fails when only durable references or seeded downstream surfaces remain.

## Why it hurts

- Breaks fork-from-fork and replay-style recovery.
- Couples resume to one storage topology instead of the published contract surface.
- Turns a durable reference problem into a false missing-artifact failure.

## Review questions

- Is recovery grounded in durable published surfaces or only local Node run directories?
- Can a forked source run satisfy the contract with lineage-backed references alone?
- Are ranked handoff manifests or published artifacts treated as authoritative fallbacks?

## Related runtime notes

Observed when `make-different` fork hydration tried to recover refinement artifacts from a local Node run directory that did not exist on a forked source run.
