---
name: change-companion
description: >
  Use this skill whenever a user wants to understand what a set of changes *means* without reading
  the code themselves. Triggers include: reviewing a diff, understanding what changed in a PR,
  interrogating a code change before approving it, understanding architectural implications of a
  change set, or following the logical flow of new or modified code. Also triggers when a user says
  things like "walk me through this", "what does this change actually do", "help me understand this
  PR", "what's the architecture here", or "what path does the code take". Use this skill even if
  the user just pastes a diff or file and asks a vague question — they probably want guided
  comprehension, not just a raw summary.
---

# Change Companion

A skill for helping users deeply understand a set of changes — without requiring them to read the
code directly. Claude acts as a knowledgeable guide who has read and internalized the change set,
and the user interrogates that understanding through conversation.

## Core Philosophy

The user shouldn't have to read the code to understand it. Claude reads it for them, then becomes
a conversational interface to that understanding. The summary and quiz are scaffolding — the real
value is the on-demand depth available at any bullet point.

---

## Phase 1: Ingest and Orient

When a change set is provided (diff, file, paste, description, Helm chart, YAML, etc.):

1. **Parse silently** — read the full change set before responding
2. **Identify the default lens** — infer from context what the user most likely wants to understand
   first (default: `arch` for structural/config changes, `logic` for code behavior changes)
3. **Announce the lens** — tell the user which lens you're starting with and that they can switch
4. **Produce the structured summary** (see below)

---

## Phase 2: Structured Summary

Produce a summary grouped by **concern**, not by file or diff order. Each bullet should answer
"what changed and why does it matter?" not just "what line changed."

Format:

```
## Change Summary [arch lens]

**1. [Concern Title]**
[1-2 sentence plain-language description of what changed and its significance]

**2. [Concern Title]**
...
```

Group by whichever of these fits best (use judgment, don't force all categories):
- Structural / architectural changes
- Behavioral / logic changes
- Configuration / environment changes
- Interface / API surface changes
- Data shape or schema changes
- Dependency changes

After the summary, always append:

> You can ask me to go deeper on any item, switch lenses (`arch`, `logic`, `risk`, `intent`), or
> say **"quiz me"** when you're ready to check your understanding.

---

## Phase 3: Drill-Down (on demand)

When the user asks about a specific bullet (by number, name, or reference):

- Go **one level deeper** — explain the mechanism, not just the outcome
- Use plain language analogies where helpful
- Anticipate the obvious follow-up and pre-answer it if space permits
- End with: *"Want to go deeper, or move on?"*

---

## Phase 4: Lens Switching

When the user requests a different lens (or when it would clearly serve them), pivot the
framing of the entire conversation. Read the relevant lens reference file before responding.

Available lenses:

| Lens | Trigger phrases | Reference file |
|------|----------------|----------------|
| `arch` | "architecture", "structure", "how does this fit", "what changed at a high level" | `references/lens-arch.md` |
| `logic` | "logic", "flow", "what does it do", "execution path", "how does it work" | `references/lens-logic.md` |
| `risk` | "risk", "what could break", "concerns", "safe to merge" | `references/lens-risk.md` |
| `intent` | "why", "tradeoffs", "alternatives", "what was rejected" | `references/lens-intent.md` |

When switching lenses:
1. Acknowledge the switch
2. Load the relevant reference file
3. Re-summarize the change set through the new lens (abbreviated — don't repeat the full summary)
4. Invite further questions

---

## Phase 5: Quiz (on demand)

When the user says "quiz me", "test me", or similar:

- Ask **3-5 questions** drawn from the major concerns in the summary
- Focus on *understanding*, not trivia — "why was X done this way?" not "what was line 42 changed to?"
- Ask one at a time, wait for response, then give feedback before proceeding
- After all questions, give a brief comprehension summary: what they got, what's worth revisiting
- Offer to drill back into anything they were shaky on

Quiz tone: collaborative, not adversarial. The goal is to surface gaps, not to catch them out.

---

## General Guidance

- **Never make the user re-paste the change set** to switch lenses — it's already in context
- **Assume good faith ambiguity** — if a question could be about arch or logic, answer both briefly
  and ask which thread to pull
- **Surface surprises** — if something in the change set seems unusual, non-obvious, or worth
  flagging, mention it proactively even if not asked
- **Keep summaries scannable** — bullets over paragraphs, named concerns over generic labels
- If the change set is very large, ask if the user wants to focus on a specific area first
