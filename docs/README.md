# Documentation map

This directory is for orientation docs: small guides that help humans and agents understand where the living architecture, vocabulary, and workflow rules are kept.

It is intentionally **not** the place for every design note. Most useful documentation should live beside the code it describes.

## Start here

1. [`../CONTEXT.md`](../CONTEXT.md) — current architectural direction and active repo rules.
2. [`../UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md) — canonical terms: Flow, Node, Flow Runner, Flow Workbench.
3. [`architecture.md`](./architecture.md) — plain-English mental model for the active Flow / Node architecture.
4. [`documentation-policy.md`](./documentation-policy.md) — where different kinds of documentation belong.
5. [`agent-workflow.md`](./agent-workflow.md) — how agent-facing workspaces, open items, todos, and local decision notes fit together.
6. [`../changelog/about.md`](../changelog/about.md) — changelog structure and user-visible note policy.

## Code-local docs

For implementation details, prefer the README closest to the code:

- [`../src/core/README.md`](../src/core/README.md)
- [`../src/core/flows/README.md`](../src/core/flows/README.md)
- [`../src/core/nodes/README.md`](../src/core/nodes/README.md)
- [`../src/core/flow-runner/README.md`](../src/core/flow-runner/README.md)
- [`../src/core/flow-workbench/README.md`](../src/core/flow-workbench/README.md)
- [`../src/core/built-ins/README.md`](../src/core/built-ins/README.md)

## Historical notes

Retired pre-Flow/Node orchestration vocabulary is listed in [`../UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md). Use git history for archaeology; do not rebuild old trees as new documentation authority.
