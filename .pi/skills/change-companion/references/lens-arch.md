# Lens: Architecture (`arch`)

**Question this lens answers:** *What is the structure, and how did it change?*

Use this lens when the user wants to understand the shape of the system — how components relate,
what boundaries were moved, what patterns were introduced or removed.

---

## What to focus on

**Component relationships**
- What new dependencies were introduced? What were removed?
- Did any component gain or lose responsibility?
- Were any interfaces (APIs, contracts, event types) added, changed, or removed?

**Layering and boundaries**
- Did anything cross a layer boundary it didn't before?
- Were concerns separated or merged?
- Did the change introduce or resolve any circular dependencies?

**Patterns in use**
- What architectural patterns are present? (e.g. event-driven, pub/sub, request/response,
  repository, factory, strategy)
- Did the change introduce a new pattern, or extend an existing one?
- Was anything replaced with a more or less abstract pattern?

**Configuration and topology**
- For Helm/K8s/infra changes: what changed about how the system is deployed or wired?
- Did service discovery, routing, or resource limits change?
- Were any new environment dependencies introduced (secrets, configmaps, endpoints)?

---

## Summary format for arch lens

Group concerns by:
1. **Structural changes** — what components/modules changed shape or responsibility
2. **Dependency changes** — new or removed relationships between components
3. **Interface changes** — what the system exposes or consumes differently
4. **Topology/config changes** — how it's deployed, wired, or configured

---

## Drill-down guidance

When asked to go deeper on an architectural concern:
- Draw the relationship in plain text if helpful (A → B → C style)
- Explain *why* the structure is this way — what constraint or goal drove it
- Flag if this pattern is conventional vs. custom/bespoke
