# Resolution behavior

Owns conversion from a Flow Runner binding into a resolved Flow Runner graph.

## Includes

- Static configured-node library setup in `resolveFlowRunnerBinding.ts`.
- Resolution orchestration in `graph/`.
- Temporary resolution state in `state/`.
- Local/qualified path reference handling in `refs/`.
- Accepted artifact source qualification in `accepted-artifacts/`.
- Nested Flow flattening in `flatten/`.
- Flow boundary initial/exit calculation in `boundaries/`.
- Flow-authored edge expansion in `edges/`.
- Execution-policy overlay application in `policies/`.
- Final graph validation and assembly in `validation/`.
- Flowchart: `resolution-flow.mmd`.

## Invariants

- Resolution should not execute Nodes or touch artifacts.
- Binding callers use this behavior; callers with an already resolved Flow Runner graph skip it.
- This behavior intentionally duplicates graph-resolution logic under Flow Runner so the new runner does not depend on old NodeGraph `runnerSpec` compilation.
