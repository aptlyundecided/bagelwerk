# Handoff risk review — guidelines

Companion to **`../SKILL.md`**. Use these definitions so findings stay comparable across runs.

## Severity (`blocker` · `major` · `minor` · `note`)

| Value | Meaning |
|-------|---------|
| **`blocker`** | The handoff can break predictably under normal drift (parse/validate failure), or can trigger wrong downstream action without clear run-event evidence. |
| **`major`** | The handoff is likely to thrash, couple too tightly, or fail in a hard-to-diagnose way. |
| **`minor`** | Real debt or risk, but mostly under less common models/providers or edge conditions. |
| **`note`** | Observation, future tightening, or documentation-only nudge. |

**Default report floor:** **`major`** (includes **`blocker`**).

## Locator fields

Minimum structured fields (express as Markdown lists or a small table):

- **`kind`:** `flow-edge` | `node-artifact` | `skill-binding` | `orchestration-handoff`
- **`nodeId` / `flowId` / `queueId`:** stable identifiers for the reviewed handoff when identifiable
- **`from` / `to`:** graph-local node ids or published runtime-unit ids
- **Optional prose:** one sentence when the edge is awkward to key cleanly

## Tier

- **`mechanical`:** parseability, envelopes, encoding, schema, fences, run-scoping, and artifact-ownership mistakes that can break or blur the handoff.
- **`semantic`:** meaning, contradictory guidance, weak exit criteria, subject drift, or local concern-mixing that hides the true handoff.

## Pattern ids

Optional. When a finding matches an entry under **`pattern-library/`**, cite the file’s stable `id:`. Novel findings stay freeform until the same failure repeats enough to deserve promotion.

## Shape-driven risk checks

Use these only when they materially affect handoff reliability, reviewability, or retry churn. This is not a general style review.

Ask:

- Is a workflow-facing **configured Node** or binding carrying so much local orchestration, staging, or post-processing that the real writer/reader agreement becomes hard to see?
- Has generic policy leaked into a workflow-local Node or binding in a way that sibling surfaces will likely implement differently?
- Are run-local input or output artifacts staged in a shared location that could collide across attempts or neighboring runs?
- Does concern-mixing force a reviewer to inspect several helpers or branches just to recover the actual handoff?

Typical signals:

- transcript gathering, artifact staging, recovery logic, and quality grading all living in one workflow-local module
- workflow-local modules recreating generic recovery or normalization behavior instead of binding onto one shared surface
- non-run-scoped temp or artifact paths treated as if they were private to one handoff
- bindings that no longer read as declarative contracts because they also own orchestration policy
- parser-sensitive writer -> reader boundaries with no explicit translator / linker / normalization seam even though the downstream reader really expects a narrower canonical shape
- repo-modifying Nodes that also own the only downstream contract-closing/publication boundary
- repo-modifying Nodes that can fail contract validation after side effects without an explicit read-only salvage/publication Node

## Shared-contract extraction checks

When reviewing a first-party skill family, also ask:

- Are sibling skills restating the same contract with only noun swaps?
- Should that repeated contract move into a shared resource under the owning `src/core/` package?
- Is a local bundle documenting a real local deviation, or just carrying duplicated boilerplate?
- Would a shared contract reduce prompt/binding/parser drift across the family?
- For machine-readable outputs, can a reviewer learn the full writer/reader agreement from the local bundle alone, or must they inspect TypeScript to discover required fields and recovery rules?

Typical candidates:

- repeated JSON judgment contracts across critique / sufficiency skills
- repeated sectioned report heading contracts across revision surfaces
- repeated structural-state vocabularies (`missing`, `present_but_unparseable`, `partial`, `valid`)
- repeated transport-empty states where provider calls complete but publish zero contract-deliverable output
- repeated partial-publication states where some required artifacts land but ancillary required artifacts are skipped
- repeated parser-sensitive Markdown surfaces that should probably have a thin machine-readable sidecar

## Contract-family drift checks

When two sibling surfaces belong to the same contract family, compare them directly:

- Does one document stronger normalization precedence than the other?
- Does one expose recovery / retry posture explicitly while the other leaves it implicit?
- Does one preserve better observability for the same defect class?
- Does one fully specify machine-readable artifact shape, field rules, and structural states while the other only names the file?
- Is the divergence intentional, or just drift?

## Thin machine-readable contract checks

When a local bundle writes JSON or parser-sensitive Markdown, verify that the bundle itself states:

- canonical payload shape
- field rules / allowed values
- structural-state vocabulary when recovery matters
- whether reader recovery is allowed and where it is observable
- whether Markdown is the canonical machine surface, and if so whether a thin sidecar would materially reduce parser-sensitive breakage
- for repo-modifying Nodes, the changed-file reporting contract and whether the contract-closing Node/seam is allowed to modify the repo (recommended: no)

For parser-sensitive read-only boundaries, also verify:

- if an explicit translator / linker / normalization seam exists, it publishes a canonical handoff plus observability artifacts rather than hiding recovery inside the final reader
- the linker preserves raw-to-canonical mapping so reviewers can audit what was inferred or reconstructed
- continuation posture is explicit (for example `clean`, degraded-but-usable, and semantically-insufficient) and downstream routing only continues on the usable states
- degraded success still preserves flow-boundary invariants and does not publish placeholder artifact entries

For repo-modifying boundaries, also verify:

- repo mutation and contract closing/publication are visibly separated, preferably as an implementation Node followed by a read-only contract-format Node
- the writer cannot be treated as an acceptable success if repo changes landed but downstream-readable artifacts remain invalid
- the salvage path is explicit: preserve the original run archive, repair/publication-close the handoff, and report which files were changed

Also check target alignment across the handoff:

- does the downstream surface restate which artifact, narrowed request, or scope guard it is grading?
- could the prose be coherent while still evaluating the wrong work item?
- would obvious subject drift surface as a distinct state, or be misreported as ordinary insufficiency?

If those details exist only in parser or recovery code, treat that as a real risk signal rather than mere documentation polish.

## Bounded batch

- Rank by **severity** first, then **graph order**.
- Emit at most **`N`** findings (default **4**) meeting the **severity floor**.
- Always add an **early-stop banner** if the scan could continue.

## Report encoding

- **Plain Markdown** body for the operator.
- Do **not** embed JSON/YAML interchange blocks in the narrative report; structured automation may use the same fields outside the human-facing report later.
