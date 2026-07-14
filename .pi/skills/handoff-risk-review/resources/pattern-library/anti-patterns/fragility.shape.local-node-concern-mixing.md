---
id: fragility.shape.local-node-concern-mixing
title: Workflow-local Node or binding mixes too many concerns for the handoff contract to stay reviewable
tier: semantic
---

# Anti-pattern: local Node concern mixing

## Symptom

- One workflow-local module handles operator interaction, artifact staging, prompt shaping, result parsing, quality grading, and handoff assembly all together.
- The true writer/reader agreement is buried inside a larger local control blob.
- Reviewers can no longer tell which parts are contractual versus incidental implementation.

## Why it hurts

- Obscures the intended thinness of the workflow-facing binding surface.
- Makes contract drift harder to spot because behavior and contract are entangled.
- Increases repair-loop churn when one concern changes and silently perturbs another.

## Review questions

- Can the handoff contract be understood without reading unrelated local orchestration?
- Which concerns are truly workflow-specific, and which should be split or shared?
- Would separating interaction, binding, and payload-shaping make downstream expectations easier to review?

## Related runtime notes

Use when the problem is not mere file length, but loss of clear contract boundaries.
