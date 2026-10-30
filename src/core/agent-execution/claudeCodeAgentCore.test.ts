import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentRunEvent } from "./agentRunEvents";
import {
  buildClaudeCodeArgs,
  executeClaudeCodeAgentNodeSession,
  parseClaudeCodeNativeUsage,
  projectClaudeCodeEvent,
  resolveEffectivePermissionMode,
  type ClaudeCodeStreamEvent,
} from "./claudeCodeAgentCore";

// Regression for OI-0096/OI-0033: the Claude Code permission mode resolves
// explicit input -> CLAUDE_CODE_PERMISSION_MODE -> bypassPermissions default.
// (gpt-5.5's review of PR #16 flagged that this — including a security-relevant
// default — had no test.)

test("explicit permission mode wins over env and default", () => {
  assert.equal(resolveEffectivePermissionMode("plan", { CLAUDE_CODE_PERMISSION_MODE: "acceptEdits" }), "plan");
});

test("CLAUDE_CODE_PERMISSION_MODE env is used when no explicit mode is given", () => {
  assert.equal(resolveEffectivePermissionMode(undefined, { CLAUDE_CODE_PERMISSION_MODE: "acceptEdits" }), "acceptEdits");
});

test("defaults to bypassPermissions when neither explicit nor env is set", () => {
  assert.equal(resolveEffectivePermissionMode(undefined, {}), "bypassPermissions");
});

test("an invalid env value currently falls back to the default (documents current behavior)", () => {
  // NOTE: this is the behavior gpt-5.5 flagged as a smell — a mistyped stricter intent
  // silently becomes the least-restrictive default. Captured for a decision in OI-0096.
  assert.equal(resolveEffectivePermissionMode(undefined, { CLAUDE_CODE_PERMISSION_MODE: "not-a-real-mode" }), "bypassPermissions");
});

// --- Observability: projected run events, native usage, scoped args ---------------------------


const CLAUDE_EVENTS: ClaudeCodeStreamEvent[] = [
  { type: "system", subtype: "init", session_id: "sess-1", model: "claude-sonnet-5", permissionMode: "dontAsk", tools: ["Read", "Bash"] },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Checking styles." }, { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "rg -n nes.min.css" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "main.jsx:3:import './vendor/nes.min.css';" }] } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tu_2", name: "Read", input: { file_path: "/work/style.css" } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_2", is_error: true, content: [{ type: "text", text: "Permission denied" }] }] } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "{\"outcome\":\"blocked\"}" }] } },
  { type: "result", subtype: "success", is_error: false, num_turns: 3, duration_ms: 4200, total_cost_usd: 0.0123, result: "{\"outcome\":\"blocked\"}", usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 40 } },
] as ClaudeCodeStreamEvent[];

test("projectClaudeCodeEvent joins tool results to their tool_use and labels failures", () => {
  const names = new Map<string, string>();
  const summaries = CLAUDE_EVENTS.flatMap((event) => projectClaudeCodeEvent(event, names)).map((draft) => `${draft.kind}/${draft.phase}: ${draft.summary}`);
  assert.deepEqual(summaries, [
    "session/started: Claude Code session · claude-sonnet-5 · dontAsk",
    "message/completed: Checking styles.",
    "command/started: $ rg -n nes.min.css",
    "command/completed: Bash done: main.jsx:3:import './vendor/nes.min.css';",
    "tool/started: Read: /work/style.css",
    "tool/failed: Read failed: Permission denied",
    'message/completed: {"outcome":"blocked"}',
    "usage/completed: Result success · 3 turns · 1,000 in · 900 cached · 40 out · $0.0123",
  ]);
});

test("parseClaudeCodeNativeUsage maps Anthropic usage fields", () => {
  assert.deepEqual(parseClaudeCodeNativeUsage({ input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 40 }), {
    inputTokens: 1000, cachedInputTokens: 900, cacheWriteTokens: 50, outputTokens: 40,
  });
});

test("buildClaudeCodeArgs ends tool lists before the prompt and keeps caller sandbox args", () => {
  const args = buildClaudeCodeArgs({
    model: "claude-sonnet-5",
    permissionMode: "dontAsk",
    allowedTools: ["Read(//work/**)", "Bash"],
    disallowedTools: ["WebFetch"],
    extraArgs: ["--settings", "{\"sandbox\":{\"enabled\":true}}"],
    prompt: "--not-a-flag",
  });
  assert.deepEqual(args.slice(-6), ["--disallowedTools", "WebFetch", "--settings", "{\"sandbox\":{\"enabled\":true}}", "--", "--not-a-flag"]);
  assert(args.includes("dontAsk"));
});

test("sessions stream projected events and record native tokens, cost and the final result", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bw-claude-"));
  try {
    const live: AgentRunEvent[] = [];
    let seen: { signal?: AbortSignal; timeoutMs?: number; extraArgs?: string[] } = {};
    const result = await executeClaudeCodeAgentNodeSession(
      { provider: "anthropic", model: "claude-sonnet-5", thinkingLevel: "off", allowedTools: ["Read"], cwd: dir, prompt: "p", permissionMode: "dontAsk", extraArgs: ["--strict-mcp-config"] },
      {
        env: {},
        observationRoot: path.join(dir, "obs"),
        timeoutMs: 1000,
        onRunEvent: (event) => { live.push(event); },
        runClaudeCodeCommand: async (invocation) => {
          seen = { signal: invocation.signal, timeoutMs: invocation.timeoutMs, extraArgs: invocation.extraArgs };
          for (const event of CLAUDE_EVENTS) invocation.onEvent(event);
          return { exitCode: 0, stderr: "" };
        },
      },
    );
    assert.equal(seen.timeoutMs, 1000);
    assert.deepEqual(seen.extraArgs, ["--strict-mcp-config"]);
    assert.equal(result.resultText, '{"outcome":"blocked"}');
    assert.equal(result.costUsd, 0.0123);
    assert.equal(result.numTurns, 3);
    assert.equal(result.sessionId, "sess-1");
    assert.deepEqual(result.tokenUsage, { inputTokens: 1000, cachedInputTokens: 900, cacheWriteTokens: 50, outputTokens: 40, reasoningOutputTokens: 0, totalTokens: 1090 });
    assert.equal(live[live.length - 1]?.kind, "result");
    const recorded = (await readFile(path.join(result.observationDir!, "run-events.ndjson"), "utf8")).trim().split("\n");
    assert.equal(recorded.length, live.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a timed-out Claude Code run surfaces reason=timeout with its observation directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bw-claude-timeout-"));
  try {
    const error = await executeClaudeCodeAgentNodeSession(
      { provider: "anthropic", model: "m", thinkingLevel: "off", allowedTools: [], cwd: dir, prompt: "p" },
      { env: {}, observationRoot: path.join(dir, "obs"), timeoutMs: 10, runClaudeCodeCommand: async () => ({ exitCode: 137, stderr: "", timedOut: true }) },
    ).then(() => undefined, (failure: unknown) => failure as { reason?: string; observationDir?: string });
    assert.equal(error?.reason, "timeout");
    assert(error?.observationDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
