# Lens: Intent (`intent`)

**Question this lens answers:** *Why was this done this way? What was decided, and what was left on the table?*

Use this lens when the user wants to understand the reasoning behind the change — not just what
it does, but why this approach was chosen over alternatives.

---

## What to focus on

**The problem being solved**
- What was wrong or missing before this change?
- What pain point, requirement, or goal drove this?

**The approach chosen**
- What is the core design decision this change embodies?
- What pattern or strategy was selected?

**Alternatives implicitly rejected**
- What other approaches would have been reasonable here?
- What tradeoffs does the chosen approach make vs. alternatives?
- Are there any signals in the code (comments, naming, structure) that hint at rejected paths?

**Constraints and context**
- What constraints might have shaped this decision? (performance, compatibility, team familiarity,
  existing patterns in the codebase)
- Does this decision fit the broader architecture, or is it a local exception?

**Future implications**
- Does this change open or close future options?
- Does it introduce technical debt, or pay some down?

---

## Summary format for intent lens

Group by:
1. **Problem** — what this was solving
2. **Decision** — the core design choice
3. **Tradeoffs** — what was gained and given up
4. **Future options** — what this enables or forecloses

---

## Drill-down guidance

When asked to go deeper on an intent concern:
- Be honest about uncertainty — if intent isn't clear from the code, say so and reason from evidence
- Distinguish between *inferred* intent (from code patterns) and *stated* intent (from comments/PR
  description if provided)
- Frame tradeoffs as genuinely bilateral — don't editorialize unless asked
