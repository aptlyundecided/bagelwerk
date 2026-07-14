---
id: fragility.contract.semantic-success-mechanical-failure
title: Semantic sufficiency is accepted before deterministic contract success
tier: semantic
---

# Anti-pattern: semantic success is accepted before mechanical contract success

## Symptom

- A critique or judgment Node says the output is sufficient in meaning.
- The deterministic downstream consumer still cannot parse, validate, or normalize the handoff.
- Loop control or completion policy privileges the semantic blessing too early.

## Why it hurts

- Lets a Flow or Node run exit or advance on prose-level confidence while publication-shape incompatibility remains unresolved.
- Produces contradictory operator signals: "sufficient" and "not consumable" at the same time.
- Causes late failures at downstream boundaries that should have been gated earlier.

## Review questions

- Can a handoff be marked complete before contract check succeeds?
- Does loop exit require both semantic sufficiency and deterministic consumer acceptance?
- Are critique semantics and contract-check semantics intentionally composed, or accidentally competing?

## Related runtime notes

Observed in `behavior-extraction-ralph`, where critique could say `sufficient` while headings, ids, or bullet grammar still failed the contract checker.
