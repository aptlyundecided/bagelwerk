---
name: handoff-risk-review
description: >-
  Agent-led review of one Flow/Node handoff or one skill boundary for handoff risk. Walk the
  full writer-to-reader path, cite pattern-library ids when they fit, and emit a
  plain Markdown report with locator/tier/severity plus bounded batch defaults.
  Use when stress-testing parser-sensitive or machine-routed handoffs that may
  break, thrash, or hide the real failure mode (OI-0029).
---

# Handoff risk review

Review a **handoff surface** where upstream output must satisfy downstream expectations.
That includes:

- **orchestration handoffs** between published runtime units
- **artifact-shaped or envelope-shaped boundaries** inside a Flow run, Node run, or queue work item
- **skill boundaries** where a skill bundle and its binding together define the real contract

Grade the **full writer-to-reader path**, not one file in isolation. The point is to find places where output may look semantically fine to a human but still break the next consumer.

Repo language: repo-root **`CONTEXT.md`** and **`UBIQUITOUS_LANGUAGE.md`**.

## Preconditions

1. Operator names exactly **one target**:
   - **Flow/Node mode:** one published Flow or Node handoff under `src/core/` with its README/tests/bindings, **or**
   - **Skill mode:** one **skill boundary** — usually `SKILL.md` plus the binding(s) that declare what that skill reads, writes, and how downstream code parses it.
2. Read **`.current-os`** when suggesting shell paths or opening files.

## Defaults (overrideable)

| Parameter | Default | Meaning |
|-----------|---------|---------|
| **`N`** | **4** | Max findings emitted this pass (after ranking). |
| **Severity floor** | **`major`** | Include **`blocker`** and **`major`** only; omit **`minor`** / **`note`** unless the operator lowers the floor. |

## Ranking before cap

1. **Severity** first: **`blocker`** before **`major`**.
2. Within the same severity: **control-flow / graph order** (upstream → downstream).

Stop after **`N`** findings that meet the floor. End with an explicit **early-stop banner** saying the review stopped early and more issues may remain.

## Procedure

1. **Orient**
   - Open the target graph, `README.md`, and the code that stages artifacts, names outputs, and parses downstream handoffs.
2. **List the relevant handoff edges**
   - **Tier 1 — mechanical:** parseability, fences, JSON/Markdown drift, schema/version gates, recovery posture, run-scoping, and artifact-ownership mistakes.
   - **Tier 2 — semantic:** ambiguous goals, contradictory signals, weak exit criteria, subject drift, or local concern-mixing that hides the true handoff.
3. **Inspect the full boundary**
   - Review prompt/skill text + binding + output plan + downstream parser together.
   - When a first-party local bundle exists, inspect `SKILL.md`, `contracts.md`, `input.md`, and `output.md`.
   - If the boundary uses an explicit translator / linker / normalization seam, review the full writer -> linker -> reader chain rather than grading only the writer or only the final reader.
   - If the writer can modify repo state, inspect whether repo mutation is separated from read-only contract closing/publication.
4. **Check shape-driven risk around the boundary**
   - Is too much local policy, staging, retry handling, or post-processing packed into one workflow-local module?
   - Does that make the actual contract hard to review or easy to drift?
5. **Check local bundle quality when a skill boundary is in scope**
   - Does `SKILL.md` point to the local contract docs?
   - Do `input.md` and `output.md` match the binding?
   - Are machine-readable outputs specified clearly enough that the writer/reader agreement is visible without reading TypeScript?
   - Would a thin machine-readable sidecar reduce parser-sensitive breakage?
   - For parser-sensitive but read-only boundaries, should there be an explicit translator / linker / normalization handoff that preserves raw-to-canonical mapping and emits validation telemetry before critique or routing?
   - If such a linker exists, does it classify continuation posture explicitly (for example `clean`, degraded-but-usable, and semantically-insufficient) instead of collapsing all drift into one hard failure?
   - If the boundary is repo-modifying, does the bundle explicitly report changed files and forbid silent success without publishable handoff artifacts?
   - If the boundary is repo-modifying, is there a required read-only contract-format / publication-closing Node or seam before downstream critique or routing?
6. **Check family-level consistency**
   - Are sibling bundles repeating the same contract language and due for extraction?
   - Are sibling bundles drifting in recovery posture, observability, or field precision?
7. **Emit findings**
   - Use the finding envelope below.
   - Add `pattern_ids` when the pattern library already has a matching entry.
   - Keep novel issues freeform instead of forcing a bad pattern match.
8. **Apply the cap and early-stop banner** unless the operator overrides the defaults.

## Finding envelope (plain Markdown only)

Each finding should be a readable Markdown subsection. Do **not** emit JSON/YAML interchange blobs inside the operator-facing report.

Include:

- **Locator (structured):** `kind` (`flow-edge` | `node-artifact` | `skill-binding` | `orchestration-handoff`), plus `flowId` / `nodeId` / `queueId` when relevant, plus `from` / `to` ids. Add one short prose note when the edge is awkward to key.
- **Tier:** `mechanical` or `semantic`
- **Severity:** `blocker` | `major` | `minor` | `note`
- **`pattern_ids`:** optional list (for example `fragility.parse.fenced-json`)
- **Freeform:** evidence paths, quotes, why the handoff is risky, and what kind of fix would likely reduce that risk

Definitions and examples live in **`resources/guidelines.md`**. Catalog entrypoint: **`resources/pattern-library/INDEX.md`**.

## Pattern library

- Pattern ids stay stable even if the skill wording gets simpler.
- Tier 1 mechanical patterns are listed first in the library index.
- Add new entries when the same failure mode repeats in real runs.

## Related open item

- **OI-0029** — tracked implementation and pilot notes under `.agents/open-items/items/OI-0029.md`.
