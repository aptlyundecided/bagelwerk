---
id: fragility.parse.fenced-json
title: JSON artifact contains fenced Markdown wrapper
tier: mechanical
---

# Anti-pattern: fenced JSON inside a nominally-JSON artifact

## Symptom

- The correct **named artifact** exists and content is **semantically** valid JSON.
- The file or response block wraps the object in **fenced Markdown code blocks** (labeled json) or prose such that a consumer expecting **naked JSON bytes** fails **deterministic parse**.

## Why it hurts

- Boundary looks healthy at **artifact gating** (file present, right name).
- Downstream **deterministic conversion** fails; repair or validation Nodes may abort despite “good” semantics.

## Review questions

- Does the boundary require **exactly one** parseable JSON value?
- Does the **prompt / skill** say naked JSON explicitly?
- Can the consumer **recover** fenced content without poisoning the published handoff?

## Related runtime notes

See **OI-0029** recent fragility note (requested-change refinement / feature-discovery repair loop sufficiency judgments).
