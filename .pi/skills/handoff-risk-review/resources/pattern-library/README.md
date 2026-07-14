# Pattern library (handoff risk)

Stable entries live here for **accepted patterns** and **anti-patterns**. Each file uses **`id:`** (stable machine id) and **`title:`** for humans.

## Tiers

- **Tier 1 — Mechanical / conversion / envelope** — See **`tier-1-mechanical.md`**.
- **Tier 2 — Semantic / conceptual** — See **`tier-2-semantic.md`**.

## Accepted patterns

| id | File |
|----|------|
| `pattern.contract.recovery-aware-canonical-handoff` | **`accepted-patterns/pattern.contract.recovery-aware-canonical-handoff.md`** |

## Anti-patterns (seeded)

| id | File |
|----|------|
| `fragility.parse.fenced-json` | **`anti-patterns/fragility.parse.fenced-json.md`** |
| `fragility.contract.unparseable-counted-as-empty` | **`anti-patterns/fragility.contract.unparseable-counted-as-empty.md`** |
| `fragility.flow.lineage-shape-drift` | **`anti-patterns/fragility.flow.lineage-shape-drift.md`** |
| `fragility.flow.reference-only-artifact-assumption` | **`anti-patterns/fragility.flow.reference-only-artifact-assumption.md`** |
| `fragility.contract.semantic-success-mechanical-failure` | **`anti-patterns/fragility.contract.semantic-success-mechanical-failure.md`** |
| `fragility.contract.handoff-target-drift` | **`anti-patterns/fragility.contract.handoff-target-drift.md`** |
| `fragility.skill.required-artifact-missing-hard-crash` | **`anti-patterns/fragility.skill.required-artifact-missing-hard-crash.md`** |
| `fragility.skill.transport-success-zero-contract-output` | **`anti-patterns/fragility.skill.transport-success-zero-contract-output.md`** |
| `fragility.skill.partial-required-artifact-publication` | **`anti-patterns/fragility.skill.partial-required-artifact-publication.md`** |
| `fragility.flow.partial-artifact-surface-invalid` | **`anti-patterns/fragility.flow.partial-artifact-surface-invalid.md`** |
| `fragility.flow.repo-modifying-node-without-contract-format-boundary` | **`anti-patterns/fragility.flow.repo-modifying-node-without-contract-format-boundary.md`** |
| `fragility.ralph.fallback-happy-path-result-assumption` | **`anti-patterns/fragility.ralph.fallback-happy-path-result-assumption.md`** |
| `fragility.contract.machine-readable-bundle-under-specified` | **`anti-patterns/fragility.contract.machine-readable-bundle-under-specified.md`** |
| `fragility.contract.family-drift` | **`anti-patterns/fragility.contract.family-drift.md`** |
| `fragility.shape.binding-runtime-policy-leak` | **`anti-patterns/fragility.shape.binding-runtime-policy-leak.md`** |
| `fragility.shape.run-scope-artifact-leak` | **`anti-patterns/fragility.shape.run-scope-artifact-leak.md`** |
| `fragility.shape.local-node-concern-mixing` | **`anti-patterns/fragility.shape.local-node-concern-mixing.md`** |
| `fragility.shape.handoff-contract-obscured-by-local-orchestration` | **`anti-patterns/fragility.shape.handoff-contract-obscured-by-local-orchestration.md`** |

Add new files when the same failure mode repeats in the wild; cite them from findings through **`pattern_ids`**.
