# Recovery observations and retained evidence

This contract implements the endorsed Infinity Crew intent records below. These
are reporting and evidence requirements, not an unsuccessful-outcome taxonomy.
A Node result (`completed`, `failed`, `timed_out`) remains separate from an action
(retry, wait, continue) and from the end of a particular run or supervisor attempt.

| Intent ID | Behavior and implementation | Deterministic check |
| --- | --- | --- |
| 376b9109-fbb7-4cea-a591-43ce6833fe71 | Actual supervisor retries report reason, attempt and limit in `execution-state`; graph revisits after unsuccessful results report another attempt. A `retry_node` request alone does not claim an executed retry. | `../flow-supervisor/runSupervisedFlow.test.ts`, `intentAlignment.test.ts`, `../nodes/graph/runNodeGraph.test.ts` |
| 7e7bfc7e-0e80-4c44-a6d3-f9f28f534018 | Human acknowledgement emits `waiting_for_input` through the injected runtime sink before asking. One state describes the input and resumption action. | `intentAlignment.test.ts` gated interaction; no live notifications |
| 6742b5b0-13bf-46e4-bfd4-a3073b8d55eb | Existing partial continuation remains allowed. Configured failure transitions emit `continuing_partial`. The low-level parallel runner retains its continuation reason and unsuccessful Node paths. | `intentAlignment.test.ts`, `../flows/generic/queue-processor/queueProcessorFlow.test.ts` |
| 1a91ec83-68f8-4ce1-b099-a6b9270c2549 | Ended unresolved Flow attempts and exhausted/observe-only supervisor runs identify their scope and next action. A Flow attempt can end while its supervisor still retries. | `intentAlignment.test.ts`, `../flow-supervisor/runSupervisedFlow.test.ts` |
| b4c5a5e1-40b5-4c39-9d7b-7c5e171a7a96 | Missing accepted inputs and workspace guards emit `start_blocked` with the prerequisite and remediation. | The same integration suites assert the handler/run did not start. |
| 71c45f58-0348-4cde-9089-13cb4b9ff3e7 | Recovery retains original unsuccessful results/output and its rationale in history; canonical run records persist this alongside events and artifact observations. | `intentAlignment.test.ts` reads records back after recovery; graph tests inspect original payload. |
| 9561c726-5130-4ab8-bdc1-8b149e047f76 | A successful join cannot make unsuccessful branch outputs disappear: queue items/aggregate expose `partial` and counts, without disabling the join or invoking stop-on-first-failure for tolerated partial work. | Queue tests exercise failed, timed-out and successful branches plus subsequent work. |

## Compatibility and limits

- `execution-state` is an observation event with a `node`, `flow` or `supervisor`
  scope, reason and nextAction. It does not change Node status or schedule work.
  The existing event stream/record mirror and progress view retain/display it.
- `runQueueProcessorFlow` adds `partial` to item/aggregate statuses and adds a
  `partial` count to results and progress. Callers must handle it. A failed final
  Node still reports failure; tolerated partial work does not stop the queue.
- The low-level parallel runner and canonical Flow Runner have different existing
  join policies. This change preserves them; it does not impose one universal policy.
- A successful replacement result is the existing resolver's acceptance decision.
  Original failure evidence remains available even after replacement.
- Arbitrary Node code must emit observations through the runtime sink to expose
  custom waits/retries. These tests do not prove coverage of every provider or Node.
- No cancellation, new retry scheduler, failure categories, or per-category rules
  are introduced. Timeout does not prove the underlying work has stopped.
- Direct low-level callers own persistence of returned results. Canonical runner
  tests verify file sidecars; records tests verify state payload retention and
  searchable reasons/actions through the existing PGlite store.

Run checks with `BAGELWERK_RECORDS=off node --import tsx --test
src/core/flow-runner/intentAlignment.test.ts
src/core/flow-supervisor/runSupervisedFlow.test.ts
src/core/nodes/graph/runNodeGraph.test.ts
src/core/flows/generic/queue-processor/queueProcessorFlow.test.ts` (one shell line).
