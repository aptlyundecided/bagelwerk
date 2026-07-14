---
name: doc-dialog
description: >
  Use this skill when the user wants to hold an unstructured, free-form conversation through an
  open markdown document instead of the terminal — so they can arrange their thoughts, write
  long-form, and reply at their own pace in their editor. Triggers include: "let's talk through a
  doc", "open a dialog doc", "I want to write my thoughts in a file and have you respond",
  "converse via a document", "let's have this conversation in markdown", "start a doc dialog", or
  resuming a named dialog. This is NOT for planning a specific feature (use feature-forge) or
  stress-testing a plan against project docs (use grill-with-docs) — it is a general-purpose
  back-and-forth where the document itself is the communication channel. Dialog files live under
  .agents/doc-dialog/ so the conversation persists across sessions.
---

# Doc Dialog

A general-purpose "talk through a document" skill. The point is to move the conversation out of
the cramped terminal and into a markdown file the user can open in their editor — where they can
write long-form, reorganize, and respond whenever they like. The terminal becomes a lightweight
hand-off channel; the **document is where the conversation actually happens**.

This is deliberately **unstructured**. There is no plan, no schema, no phases. It is just a
durable, two-sided conversation. If the work turns into designing a feature, hand off to
`feature-forge`; if it becomes grilling a plan against project docs, hand off to `grill-with-docs`.

## Directory Convention

```
.agents/
└── doc-dialog/
    └── <slug>.md      # one file per conversation thread
```

These are conversational scratch, not tracked deliverables. If the user doesn't want them in
git, suggest adding `.agents/doc-dialog/` to `.gitignore` — their call, don't assume.

## Mode Detection

On invocation, determine which mode applies:

- **New dialog** — no existing file the user is pointing at → [Start a Dialog](#start-a-dialog)
- **Resume** — user names an existing dialog (e.g. "pick up the dietician-boundary dialog") →
  [Resume a Dialog](#resume-a-dialog)

---

## Start a Dialog

1. **Propose a slug.** Short kebab-case, descriptive of the topic (`dietician-boundary`, not
   `chat-1`). Confirm with the user before creating anything.
2. **Create the file** at `.agents/doc-dialog/<slug>.md` using the [skeleton](#file-skeleton),
   filling in the title, date, and a one-line topic. End it with an empty `## You — turn 1`
   block waiting for the user.
3. **Optionally open it** for them (e.g. `code <path>` or, on Windows, `Invoke-Item <path>`) —
   offer, don't force; they may already have their editor open.
4. **Tell them how it works**, briefly, in the terminal:
   > Created `.agents/doc-dialog/<slug>.md`. Write your thoughts under **## You — turn 1**, then
   > type **`go`** here and I'll reply in the doc. Edit anything above freely — I won't touch
   > your words.

---

## The Turn-Taking Protocol

This is the heart of the skill. Keep it simple and predictable.

- The document is an alternating transcript of `## You — turn N` and `## Claude — turn N` blocks.
- **The user writes** under the latest open `## You` block, then types a short cue in the
  terminal — default cue is **`go`** (also accept "ok", "next", "read it", "your turn").
- **On the cue, you:**
  1. Read the whole file.
  2. Find the user's latest `## You — turn N` block (everything below your last `## Claude`
     block). That is their new turn.
  3. Append a `## Claude — turn N` block with your reply.
  4. Append a fresh empty `## You — turn N+1` block beneath it, so there's always a clear place
     for them to write next.
  5. In the terminal, say only something short: **"Replied in the doc — your turn (turn N+1)."**
     Do not duplicate the full reply in the terminal; the doc is the channel.

### Rules that keep it sane

- **Never edit or delete the user's words.** Only append your own blocks. If you need to
  reference or quote them, quote — don't rewrite.
- **Turn numbers are the ordering mechanism** (clocks aren't reliably available). Increment them;
  don't depend on timestamps. You may add the date from context if useful, but the turn number is
  authoritative.
- **Write the full thought in the doc**, not the terminal. Long-form, formatted markdown is the
  whole point — use headings, lists, code blocks freely inside your block.
- **One exchange per cue.** Read, reply, hand back. Don't run ahead inventing the user's next turn.
- **If the latest `## You` block is empty** when cued, don't guess — ask in the terminal whether
  they meant a different file or forgot to save.
- **Side actions are fine.** If the conversation asks you to actually do something (run a command,
  read code, make an edit), do it — then summarize the result inside your `## Claude` block.

---

## Resume a Dialog

When the user names an existing dialog:

1. Read `.agents/doc-dialog/<slug>.md` in full.
2. Give a one-or-two-line status in the terminal: what the conversation was about and where it
   left off (the last turn).
3. If there's new content under an open `## You` block, treat it as their turn and reply per the
   protocol. Otherwise, ask what they'd like to pick up and ensure there's an open `## You` block
   for them to write in.

If the file has no trailing open `## You` block, add one before handing back.

---

## File Skeleton

```markdown
# Dialog: <Title>

**Started:** <date>
**Topic:** <one-line description>

> How this works: write under the latest **## You** block, then type `go` in the terminal.
> I reply under **## Claude** and open the next **## You** block for you. Your text is yours —
> I only append, never rewrite.

---

## You — turn 1

<!-- write here -->
```

---

## General Guidance

- **Match the user's register.** This is a conversation, not a report. If they're brainstorming
  loosely, be loose back; if they're precise, be precise.
- **Keep the doc readable as a standalone artifact** — someone should be able to open it later and
  follow the whole thread without the terminal.
- **Don't over-structure.** Resist the urge to impose templates, headings-per-topic, or action
  lists unless the user asks. The value is the freedom.
- **Know when to graduate.** If the dialog converges on a concrete feature or plan, say so and
  offer to carry the relevant conclusions into `feature-forge` or a real artifact — don't let the
  doc silently become a spec.
```

