---
id: fragility.contract.unparseable-counted-as-empty
title: Unparseable semantic content is treated as empty
tier: mechanical
---

# Anti-pattern: unparseable semantic content is treated as empty

## Symptom

- The artifact exists.
- The relevant section heading or payload slot exists.
- A human reader can see semantically useful content.
- The downstream parser cannot convert that content into its canonical internal shape.
- The contract checker collapses that condition into `*_empty` rather than distinguishing **present but unparseable** from **actually absent**.

## Why it hurts

- Hides the real defect class: publication-shape incompatibility is reported as missing meaning.
- Causes whole-loop retries even when the upstream reasoning was already sufficient.
- Produces misleading operator signals such as prolonged repair-loop churn that looks like domain uncertainty.
- Makes debugging harder because the emitted reason (`capabilities_empty`, similar) is less precise than the actual state.

## Typical smell

- Parser returns `[]` or `undefined` for a non-empty section because it only accepts one narrow labeled grammar.
- Contract quality classification then emits `*_empty`.
- Loop policy treats that as a reason to re-run the full upstream attempt chain.

## Better substitute

Use **`pattern.contract.recovery-aware-canonical-handoff`** instead:

- classify `missing` separately from `present_but_unparseable`
- normalize / reconstruct from stronger upstream artifacts before retry
- retry only when semantic content is truly unavailable

## Review questions

- Does the checker expose a more precise state than `*_empty` when raw text is populated but unparsable?
- Is there an owned-section normalization or reconstruction path before the loop retries?
- Is parser success acting as the sole proof that semantic content exists?
- Would operators be able to tell from diagnostics that the artifact was non-empty but structurally incompatible?

## Related runtime notes

Observed in `required-capabilities-ralph` where `## Capability findings` contained useful content but the downstream parser produced zero capability entries, surfacing as `capabilities_empty` and triggering repeated repair loop attempts.
