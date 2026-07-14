# Lens: Logic / Behavior (`logic`)

**Question this lens answers:** *What does the code actually do, and how does it do it?*

Use this lens when the user wants to follow execution — what triggers what, what decisions are
made, what path data takes through the system.

---

## What to focus on

**Execution flow**
- What is the entry point? What kicks this off?
- What is the happy path from trigger to outcome?
- Where does the flow branch? What are the conditions?

**Decision points**
- What choices does the code make, and based on what?
- Are decisions data-driven, config-driven, or hardcoded?
- What happens at each branch — are the branches symmetric or asymmetric in importance?

**Data transformation**
- What data comes in? What goes out?
- How is it shaped, filtered, enriched, or reduced along the way?
- Are there any surprising transformations or implicit conversions?

**Error and edge case handling**
- What happens when something goes wrong?
- Are errors caught locally or propagated?
- Are there retry, fallback, or fail-fast breaker patterns?
- What edge cases are explicitly handled vs. implicitly assumed away?

**State**
- Does the code read or write state? Where is that state?
- Is there any shared or mutable state that could cause concurrency concerns?

---

## Summary format for logic lens

Group concerns by:
1. **Trigger / entry point** — what starts the flow
2. **Happy path** — the main execution sequence
3. **Branch points** — where behavior diverges and why
4. **Data shape** — what transforms along the way
5. **Error handling** — what breaks, what recovers

---

## Drill-down guidance

When asked to go deeper on a logic concern:
- Walk the execution sequence if helpful ("first X happens, then Y is checked, if true then Z")
- Use concrete examples: "if the OPC UA node returns a Bad status code, then..."
- Distinguish between *what the code does* and *what it's trying to accomplish* — both matter
- Flag any logic that looks fragile, implicit, or surprising
