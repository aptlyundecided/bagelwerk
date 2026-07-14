---
id: fragility.contract.machine-readable-bundle-under-specified
title: Machine-readable handoff exists, but the local contract bundle under-specifies the writer/reader agreement
tier: mechanical
---

# Anti-pattern: under-specified machine-readable contract bundle

## Symptom

- A skill writes a machine-readable artifact such as JSON or parser-sensitive Markdown.
- Downstream code depends on exact field names, payload shape, structural states, or recovery posture.
- The local bundle (`contracts.md`, `input.md`, `output.md`) names the artifact but does not fully document the canonical writer/reader agreement.

## Why it hurts

- Reviewers cannot see the real handoff contract without reading TypeScript.
- Sibling families drift because one bundle documents field rules and recovery posture while another leaves them implicit.
- Prompt, binding, parser, and recovery logic can diverge without an obvious doc-level diff.

## Review questions

- Does `output.md` define the exact machine-readable shape, field rules, and allowed values?
- Does `contracts.md` document structural states such as `missing`, `present_but_unparseable`, `partial`, and `valid` when relevant?
- Is recovery posture explicit, or does the reader behavior only exist in code?
- Would a reviewer miss the true handoff contract if they only read the local bundle?

## Related runtime notes

Observed in the `behavior-extraction-ralph-sufficiency-critique` bundle, where the JSON judgment artifact was named but not documented as fully as sibling sufficiency families.
