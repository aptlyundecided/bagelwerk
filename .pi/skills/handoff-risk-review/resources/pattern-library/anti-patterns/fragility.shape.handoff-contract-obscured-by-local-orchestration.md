---
id: fragility.shape.handoff-contract-obscured-by-local-orchestration
title: Local orchestration policy obscures the actual writer/reader agreement around a handoff
tier: semantic
---

# Anti-pattern: handoff contract obscured by local orchestration

## Symptom

- The handoff itself may be reasonable, but the path that produces or consumes it is wrapped in enough local orchestration policy that the effective contract is hard to inspect.
- Success, degradation, retry posture, or artifact precedence are inferred from scattered branches rather than one visible contract surface.
- Reviewers must reconstruct the real agreement from control flow instead of reading it directly.

## Why it hurts

- Makes it hard to tell whether a failure is contract drift, policy drift, or both.
- Raises the chance that later edits preserve control flow while quietly changing downstream expectations.
- Weakens the usefulness of a fragility review because the contract is no longer legible at the boundary.

## Review questions

- Is the handoff contract stated directly anywhere, or only implied by orchestration branches?
- Are degradation, retry, and completion semantics visible at the boundary or hidden inside local logic?
- Would extracting local orchestration from the contract surface make writer/reader agreement clearer?

## Related runtime notes

Use when the main risk is contract illegibility caused by local control structure.
