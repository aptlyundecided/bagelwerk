# Plan Schema

Structure and guidance for writing `plan.md`. Adapt sections to the feature — not every
section is mandatory, but each omission should be intentional.

---

## Section: Problem

State the problem this feature solves. Should be grounded in the investigation.

- 1-3 sentences max
- Frame from the user/consumer perspective, not the implementation perspective
- Include stakes: why does this matter?

```markdown
## Problem
[What breaks, costs, or fails without this feature. Who it affects. Why it matters now.]
```

---

## Section: Scope

Explicit boundaries prevent drift. Both halves are required.

```markdown
## Scope

**In scope:**
- [Concrete capability 1]
- [Concrete capability 2]

**Out of scope:**
- [Thing that might be assumed but isn't included]
- [Related feature deferred to later]
```

---

## Section: Proposed Design

The core of the plan. Structure varies by feature type — use whichever subsections apply.

### Components
What new or modified components does this introduce?

```markdown
### Components
- **[ComponentName]** — [responsibility, one sentence]
- **[ComponentName]** — [responsibility, one sentence]
```

### Interfaces
What does this expose or consume? Be specific about contracts.

```markdown
### Interfaces
- **[Interface/API/Topic/Endpoint]** — [what it does, who uses it, shape of data]
```

### Data Flow
How does data move through the system? Use plain-text diagrams where helpful.

```markdown
### Data Flow
[Source] → [Transform] → [Sink]

1. [Stage 1 — what happens, what triggers it]
2. [Stage 2 — what data looks like at this point]
3. [Stage 3 — where it ends up]
```

### State & Persistence
What gets stored, where, and with what guarantees?

```markdown
### State & Persistence
- [What is stored]
- [Where it lives]
- [Retention, consistency, or migration notes]
```

### Error Handling
How does this fail gracefully?

```markdown
### Error Handling
- [Failure mode] → [response: retry / dead-letter / alert / degrade gracefully]
```

### Observability
What signals does this emit?

```markdown
### Observability
- **Metrics:** [what to count or measure]
- **Logs:** [what to emit and at what level]
- **Alerts:** [what condition warrants waking someone up]
```

---

## Section: Open Questions

Don't resolve these artificially. An honest open question is more useful than a false answer.

```markdown
## Open Questions
- [ ] [Question — who needs to answer it, what it blocks]
- [ ] [Question]
```

---

## Section: Next Actions

Concrete, actionable. Not a full task breakdown, but enough to start moving.

```markdown
## Next Actions
1. [First concrete action — who does it, what it produces]
2. [Second action — dependency on #1 or parallel?]
3. [Spike / prototype / investigation needed before design can proceed]
```

---

## Writing Principles

- **Use the user's terminology** — if they call it a "reconciliation loop", use that term
- **Name things** — anonymous "services" and "components" are hard to reason about
- **Plain-text diagrams over nothing** — `A → B → C` is better than "A sends data to B which sends to C"
- **Flag parallelism** — mark next actions that can be done independently as `[parallel]`
- **Decisions belong in decisions.md** — if you catch yourself writing "we decided to X because Y", move it
