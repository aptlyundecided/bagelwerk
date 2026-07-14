# Tier 1 — Mechanical / conversion / envelope

Index of **Tier 1** pattern entries (objective, parse/convert).

## Accepted patterns

| id | title | Location |
|----|-------|----------|
| `pattern.contract.recovery-aware-canonical-handoff` | Canonical handoff with recovery-aware normalization | **`accepted-patterns/pattern.contract.recovery-aware-canonical-handoff.md`** |

## Anti-patterns

| id | title | Location |
|----|-------|----------|
| `fragility.parse.fenced-json` | JSON artifact contains fenced Markdown wrapper | **`anti-patterns/fragility.parse.fenced-json.md`** |
| `fragility.contract.unparseable-counted-as-empty` | Unparseable semantic content is treated as empty | **`anti-patterns/fragility.contract.unparseable-counted-as-empty.md`** |
| `fragility.flow.lineage-shape-drift` | Equivalent lineage seeds appear in different surface sections | **`anti-patterns/fragility.flow.lineage-shape-drift.md`** |
| `fragility.flow.reference-only-artifact-assumption` | Resume logic assumes local artifact ownership instead of durable references | **`anti-patterns/fragility.flow.reference-only-artifact-assumption.md`** |
| `fragility.skill.required-artifact-missing-hard-crash` | Missing required artifact turns a recoverable miss into a hard crash | **`anti-patterns/fragility.skill.required-artifact-missing-hard-crash.md`** |
| `fragility.skill.transport-success-zero-contract-output` | Skill transport reports completion but publishes zero contract output | **`anti-patterns/fragility.skill.transport-success-zero-contract-output.md`** |
| `fragility.skill.partial-required-artifact-publication` | Skill publishes only part of a required artifact bundle | **`anti-patterns/fragility.skill.partial-required-artifact-publication.md`** |
| `fragility.flow.partial-artifact-surface-invalid` | Degraded result publishes a partial artifact surface that violates Flow invariants | **`anti-patterns/fragility.flow.partial-artifact-surface-invalid.md`** |
| `fragility.flow.repo-modifying-node-without-contract-format-boundary` | Repo-modifying Node closes its own downstream contract without a read-only contract-format boundary | **`anti-patterns/fragility.flow.repo-modifying-node-without-contract-format-boundary.md`** |
| `fragility.ralph.fallback-happy-path-result-assumption` | Fallback posture exists, but result assembly still assumes happy-path payloads | **`anti-patterns/fragility.ralph.fallback-happy-path-result-assumption.md`** |
| `fragility.contract.machine-readable-bundle-under-specified` | Machine-readable handoff exists, but the local contract bundle under-specifies the writer/reader agreement | **`anti-patterns/fragility.contract.machine-readable-bundle-under-specified.md`** |
| `fragility.contract.family-drift` | Sibling contract bundles in the same family drift in recovery, observability, or precision | **`anti-patterns/fragility.contract.family-drift.md`** |
| `fragility.shape.binding-runtime-policy-leak` | Workflow-local Node or binding carries generic runtime policy that should live in a shared surface | **`anti-patterns/fragility.shape.binding-runtime-policy-leak.md`** |
| `fragility.shape.run-scope-artifact-leak` | Supposedly local handoff artifacts are staged in a shared or weakly scoped location | **`anti-patterns/fragility.shape.run-scope-artifact-leak.md`** |

_Add rows as new patterns are promoted._
