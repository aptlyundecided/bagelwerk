# Documentation policy

Documentation should make the repo easier to navigate without turning into a second, stale copy of the code.

## What belongs where

| Need | Home |
| --- | --- |
| Current architecture rules and direction | [`CONTEXT.md`](../CONTEXT.md) |
| Canonical vocabulary | [`UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md) |
| Contributor and agent operating rules | [`AGENTS.md`](../AGENTS.md) |
| Module behavior, file maps, invariants, tests | Local `README.md` beside the code |
| Repo orientation and reading order | `docs/` |
| User-visible change notes and release history | `changelog/` |
| Local agent decision notes / ADR-style scratch | `.agents/adr/` when present |
| Generated runtime evidence | `.artifacts/` |

## How to use `docs/`

Use this directory for durable orientation guides that help future developers and agents find the right source of truth.

Good fits:

- "How do I understand the Flow / Node architecture?"
- "Where should I document this kind of thing?"
- "What should a new contributor read first?"

Poor fits:

- detailed API docs that will drift from code,
- generated artifacts,
- one-off planning notes,
- ADR graveyards that mostly describe retired architecture.

## ADR-style notes

ADR means **Architecture Decision Record**: a short record of a decision, the alternatives considered, and the consequences.

For this repo right now, ADR-style notes are agent-facing and live under `.agents/adr/` when present. That keeps local decision scratch close to other agent coordination material instead of making `docs/` look like the product documentation source of truth.

Promote a decision out of `.agents/adr/` only when it becomes durable repo documentation that future contributors need even without the agent workspace. Promotion targets should usually be:

- `CONTEXT.md` for active architectural rules,
- `UBIQUITOUS_LANGUAGE.md` for canonical terms,
- a local module README for code-specific invariants,
- or a focused guide in `docs/` for onboarding/orientation material.

## Keep docs close to code

When a change affects a module's behavior, contracts, or test entrypoints, update the README closest to that module. Prefer a small local README over a central document that tries to describe every package.

## Keep terminology current

Use **Flow / Node / Flow Runner / Flow Workbench** for active architecture. Historical terms should be clearly marked as historical and should not guide new folder names, APIs, or ownership boundaries.
