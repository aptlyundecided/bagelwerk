---
id: pattern.contract.recovery-aware-canonical-handoff
title: Canonical handoff with recovery-aware normalization
status: accepted
tier: mechanical
---

# Accepted pattern: canonical handoff with recovery-aware normalization

## Intent

Keep the writer contract strict while making the reader resilient to benign format drift. Preserve a deterministic downstream surface without forcing whole-loop retries for cosmetic publication-shape defects.

## Core shape

- **Strict writer:** prompts and skill-local output contract require one canonical payload shape.
- **Tolerant reader:** downstream Node can recover benign wrappers or reconstruct canonical sections from stronger upstream artifacts.
- **Explicit structural states:** downstream distinguishes `missing`, `present_but_unparseable`, `partial`, and `valid` instead of collapsing everything into `*_empty`.
- **Recovery before retry:** loop control should prefer normalization / reconstruction before re-running the entire upstream reasoning pass.
- **Observable salvage:** recovery writes diagnostics to Node/run observation artifacts and exposes stable summary metadata.

## Why it works better

- Prevents semantically good artifacts from being discarded because of fences, wrapper prose, section-order drift, or non-canonical but reconstructable section text.
- Reduces repair-loop churn caused by publication-shape sensitivity rather than missing meaning.
- Gives operators precise failure states instead of vague `*_empty` outcomes.

## Recommended implementation moves

1. Define one canonical artifact shape in the skill contract bundle (`contracts.md`, `input.md`, `output.md`).
2. Keep writer instructions strict:
   - exact artifact name
   - exact payload kind
   - exactly one machine-readable object when JSON is required
3. Centralize reader recovery:
   - parse naked JSON first
   - recover fenced JSON / artifact-wrapped JSON when allowed
   - normalize sectioned Markdown from stronger upstream artifacts when owned sections are non-canonical
4. Classify outcomes precisely:
   - `missing`
   - `present_but_unparseable`
   - `partial`
   - `valid`
5. Let loop policy react to those states:
   - retry on semantic absence
   - degrade or normalize on cosmetic / structural drift

## Good repo examples

- `src/core/agent-execution/skillBackedCore.ts`
  - recovery-aware publication-shape classification (`response_block | fenced_code_block | raw_text_fallback | missing`) and input-artifact normalization before validation
- `src/core/agent-execution/validatedSkillBackedNode.ts`
  - retry-context and healing summary artifacts around validated skill-backed Node sessions
- `src/core/built-ins/platform-tour/nodes/readHandoffPacket.ts`
  - strict Zod-validated reader for a handoff-packet artifact produced by an upstream Node

## Review questions

- Is the writer requirement explicit and singular?
- Can the reader recover benign drift without silently changing meaning?
- Does the contract checker distinguish unparseable from absent?
- Does loop policy retry only when meaning is unavailable, rather than when presentation drifted?
