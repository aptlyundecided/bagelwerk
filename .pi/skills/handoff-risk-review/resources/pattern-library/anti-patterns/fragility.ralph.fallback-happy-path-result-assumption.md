---
id: fragility.ralph.fallback-happy-path-result-assumption
title: Fallback posture exists, but result assembly still assumes happy-path payloads
tier: mechanical
---

# Anti-pattern: fallback path still requires happy-path payload completeness

## Symptom

- A repair loop loop supports watchdog exhaustion, best-judgment, or degraded completion.
- One or more internal attempt payloads are missing.
- Final summarization or published-result shaping still assumes those payloads exist.
- The late-stage assembler crashes or misclassifies the whole run.

## Why it hurts

- Nullifies the value of having a fallback posture at all.
- Moves failure from the real handoff defect into result-assembly code.
- Produces confusing run histories where the loop appears to have handled the issue, but final publication still dies.

## Review questions

- After fallback, can summary builders tolerate missing node payloads?
- Does the final result distinguish degraded evidence from missing evidence?
- Are best-judgment paths tested separately from satisfied happy-path exits?

## Related runtime notes

Observed in a historical prototype when missing Node payloads initially caused late crashes during attempt-summary mapping and final run-result assembly.
