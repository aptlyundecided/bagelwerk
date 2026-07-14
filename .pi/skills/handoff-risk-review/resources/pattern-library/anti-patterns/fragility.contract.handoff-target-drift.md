---
id: fragility.contract.handoff-target-drift
title: Downstream critique or revision evaluates a different target than the upstream handoff actually names
tier: semantic
---

# Anti-pattern: handoff target drift

## Symptom

- The upstream working packet, request narrowing, or staged artifact names one concrete target.
- A downstream critique, judgment, revision, or contract-check artifact evaluates a different feature, report, or problem.
- The downstream prose may still sound coherent and specific, but it is anchored to the wrong subject.

## Why it hurts

- Creates convincing but invalid loop guidance because the reviewer is grading the wrong object.
- Wastes retries on semantic churn instead of surfacing the real boundary failure: target misalignment.
- Can let a Flow or Node run appear meaningfully active while every downstream judgment is detached from the actual request.

## Typical smell

- Critique vocabulary obviously belongs to a different feature than the current narrowed request.
- The downstream Node never explicitly restates the target artifact, request summary, or scope guard it is grading.
- A human can see the mismatch immediately, but the contract surface exposes only ordinary sufficiency or quality fields.

## Better substitute

Make target alignment a first-class part of the handoff contract:

- require the downstream surface to restate the target artifact and requested-change summary it is evaluating
- add explicit alignment checks or fields such as topic match / context mismatch when the family is loop-sensitive
- treat obvious subject drift as a distinct semantic failure, not ordinary insufficiency

## Review questions

- Does the downstream surface prove which artifact or narrowed request it is evaluating?
- Could the critique be internally coherent while still grading the wrong work item?
- If target drift happened, would the contract expose it explicitly, or would it look like ordinary semantic disagreement?

## Related runtime notes

Observed in a historical prototype where a sufficiency critique discussed one UI behavior while the active request and upstream packets described a different design task.
