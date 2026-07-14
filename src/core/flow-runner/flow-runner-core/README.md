# Flow Runner Core behaviors

Implementation behaviors behind the public `src/core/flow-runner/flowRunnerCore.ts` facade.

Each subdirectory owns one behavior and includes an `about.md` describing its local responsibility and invariants.

## Behavior map

- `api/` — public Flow Runner API and result contracts.
- `resolution/` — Flow binding to resolved Flow Runner graph.
- `policy/` — execution-policy overlay discovery and precedence.
- `events/` — typed event fan-out to event sink and log projection.
- `middleware/` — Flow/Node/transition lifecycle hooks and console progress middleware.
- `preflight/` — accepted upstream artifact dependency lookup.
- `resume/` — opt-in accepted-output resume checks.
- `results/` — NodeResult validation and synthetic failed run results.
- `node-run/` — one-Node execution, runtime input construction, artifact observation, acceptance, and sidecar persistence.
- `traversal/` — run-tree node projection and next-transition resolution.
- `recovery/` — graph-first unhandled failure resolver integration.
- `plans/` — whole-flow, prefix, and lanes execution-plan orchestration.
- `profiles/` — declarative run-profile metadata helpers that compile package-owned recipes into neutral execution plans.
- `tests/` — deterministic helper tests for the behavior modules.

## Invariants

- `flowRunnerCore.ts` should remain a small facade.
- Flow graph transitions are authoritative; failure fallback only runs after no transition handles the terminal failure.
- Nodes should use `input.runtime`; Workbench compatibility belongs in future middleware/adapters, not the core runner input.
- Flow execution CLIs should not be run during active collaboration unless the operator expressly asks.

## Tests

```bash
node ./node_modules/tsx/dist/cli.mjs --test src/core/flow-runner/flow-runner-core/middleware/middleware.test.ts src/core/flow-runner/flow-runner-core/policy/executionPolicy.test.ts src/core/flow-runner/flow-runner-core/profiles/runProfiles.test.ts src/core/flow-runner/flow-runner-core/resolution/resolveFlowRunnerGraph.test.ts src/core/flow-runner/flow-runner-core/tests/flowRunnerCoreHelpers.test.ts
```
