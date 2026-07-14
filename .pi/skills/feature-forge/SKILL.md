---
name: feature-forge
description: >
  Use this skill whenever a user wants to investigate, design, or plan a feature — even if they
  only have a vague idea. Triggers include: "I want to build X", "help me think through Y",
  "what would it take to add Z", "let's design this feature", "pick up [feature-name]", or any
  time a user is trying to turn an idea into a concrete plan. Also triggers when a user wants to
  resume work on an existing feature plan by naming it. Use this skill even for half-formed ideas
  — the investigation phase is designed specifically for that. The skill writes durable artifacts
  to .agents/feature-forge/ so context persists across sessions and supports parallel agentic work.
---

# Feature Forge

A hybrid investigator/designer skill that helps users move from idea to structured plan — and
keeps that plan durable across sessions via the `.agents/feature-forge/` directory.

## Directory Convention

All feature work lives under:
```
.agents/
└── feature-forge/
    └── <feature-slug>/
        ├── investigation.md   # Running notes, Q&A, assumptions, unknowns
        ├── plan.md            # Structured design output
        └── decisions.md       # Key choices made and why
```

The user is responsible for naming the active feature when resuming. The skill is responsible
for proposing the name when starting fresh.

---

## Mode Detection

On invocation, determine which mode applies:

**New Feature** — user has an idea but no existing plan directory
→ Go to [Investigation Phase](#investigation-phase)

**Resume** — user names an existing feature (e.g. "pick up opc-ua-reconnect-resilience")
→ Go to [Resume Phase](#resume-phase)

---

## Investigation Phase

### Phase 1: Orient

Ask the user to describe the feature in whatever form they have it — one sentence, a paragraph,
a brain dump. Don't ask structured questions yet. Just get the raw idea.

### Phase 2: Propose a slug

Based on the description, propose a kebab-case directory name:
- Short (2-4 words)
- Descriptive, not generic ("opc-ua-reconnect-resilience" not "feature-1")
- Confirm with user before creating anything

### Phase 3: Create the directory structure

```bash
mkdir -p .agents/feature-forge/<slug>
```

Create the three files with skeleton content (see [File Schemas](#file-schemas)).

### Phase 4: Drive the investigation

Work through the investigation dimensions below. Ask questions **one or two at a time** —
don't overwhelm. Record answers into `investigation.md` as you go (update the file after
each meaningful exchange, not just at the end).

Load `references/investigation-dimensions.md` for the full question bank organized by dimension.
Use judgment about which dimensions matter most for this feature — don't mechanically ask all of
them. A UI feature needs different questions than a data pipeline change.

After each round of questions, synthesize what you've learned and surface:
- What's now clear
- What's still unknown
- What assumptions are being made

### Phase 5: Transition to design

When investigation feels sufficiently settled (or user signals readiness), say so explicitly:
> "I think we have enough to start designing. Here's what I'm working with: [brief synthesis].
> Want me to draft the plan?"

Don't transition silently — the user should know when the mode is shifting.

---

## Design Phase

Transform investigation findings into a structured plan. Write to `plan.md`.

Load `references/plan-schema.md` for the full plan structure and guidance.

Key principles:
- **Design decisions go in `decisions.md`**, not `plan.md` — keep the plan clean
- **Open questions stay open** — don't paper over unknowns with assumptions
- **Think in components and interfaces**, not implementation details
- Flag anything that needs external input (another team, a dependency, a prototype first)

After drafting, walk the user through the plan section by section. Invite pushback.
Update files to reflect any changes.

---

## Resume Phase

When user names an existing feature:

1. Read all three files from `.agents/feature-forge/<slug>/`
2. Synthesize current state:
   - What's been investigated
   - Where the plan stands
   - Any open questions or decisions still pending
3. Present a brief status summary and ask: *"Where do you want to pick up?"*

Don't assume continuation — they may want to revisit the investigation, revise the plan,
or just check on decisions made.

Always append a resume entry to `investigation.md`:
```
## Resumed: <date>
[Brief note on what was picked up and any new context]
```

---

## File Schemas

### investigation.md skeleton
```markdown
# Investigation: <Feature Name>
**Slug:** <slug>
**Started:** <date>
**Status:** In Progress

## Feature Description
[Raw idea from user]

## Dimensions Explored
<!-- Populated during investigation -->

## Open Questions
<!-- Things we don't know yet -->

## Assumptions
<!-- Things we're treating as true without full confirmation -->
```

### plan.md skeleton
```markdown
# Plan: <Feature Name>
**Slug:** <slug>
**Status:** Draft

## Problem
[What this solves and why it matters]

## Scope
[What's in. What's explicitly out.]

## Proposed Design
[Components, interfaces, data flow — see plan-schema.md]

## Open Questions
[Unresolved items that could affect the design]

## Next Actions
[Concrete actions to move forward]
```

### decisions.md skeleton
```markdown
# Decisions: <Feature Name>
**Slug:** <slug>

<!-- Format for each entry: -->
<!--
## Decision: <short title>
**Date:** <date>
**Made by:** <user / agent / collaborative>
**Decision:** [What was decided]
**Rationale:** [Why]
**Alternatives considered:** [What else was on the table]
**Consequences:** [What this opens or closes]
-->
```

---

## General Guidance

- **Write to files continuously** — don't batch everything to the end of a session. If the
  session dies, what's in the files is what survives.
- **Surface decisions explicitly** — whenever a meaningful choice is made during investigation
  or design, write it to `decisions.md` immediately. Don't let decisions get buried in conversation.
- **Stay in the user's domain** — use their terminology, not generic software terms. If they
  call it a "reconciliation loop" not a "sync worker", use that.
- **Flag parallelism opportunities** — if part of the design could be worked independently
  (by another agent or another session), say so explicitly.
- **Don't gold-plate** — if a simple design serves the need, say so. Complexity should be
  justified by requirements, not invented.
