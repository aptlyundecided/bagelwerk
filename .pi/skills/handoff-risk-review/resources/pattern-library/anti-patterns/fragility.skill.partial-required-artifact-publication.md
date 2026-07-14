---
id: fragility.skill.partial-required-artifact-publication
title: Skill publishes only part of a required artifact bundle
category: anti-pattern
tier: mechanical
---

# Anti-pattern: skill publishes only part of a required artifact bundle

## Symptom

- A skill-backed invocation finishes without a transport crash.
- Some required artifacts are present.
- At least one other required artifact is missing.
- Model prose may even claim that all artifacts were written.
- Downstream wrapper code treats the bundle as wholly missing or crashes while copying/reading the absent artifact.

## Why it hurts

- Creates a misleading near-success state that consumes tokens but still breaks the handoff.
- Hides whether the failure was narrow contract under-publication versus total skill failure.
- Can trigger generic graph or contract-publication errors that mask the original missing artifact.
- Is especially likely on weaker local models that satisfy the main report outputs but skip ancillary required files.

## Typical smell

- two of three required artifacts exist, but one is absent
- `qualityReasons` contain `required_output_missing:<artifact-id>`
- raw text includes claims like "I created all required artifacts"
- parent Node remains `running` / `unknown` or throws before publishing a bounded fail/degraded contract

## Better substitute

Treat partial publication as a first-class contract state:

- preserve exactly which required artifacts were published and which were missing
- avoid collapsing partial publication into total transport failure
- use a bounded retry / repair loop posture when the contract is generation-shaped and another attempt is plausibly corrective
- if retries exhaust, publish an explicit degraded/fail contract that preserves the original missing-artifact cause

## Review questions

- Does the wrapper distinguish partial publication from total output absence?
- Are missing artifact ids surfaced directly in the published failure/degraded posture?
- Does the surrounding graph retry only the affected generation Node rather than masking the failure later?
- If provider prose claims completion, can the runtime still prove which files actually existed on disk?

## Related runtime notes

Observed in `requested-change-refinement.follow-up-questions` where the skill produced `follow-up-question-packet.md` and `follow-up-question-packet.json` but omitted `question-selection-notes.md`, leading to a later generic publication failure instead of a localized bounded contract miss.
