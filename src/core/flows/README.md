# `src/core/flows`

Emerging **Flow** surface for the next-runtime workspace.

## Intent

This directory owns the canonical config-first **Flow** model:

- nested source **Flow** authoring
- Flow boundary composition for reusable child Flows
- references to configured **Nodes** by `nodeId`
- compilation into one resolved graph with qualified Node paths
- execution helpers that reuse the leaf Node runtime seam

## File map

- `config/` — canonical Flow config, resolved-graph types, compilation, configured-flow execution helpers, and Flow runtime event derivation.
- `generic/queue-processor/` — reusable dynamic Flow queue runner for spinning up bounded parallel Flow work items from runtime-discovered work.

## Runtime events

Flow Runner emits the canonical execution event stream for real Flow runs, including Flow boundary observations and Node progress. Flow Workbench may derive or mirror comparable events for developer-mode inspection, but it is not the production event authority.

A rendered event stream can include first-class Flow boundary observations alongside Node graph lines:

```text
⬢ FLOW enter parent-flow reason=run-start
⬢ FLOW enter parent-flow.child-flow reason=run-start
◉ NODE graph start ...
⬢ FLOW exit parent-flow.child-flow reason=node-transition
⬢ FLOW transit parent-flow.child-flow -> parent-flow
⬢ FLOW enter parent-flow.next-child-flow reason=node-transition
```

Events are derived from resolved Node `flowPath` metadata and Node transitions; they do **not** introduce a nested Flow runtime loop. Flow Runner persists its canonical run events under the run root, while Flow Workbench persists developer-mode per-run events in `flow-events.json` with shape:

```json
{ "schemaVersion": 1, "events": [] }
```

## Execution Policy

A Flow may declare `executionPolicy` to provide inherited execution settings for descendant Nodes. V1 wires only the `agent` section for harness/model/provider selection. Policy is contextual: it changes how Nodes run, not which Nodes own contracts or artifacts.

Inheritance is Flow-scoped:

1. parent Flow policy is inherited by child Flows
2. child Flow policy fields override parent Flow fields
3. Workbench/CLI run overlays may override policy globally or for qualified Flow paths

Per-Flow/per-Node `.env` variables are not an accepted policy surface; `.env` is for global defaults and secrets.

## Boundary composition

A parent Flow may use a child Flow key as an orchestration boundary:

- `initial: "child-flow"` enters the child at its declared initial Node.
- `to: "child-flow"` enters the child at its declared initial Node.
- `from: "child-flow"` attaches to inferred child exit Nodes: child Nodes with no child-local outgoing edge.

Compilation still produces one flat resolved Node graph. Normal `runConfiguredFlow(...)` execution remains sequential and follows exactly one matching Node edge at a time.

## Parallel child Flow runner

`runConfiguredFlowWithParallelFlows(...)` is the first Flow-level parallel execution seam. It keeps Node contracts intact while allowing configured child Flow boundaries to run concurrently:

1. Run the root flow sequentially through an `after` Node.
2. Start declared child Flow branches in parallel from each branch Flow's initial Node.
3. Stop each branch at that Flow's exit Node(s), preserving Node-scoped outputs.
4. Merge branch working contexts and resume at a declared `join` Node.

This intentionally makes **Flow boundaries** the concurrency unit instead of arbitrary Node fan-out. Joins still consume Node-scoped outputs/artifacts; Flow boundaries do not become artifact owners.

## Generic queue processor Flow

`runQueueProcessorFlow(...)` handles runtime-discovered work queues where the number of Flow work items is not known at authoring time. It accepts a list of `workItems`, each with its own Flow, runs those work items with bounded concurrency, waits for all started work items to complete, and returns ordered per-work-item results. This is intended for surfaces like comment nit-pick batching, where 14 changed files can become 7 two-file Flow work items.

Resume/fork execution is different from normal orchestration: every resolved Node path is a valid re-entry target, and `runConfiguredFlowFromNode(...)` starts at that Node and continues downstream.

## Invariant

**Flows** are structural/scheduling boundaries. Contracts belong to **Nodes**. Nested Flow composition keeps artifacts Node-scoped; use Transition Nodes for nontrivial handoffs between child Flows. Flow runtime events are observability derived from the flat resolved graph, not Flow-level output contracts.
