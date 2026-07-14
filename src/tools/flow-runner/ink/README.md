# Flow Runner Ink view

Generic Ink presentation adapter for Flow Runner progress.

This package is intentionally under `src/tools/flow-runner/ink/` because it is a tool/view layer, not Flow Runner execution logic and not a built-in Flow package.

## Intent

```text
Flow Runner execution
  -> FlowRunnerEvent stream
  -> per-run progress store
  -> subscribers: Ink, console, JSONL, future observers
```

The view should render generic Flow/Node/Execution Plan facts and avoid hardcoded built-in-specific panels. Built-in Flows are proving consumers, not the owners of this UI; `platform-tour` is the current proving consumer.

## Files

- `flowProgressGraph.ts` — best-effort resolved-graph + execution-plan description used to seed pending Nodes/lanes before execution starts.
- `flowProgressState.ts` — pure event-to-state projection and generic progress snapshot types.
- `flowProgressStore.ts` — per-run observable store with graph-init plus append/snapshot/subscribe/close semantics.
- `FlowRunnerInkView.mts` — generic ESM Ink components for rendering the latest snapshot.
- `runFlowRunnerInk.ts` — helper that lazily loads the ESM Ink view and binds a runner invocation to the store/view.
- `flowProgressState.test.ts` — deterministic reducer/store coverage.

## Current boundaries

- Seeds known Nodes/lanes before execution when a resolved Flow graph is available, so the Ink frame height is stable and events update rows in place.
- Uses canonical `FlowRunnerEvent` as the event feed.
- Consumes canonical `node-progress` events for Node-internal queue/count/message progress; queue/subtask visibility is no longer a tools-layer-only shape.
- Does not change Flow Runner execution semantics.
- Does not replace the old built-in-specific progress UI by default.
- Loads Ink lazily from an `.mts` runtime module so regular CommonJS-oriented tools do not statically transform Ink/Yoga's ESM top-level await dependency.
- Renders progress to `stderr`, leaving `stdout` available for final JSON summaries and avoiding npm/PowerShell stdout buffering hiding live TUI updates.
- Forces Ink `interactive: true` for progress mode so terminals/harnesses that do not expose `isTTY` still receive live frames instead of Ink deferring output until unmount.
- Uses fixed-height viewports with internal Node scrolling (`↑`/`↓`, `PgUp`/`PgDn`, `Home`, `End`/`f`) instead of relying on terminal scrollback during live repaints.
- Labels the Node graph viewport with generic sections such as `Setup / prefix`, `Lane: <id>`, `Join / finalization`, and `Flow: <path>` so the planned graph is readable without built-in-specific panels.
