---
id: fragility.flow.repo-modifying-node-without-contract-format-boundary
title: Repo-modifying Node closes its own downstream contract without a read-only contract-format boundary
tier: mechanical
---

# Anti-pattern: repo-modifying Node without contract-format boundary

## Symptom

- One Node both modifies repo state and owns the only downstream contract-closing/publication Node.
- If contract validation fails after side effects land, the normal recovery posture is to replay the same repo-modifying Node.
- The boundary does not expose an explicit read-only salvage/publication-closing path.

## Why it hurts

- Side effects may be real while the handoff stays unacceptably invalid.
- Replay can thrash the repo, duplicate edits, or hide whether the failure came from mutation or publication shape.
- Operators are forced into ad-hoc manual acceptance or file surgery because the intended salvage seam is missing.

## Review questions

- Is repo mutation separated from downstream contract closing/publication?
- Does a read-only `*-contract-format` or equivalent Node exist between implementation and critique/routing?
- If publication fails after repo mutation, can the system salvage the handoff without rerunning implementation?
- Does the contract explicitly report which files changed so salvage/publication can stay honest?

## Related runtime notes

Use when a repo-modifying Flow / Node boundary needs deterministic downstream artifacts but still couples mutation and publication into one writer surface.
