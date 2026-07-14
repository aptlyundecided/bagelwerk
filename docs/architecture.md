# Architecture orientation

The active repo architecture is centered on **Flow / Node** orchestration under [`src/core/`](../src/core/).

## Mental model

- **Flow** is structure: it groups configured Nodes, nested child Flows, execution policy, and graph shape.
- **Node** is execution: it owns the runnable behavior, contract boundary, and accepted artifacts.
- **Flow Runner** is the canonical Workbench-free service for real Flow runs.
- **Flow Workbench** is developer tooling over the same Flow / Node seams; it is not a second runtime.

A short version:

```text
Configured Flow
  └─ references Configured Nodes by nodeId
       └─ each Node binds to reusable behavior via nodeType
            └─ Node execution emits Node-owned results/artifacts
```

## Important boundaries

### Nodes own contracts

Downstream work should depend on **accepted Node results**, not vague "latest output" or Flow-level artifacts. A Flow can organize execution, but it should not steal artifact ownership from its Nodes.

### `nodeType` and `nodeId` are different

- `nodeType` = reusable code-owned behavior, such as `core.timer`.
- `nodeId` = one configured instance inside a Flow or library.

Do not use these interchangeably. A Flow may contain many Nodes with different `nodeId`s that share the same `nodeType`.

### Execution Policy is contextual

Flow-level execution policy can influence how descendant Nodes run, such as harness/model/provider selection. It does not change which Node owns the contract or artifacts.

### Flow Workbench is inspection tooling

Flow Workbench helps developers run, inspect, accept, and debug Node results inside a Flow. It should consume or mirror canonical Flow Runner behavior where practical rather than becoming a separate runtime tier.

## Where active code lives

- [`src/core/flows/`](../src/core/flows/) — Flow config, compilation, resolved graph, Flow events, execution helpers.
- [`src/core/nodes/`](../src/core/nodes/) — configured Nodes, registries, Node execution, Node graph traversal.
- [`src/core/flow-runner/`](../src/core/flow-runner/) — canonical Workbench-free Flow execution surface.
- [`src/core/flow-workbench/`](../src/core/flow-workbench/) — developer-mode runner and inspection surface.
- [`src/core/built-ins/`](../src/core/built-ins/) — intentionally small active built-in Flow packages.
- [`src/core/experiments/`](../src/core/experiments/) — proving ground only; not active build/test authority until promoted.

## Retired vocabulary

For new architecture work, use the Flow / Node terms in [`../UBIQUITOUS_LANGUAGE.md`](../UBIQUITOUS_LANGUAGE.md). If historical code has a useful helper, extract the useful idea into a Flow / Node-shaped active surface. Do not restore old ownership islands.
