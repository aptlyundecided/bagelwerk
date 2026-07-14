# `src/core/flow-workbench`

**Flow Workbench** is the developer-mode runner over canonical **Flow / Node** services.

## V1 shape

### Node workbench

- load canonical **Flow** config
- resolve one qualified **Node** path
- preflight required accepted upstream artifacts
- resolve accepted-artifact compatibility aliases from a refactored qualified Node path back to the producer's stable `nodeId` when the canonical path is missing, recording `aliasResolved` provenance
- record a launch-time invocation snapshot, including effective Execution Policy and coarse policy sources when present
- run the same canonical **Node** execution seam runtime uses
- record emitted/expected artifact accounting sidecars
- derive and emit first-class Flow boundary events from resolved Node paths
- persist `flow-events.json` beside the run/latest sidecars and copy it to accepted runs
- verify expected artifact existence only

### Flow run-tree workbench

`runFlowWorkbenchFlow(...)` runs a whole configured Flow by repeatedly using the Node workbench surface and immediately accepting successful/intermediate Node outputs so downstream preflight can keep using accepted Node artifacts. It records a root `run-tree.json` under a synthetic `__flow__.<flowId>` workbench surface.

Supported first-pass modes:

- sequential full Flow execution
- static parallel child Flow groups, using Flow boundaries as branch units
- aggregate queue-controller artifacts as normal Node-owned outputs

`acceptFlowWorkbenchRunTree(...)` bulk-accepts all Node runs in a run tree. Artifacts remain Node-scoped; Flow run-tree records are inspection/coordination metadata, not Flow-owned contracts.

## Non-goals

- separate runtime tier
- second graph engine
- content validation of artifacts in v1
