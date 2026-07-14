---
id: fragility.skill.required-artifact-missing-hard-crash
title: Missing required artifact turns a recoverable miss into a hard crash
tier: mechanical
---

# Anti-pattern: missing required artifact causes hard crash

## Symptom

- A skill-backed Node session finishes.
- One or more required output artifacts are absent.
- Consumer code blindly reads the expected file path or payload.
- The Node crashes instead of classifying the state as missing / degraded / repairable.

## Why it hurts

- Converts a contract miss into a runtime exception.
- Prevents repair loop loops or repair paths from using degraded posture.
- Hides whether the skill returned salvageable raw text or other diagnostics.

## Review questions

- Does the Node explicitly classify missing required artifacts before dereferencing paths?
- Is there a degraded posture for empty output plans or absent produced files?
- Are observation artifacts preserved so the next loop attempt can respond intelligently?

## Related runtime notes

Observed in live `behavior-extraction-ralph` attempts where the interpretation skill returned no required report artifact and downstream code initially treated that as a thrown failure.
