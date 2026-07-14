---
id: fragility.shape.binding-runtime-policy-leak
title: Workflow-local Node or binding carries generic runtime policy that should live in a shared surface
tier: mechanical
---

# Anti-pattern: workflow-local shape leaks generic runtime policy

## Symptom

- A workflow-local binding, configured Node, or experiment surface owns recovery, normalization, artifact-policy, or execution-shaping logic that is not truly specific to that workflow.
- Similar siblings will likely need the same behavior, but there is no shared generic surface yet.
- The handoff contract can only be understood by reading both the local binding and the leaked policy code.

## Why it hurts

- Increases drift risk across sibling surfaces that should share one runtime rule.
- Makes contract review depend on hidden local implementation details instead of a thin declarative binding.
- Raises the odds that one path gets hardening while another quietly keeps the older behavior.

## Review questions

- Is this policy genuinely specific to the workflow, or is it really generic runtime behavior in disguise?
- Would moving it into a shared generic surface make the binding read more like a declarative contract again?
- Are sibling Nodes or bindings already reimplementing nearby variants of the same policy?

## Related runtime notes

Use when the fragility comes from policy placement rather than from prompt wording alone.
