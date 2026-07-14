# Lens: Risk (`risk`)

**Question this lens answers:** *What could go wrong, and how worried should I be?*

Use this lens when the user wants to assess the change before approving or merging — what's
breaking, what's fragile, what assumptions are being made.

---

## What to focus on

**Breaking changes**
- Does anything change a public interface, contract, or API?
- Are there schema migrations or data format changes that require coordination?
- Does anything depend on ordering or timing that could be violated?

**Fragile assumptions**
- What does this code assume about its environment, inputs, or dependencies?
- Are those assumptions documented or enforced?
- What happens if an assumption is violated?

**Rollback risk**
- If this needs to be rolled back, is that safe and straightforward?
- Are there any one-way doors (migrations, state changes, external side effects)?

**Blast radius**
- If this breaks, what breaks with it?
- Is the failure mode contained or cascading?

**Test coverage signal**
- Does the change include tests? Do they cover the critical paths?
- Are there obvious untested branches?

---

## Summary format for risk lens

Rate each concern as: 🟢 Low / 🟡 Medium / 🔴 High

Group by:
1. **Breaking changes** — interface or contract changes
2. **Fragile assumptions** — implicit dependencies
3. **Rollback safety** — reversibility
4. **Blast radius** — failure scope

---

## Drill-down guidance

When asked to go deeper on a risk concern:
- Be specific about the failure mode, not just "this could break"
- Suggest a mitigation if one is obvious
- Distinguish between risk of *bugs* vs. risk of *data loss/corruption* vs. risk of *downtime*
