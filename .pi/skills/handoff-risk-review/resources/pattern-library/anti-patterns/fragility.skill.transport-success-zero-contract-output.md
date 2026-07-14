---
id: fragility.skill.transport-success-zero-contract-output
title: Skill transport reports completion but publishes zero contract output
tier: mechanical
---

# Anti-pattern: skill transport reports completion but publishes zero contract output

## Symptom

- A skill-backed invocation finishes without a thrown runtime error.
- Provider/usage metadata suggests a real model call happened.
- Required output artifacts are all missing.
- Raw text is empty or otherwise non-salvageable.
- Downstream wrapper code learns only that the contract outputs are absent, not why the transport surface produced nothing consumable.

## Why it hurts

- Creates a confusing pseudo-success state: the call looks completed, but no handoff bytes exist.
- Inflates apparent randomness in operator runs because the failure presents after token spend rather than as an early deterministic rejection.
- Often gets misdiagnosed as a downstream parser or graph issue instead of an upstream transport/publication miss.
- In retry loops, can trigger expensive retries without distinguishing transport-empty from semantic insufficiency.

## Typical smell

- `outputTransport` prefers response blocks or similar structured delivery.
- usage/cost fields are populated.
- `rawTextLength` is `0`.
- required output artifacts are reported missing.
- the outer Node crashes or hard-fails while trying to open the expected artifact paths.

## Better substitute

Treat this as a first-class mechanical failure state:

- classify **transport completed but contract-empty** distinctly from ordinary semantic failure
- preserve provider/usage/transport diagnostics beside the missing-artifact report
- prefer degraded / retry-aware posture where the surrounding loop can respond intentionally
- avoid masking the original empty-publication cause behind later graph-transition errors

## Review questions

- Does the Node differentiate transport-empty completion from normal missing-artifact drift?
- Are provider, usage, and output-transport diagnostics preserved where the operator will actually see them?
- Can the surrounding Flow or retry loop decide between retry, degraded posture, and hard fail based on this exact state?
- Will downstream errors preserve the original empty-publication cause, or mask it behind a generic edge/transition failure?

## Related runtime notes

Observed in a historical experiment where a skill-backed critique completed a live provider call with usage recorded, but produced zero raw text and none of the required response-block artifacts.
