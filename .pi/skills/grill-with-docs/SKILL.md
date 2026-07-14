---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding, but do it with a strict bounded format. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

## Bounded-session rule (required)

- The session has a hard limit of **15 questions total**.
- Keep an internal running count and show it every turn as **`Question X of 15`** in the terminal-friendly footer.
- Do **not** silently exceed 15 questions.
- If the topic becomes clear enough before question 15, say so and offer to stop grilling and move to design/execution.
- If you reach question 15 and the topic is still materially underspecified, say that it is **still too ambiguous to proceed safely** and summarize the unresolved ambiguities instead of asking question 16.

## Early-stop rule (required)

Stop asking new questions early when either condition is met:

1. **Ready enough** — the design now has enough clarity to move into planning or implementation safely.
2. **Too ambiguous** — the remaining unknowns are still architecture-shaping or contract-shaping, and further questioning in this session is not converging fast enough.

When you stop early, state which condition was met and why.

If a question can be answered by exploring the codebase, explore the codebase instead.

Put detailed reasoning, code citations, and documentation edits **above** the following block when both are needed.

### Terminal-friendly close (required every turn)

**Always end each grilling turn** with this compact footer — last lines in the message — so the operator can scan or choose without scrolling:

1. **Question X of 15** — show the current question number and total bound.
2. **Question** — restate the question in one line (or two short lines max).
3. **Recommendation** — restate your advised answer in one line (or two short lines max).
4. **Options** — the plausible responses in **short labeled form** (for example `A) …`, `B) …`, `C) …`). Keep labels and text minimal; one option may be “Something else — reply in prose.” If the next action is genuinely open-ended, use a single line such as `Options — Confirm · Push back · Ask a narrower question` instead of long prose.
5. **Status** — one short line choosing one of:
   - `Status — Needs more grilling`
   - `Status — Ready enough`
   - `Status — Too ambiguous`

Do not bury these lines behind long paragraphs; they stay at the **bottom** of the reply.

### Final-turn behavior (required)

When the status becomes **Ready enough** or **Too ambiguous**, do not ask another numbered question after that.
Instead, use the footer to close the session and summarize whether the operator should:
- proceed to planning/design,
- proceed to implementation handoff, or
- stop because ambiguity is still too high.

Optional rhythm (when it helps the session): **Discovery** (goal, why it matters, success criteria, who is affected, constraints, alternatives) → **Critique** (what could go wrong, dependencies, happy path, edge cases, out-of-scope, trade-offs) → **Execution handoff** when the operator confirms readiness (see below).

</what-to-do>

<supporting-info>

## Where things live in this repo

- **Domain glossary and ubiquitous language** stay in repo-root `CONTEXT.md` and `UBIQUITOUS_LANGUAGE.md`, plus bounded-context paths described below — not under `.agents/`.
- **Ephemeral session scratch** (extra notes, timelines the operator wants on disk): `.agents/grill-with-docs/` — optional; `.agents/` is gitignored temporary workspace per `AGENTS.md`.
- **Tracked execution todos** after the operator says go ahead: follow the **todo-contract** skill — one JSON sidecar per open item at `.agents/open-items/items/OI-####.todo.json`, mutated **only** via `npm run todos -- <verb>` (see `.pi/skills/todo-contract/SKILL.md` § CLI tooling). Do **not** use a repo-root `TODO.md`, hand-edit the JSON sidecar, or invent ad-hoc per-session todo formats.

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── CONTEXT-MAP.md
├── .agents/
│   └── adr/                          ← agent-facing decision notes
├── src/
│   ├── ordering/
│   │   └── CONTEXT.md
│   └── billing/
│       └── CONTEXT.md
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `.agents/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

Don't couple `CONTEXT.md` to implementation details. Only include terms that are meaningful to domain experts.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

</supporting-info>
