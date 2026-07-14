# `src/core/flow-supervisor`

Core runtime-adjacent supervision for one Flow Runner execution.

## Purpose

`flow-supervisor` watches a single Flow Runner run, validates that the run targets a safe workspace, captures run-health signals, and writes an operator-facing report with fragility signals and immediate Flow remedy recommendations.

It is the lower layer that future orchestration agents should call when they need a Flow to get to a trustworthy terminal state.

## Boundary

```text
Future Work Orchestrator
  -> Flow Supervisor
      -> Flow Runner
          -> Nodes
```

## Invariants

- Flow Supervisor is **not** a second runtime.
- Flow Supervisor depends on Flow Runner; Flow Runner must not depend on Flow Supervisor.
- Flow Runner still executes Nodes and owns canonical run records/events.
- Nodes still own contracts and artifacts.
- Supervisor artifacts are generated runtime artifacts and belong under `.artifacts/`, preferably attached to the Flow Runner run root.
- Supervised runs require an isolated, non-protected target worktree by default.

## V1 package map

- `types.ts` — public policy/result/reporting contracts.
- `runSupervisedFlow.ts` — top-level supervised external Flow API.
- `policy/` — default policy and normalization.
- `workspace/` — target workspace safety checks.
- `telemetry/` — Flow Runner event capture and metrics derivation.
- `health/` — health classification and fragility signals.
- `reporting/` — deterministic remedy recommendations and summary rendering.
- `artifacts/` — supervisor artifact layout and writers.

## Orchestrator handoff

Future orchestration layers should invoke Flow Supervisor, not naked Flow Runner, when they need a Flow to complete autonomously or semi-autonomously.

The intended handoff is:

1. Orchestrator chooses the work and selects a Flow.
2. Orchestrator supplies `flowId`, `sessionId`, input, target worktree, and autonomy/recovery policy.
3. Flow Supervisor validates the workspace and runs Flow Runner.
4. Flow Supervisor returns health status, metrics, fragility signals, and remedy recommendations.
5. Orchestrator decides the next unit of work from the supervisor report.

This keeps multi-Flow work selection out of Flow Supervisor while ensuring every individual Flow run has a reliability report.

## CLI

Friendly external Flow commands:

```powershell
npm run flow:supervisor
npm run flow:supervisor -- list
npm run flow:supervisor -- list --json
npm run flow:supervisor -- run recipes
npm run flow:supervisor -- run recipes --profile dry-run
```

The no-arg command opens an interactive picker over discovered external Flows. Friendly `run` resolves aliases, generates a session id when `--session` is omitted, collects Flow-declared prompts, prints a pre-run summary, and then calls `runSupervisedExternalFlow(...)`.

Advanced explicit mode remains available:

```powershell
npm run flow:supervisor -- run-flow <flow-id> <session-id> --target-worktree <path> [--cwd <flow-workspace>]
```

The CLI prints compact JSON with the supervisor status and report paths. Use `--allow-dirty-worktree` only for deliberate fixture/dev runs or local `flow-library/` dogfood Flows.

## Validation

Use deterministic tests only. Do not require live model/provider runs for this package.
