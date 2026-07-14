# Open items — ideas and roadmap

Non-normative backlog: experiments, scripts, and multi-agent patterns. **Normative contracts** stay in `SKILL.md`, `ITEM-FORMAT.md`, `HANDOFF-FORMAT.md`, and `OPERATIONS.md`. Update this file when directions firm up enough to promote into those docs or into real `OI-####` items.

## Logged todos (skill document hardening)

Each item below was requested as explicit trackable work; the first implementation lives in `SKILL.md` § **Operator and agent guidance** (2026-05-12). Re-open a checkbox if we later split content out or need a second pass.

- [x] **Decision table** (capture vs item vs notes vs handoff vs todo) — landed: *When to use what* table in `SKILL.md`.
- [x] **Anti-patterns** — landed: *Anti-patterns* list in `SKILL.md`.
- [x] **Queue-style answers** (mandatory fields for list/summary) — landed: table + who acts next + next concrete action in `SKILL.md`.

Follow-up (optional): add cross-links from `OPERATIONS.md` into that section so maintainers edit one mental model.

---

## A — Richer item model (optional `ITEM-FORMAT` extensions)

- Acceptance / “done means” checklist section.
- `see:` links and `[@agents-focus]`-style path#line anchors (align with repo `AGENTS.md`).
- Dependencies: `blocked-by: OI-…`, `blocks: OI-…`.
- Owner / next actor: `human` | `agent` | `either`.

## B — Richer derived INDEX views

- Siblings of `INDEX.md`: e.g. `INDEX.by-state.md`, `INDEX.blocked.md`, `INDEX.ready.md`.
- Single “refresh indices” operation regenerates all.

## C — Richer natural-language operations (explore before spec)

Questions to settle before extending `OPERATIONS.md`:

- How much graph logic (dependencies) do we want agents to infer vs require explicit fields?
- Should new verbs (`link`, `set acceptance`, …) always map to mechanical file edits, or sometimes to “suggested text” for the human?
- Conflict rules when INDEX counter vs filesystem disagree.

Capture concrete verb list and edge cases here first; promote to `OPERATIONS.md` once stable.

## D — Stronger handoffs

- Optional **handoff id** suffix when multiple handoffs land on one calendar day (so “latest” stays unambiguous).
- Subsection **Next actor:** `human` | `agent` | `pair` in `HANDOFF-FORMAT.md`.
- Optional **stale-after** date for INDEX surfacing (script-friendly).

## E — Capture templates

- Small template blocks under this directory (e.g. `templates/feature.md`) pasted into `OPEN_ITEMS_CAPTURE.md`.
- Optional Cursor snippet pointing at `CAPTURE-FORMAT.md`.

## F — Todo sidecar integration

- When the last open task in `OI-####.todo.json` is completed (via `npm run todos -- set-task-status … completed`), prompt: move parent OI state vs append handoff vs add follow-up tasks (`npm run todos -- add-task`).
- Optional: show task-status counts in INDEX bullets (already available as `npm run todos -- list --json`).

## G — CLI and scripts

**Shipped (minimal, portable bundle):** `npm run open-items --` → `.pi/skills/open-items/cli/openItemsCli.ts` (mirrored into other harness skill dirs by skill-surface-parity).

| Subcommand | Role |
| --- | --- |
| `list` / `list --json` / `list --all` | Bulk read queue to stdout (markdown or JSON). |
| `validate` | Structural + index drift checks; exit 1 on errors. |
| `index` | Regenerate `INDEX.md` + counter. |
| `capture` | List pending capture H1s. |

Normative “when to use” guidance lives in `SKILL.md` § **CLI tooling**.

### Still future (not implemented)

| Command / script | Purpose |
| --- | --- |
| `open-items graph` | Emit `OI-####` dependency edges for Mermaid or JSON (needs structured `blocked-by` in item format). |
| `open-items stale-handoffs` | List items whose latest handoff is older than N days and still not `done`. |

### Implementation notes

- **Language:** TypeScript (fits `npm run …`) or Python (if team already has a reader script) — pick one for maintainability; wrap the other via subprocess only if needed.
- **Input:** parse markdown sections with stable headings (`## id`, `## state`, …), not free-form prose.
- **Output:** JSON for automation; Markdown for humans; exit codes for CI.
- **Location:** `.pi/skills/open-items/cli/` (TypeScript; **source of truth** under `.pi/`). Parity sync duplicates this tree into `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`. Extend here; document new subcommands in `SKILL.md` § CLI tooling and in this file.

Document any ad-hoc Python (or other) exploratory reader here with **path, owner, and status** so it does not become orphan tooling.

---

## Multi-agent orchestration (linking open items)

Several agents may share `.agents/open-items/` without shared memory. Use **explicit links** instead of implied order.

### Lightweight conventions (no new files required today)

- In **summary** or **notes**, line `relates-to: OI-0002, OI-0005` for soft coupling.
- `blocked-by: OI-0002` in notes until a dedicated section exists (then move to item front-matter in A).
- Handoff **Next actions** names the **other OI** when work hands off: “Unblock OI-0004 after OI-0002 merges.”

### Graph-shaped workflows

- **Fan-out:** one parent OI spawns children; children hand back to parent via handoff on parent item.
- **Pipeline:** `OI-0001` handoff lists `next: OI-0002` as the only consumer; agent working 0002 reads 0001’s latest handoff first (skill already supports resume).
- **Merge gate:** item stays `blocked` until listed `OI-…` are `done`; CLI `validate` / `graph` can enforce later.

### When orchestration gets heavy

- Promote a dedicated OI “meta: orchestration for feature X” whose only purpose is links, ordering, and handoffs; keep code items separate.
- Consider generated `ORCHESTRATION.md` under `.agents/open-items/` (derived from item metadata) once G exists.

---

## Ideas inbox (uncategorized)

Add bullets here; promote to sections above or to `OPEN_ITEMS_CAPTURE.md` when they mature.