# Agent execution

Agent execution owns the seams that invoke model-backed or harness-backed agents from Flow/Node code.

## Validated skill-backed execution

Agent skill-backed Nodes should use `executeValidatedSkillBackedNode(...)` instead of calling `executeSkillBackedNodeSession(...)` directly.

Default behavior:

1. Run the skill-backed agent primitive normally.
2. Validate the recovered output artifacts with the Node-owned validator.
3. If validation fails, write attempt artifacts and retry with failure context.
4. Retry up to two times by default (`maxRetries: 2`, three attempts total).
5. Write `skill-healing-summary.json` with clean/repaired/final-failure telemetry.

A retry is not a blind rerun. The helper prepends generic failure-healing instructions and adds a retry-context input artifact containing prior validation issues, raw output paths, output artifact metadata, and prompt paths when available. Agents are instructed to fix formatting/schema/contract issues without repeating full work when possible, while still allowing a full rerun when needed.

Stable per-Node artifact layout:

```text
<node-run>/skill-attempts/
  attempt-001/
    prompt.md
    raw-output.txt
    output-artifacts.json
    validation.json
    failure-context.md
  attempt-002/
    retry-context.md
    prompt.md
    raw-output.txt
    output-artifacts.json
    validation.json
<node-run>/skill-healing-summary.json
```

`skill-healing-summary.json` reports one of:

- `completed_clean`
- `completed_after_retry`
- `failed_after_retries`

Frequent `completed_after_retry` results are still a fragility signal: the Flow may pass, but the Node/prompt/contract needed help.

## Direct primitive

`executeSkillBackedNodeSession(...)` remains the low-level primitive used by the validated helper and focused tests. Built-in agent Nodes should not call it directly unless a guard-test exemption documents why the default healing loop is unsafe or intentionally replaced by a custom repair mechanism.

## Harness observability (`agentRunEvents.ts`)

Every harness session writes a Node observation directory (`beginNodeObservation`) and, for the Codex and Claude Code harnesses, projects its native stream into harness-neutral **run events** while the run is in progress:

```text
<observation-root>/<runId>/<timestamp>-<nodeId>-<id>/
  prompt.md            exact prompt sent
  input.json           harness, cwd, model, args, timeout
  events.ndjson        raw harness events (Codex: verbatim; Claude Code: normalized type/delta records)
  run-events.ndjson    projected AgentRunEvents (one readable step per line)
  summary.json         status, token usage, counts, warnings, runEventCount
  raw-output.md        final agent text (success; also kept on contract failures)
  structured-output.json  parsed answer, when an outputSchema was given
  output-schema.json   the schema sent, when one was given
  failure.json         reason, failureClass + bounded stderr tail (failure)
  stderr.txt           bounded stderr tail (Codex)
  response.json, thinking.md  provider response and reasoning text (Ollama)
```

An `AgentRunEvent` is `{seq, at, harness, kind, phase?, itemId?, summary, detail?}`. `kind` is one of `session`, `turn`, `message`, `reasoning`, `command`, `file_change`, `tool`, `web_search`, `todo`, `usage`, `error`, `result`, `other`; `phase` is `started`/`updated`/`completed`/`failed`. `itemId` joins a started step to its completion. `detail` is bounded (`boundedDetail`) so one event never carries a whole file or log. Pass `onRunEvent` to stream steps to a UI or database; a sink that throws or rejects never stops the agent.

Token accounting is reported as `AgentTokenUsage` (`inputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens`) regardless of harness.

Failures throw `AgentRunError` with `reason` (`timeout`, `aborted`, `exit`, `spawn`, `http`, `empty-output`, `truncated`, `invalid-output`), `failureClass`, `observationDir`, `exitCode`, a bounded `stderrTail`, usage so far, and for contract failures the unreadable `rawText`. The Codex, Claude Code and Ollama harnesses accept `signal` and `timeoutMs`; on POSIX the CLIs run in their own process group and are killed with everything they started.

## Structured replies and failure classes

Pass `outputSchema` to the Claude Code, Codex or Ollama harness to have the provider constrain the answer, and read the parsed value from `result.structured`. Each harness sends the schema the provider's own way: Claude Code `--json-schema` (the answer comes from the `result` event's `structured_output`), Codex `--output-schema`, and Ollama `format` or a single `reply` tool (see below). Do not ask for JSON in the prompt and parse prose: that is the failure this exists to remove.

`readStructuredReply(rawText, provided?)` is the shared reader. It takes the provider's parsed object when there is one, otherwise exactly one JSON value (one surrounding code fence is allowed). Prose around the JSON is rejected rather than searched, so a broken contract is visible instead of silently repaired.

Every failed call carries a `failureClass`, written to `failure.json` and `summary.json`:

| Class | Meaning | Reasons |
|---|---|---|
| `transport` | The call failed before the model's judgement could be seen | `timeout`, `aborted`, `exit`, `spawn`, `http`, `empty-output`, `truncated` |
| `contract` | A reply came back but could not be read as the requested structure | `invalid-output` |
| `node` | The reply was readable and the Node's own check rejected it | any error that is not an `AgentRunError` |

`classifyAgentFailure(error)` returns the class for anything a Node catches. Only `node` failures say anything about the model's reasoning, so report transport and contract counts first when you compare models or prompts. This classifies single model calls; it is not a Flow recovery taxonomy, which `flow-runner/intent-contracts.md` still leaves out.

## Ollama harness (`ollamaAgentCore.ts`)

`executeOllamaChatNodeSession({model, prompt, system?, outputSchema?, structuredVia?, options?, think?}, deps)` makes one `POST <host>/api/chat` call with `stream: false`. The host comes from `deps.host`, then `OLLAMA_HOST`, then `http://localhost:11434`; `deps.apiKey` or `OLLAMA_API_KEY` is sent as a bearer token and never written to disk. It returns `rawText`, `structured`, `structuredVia`, `thinking`, `doneReason`, `tokenUsage` and `observationDir`. There are no tools: the caller owns any lookup loop.

An empty answer throws `empty-output` and a `done_reason` of `length` throws `truncated`, both with how much reasoning text was produced, so an empty reply can be told apart from a model that spent its budget thinking.

`structuredVia` chooses how `outputSchema` is sent. `format` uses Ollama's constrained decoding, which local Ollama enforces. `tool` offers one `reply` tool whose parameters are the schema and reads the answer from its call arguments. Ollama Cloud accepted `format` and `response_format` but ignored both for gemma4:31b, glm-5.3-flash and gpt-oss:120b on 2026-11-28, while gemma4:31b returned the tool call in 5 of 5 tries. `auto`, the default, uses `tool` for `https://ollama.com` and `format` elsewhere. Tool arguments are shaped by the model rather than enforced by decoding, so validate them against Node rules.

## Codex harness (`codexAgentCore.ts`)

`executeCodexAgentNodeSession({cwd, prompt, model?, execArgs?, outputSchema?}, deps)` runs `codex exec --json --output-last-message <obs>/last-message.txt [--output-schema …] [--model …] …execArgs -`, sends the prompt on stdin, and returns the final message plus `threadId`, `tokenUsage`, `turnCount`, `commandCount`, `failedCommandCount`, `fileChanges`, `toolCallCount`, `warnings`, and `observationDir`.

Sandboxing is the caller's decision: bagelwerk adds no permission defaults. Put sandbox mode, permission profiles, approval policy, provider retry settings and `-C` in `execArgs`, and pass a minimal `env` for the child. `execArgs` may not contain `--json`, `--output-last-message`/`-o`, or `--output-schema`; the harness owns those. `deps.observationRoot` sets the artifact root without adding variables to the child environment. `CODEX_PATH` overrides the binary.

The event projection follows `codex-rs/exec/src/exec_events.rs` (`thread.*`, `turn.*`, `item.*` with `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, `error`). Stream `error` events are recorded as warnings; the exit code and `turn.failed` decide whether the run failed, and the failure message uses the stream's own error text rather than a stderr dump.

## Claude Code harness additions

`executeClaudeCodeAgentNodeSession` keeps its existing contract and adds: `dontAsk` permission mode (deny anything not pre-approved, for unattended scoped runs), `disallowedTools`, `extraArgs` (for example `--settings <json>` with a sandbox block, `--strict-mcp-config`), `deps.signal`, `deps.timeoutMs`, `deps.observationRoot`, `deps.onRunEvent`, native result fields `tokenUsage`, `costUsd`, `numTurns`, `sessionId`, `resultText`, and `outputSchema` → `structured` (see above). The prompt is placed after `--` so it can never be parsed as a tool name. `extraArgs` may not contain `--json-schema`; pass `outputSchema`. Claude Code's StructuredOutput tool works under `dontAsk` without being added to `allowedTools`.
