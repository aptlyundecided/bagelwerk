import assert from "node:assert/strict";
import test from "node:test";

import { AgentRunError, classifyAgentFailure, failureClassForReason, readStructuredReply, type AgentRunErrorReason } from "./agentRunEvents";

test("every harness reason maps to transport except unreadable output, which is a contract failure", () => {
  const transport: AgentRunErrorReason[] = ["timeout", "aborted", "exit", "spawn", "http", "empty-output", "truncated"];
  for (const reason of transport) assert.equal(failureClassForReason(reason), "transport", reason);
  assert.equal(failureClassForReason("invalid-output"), "contract");
});

test("classifyAgentFailure blames the Node for anything that is not a harness error", () => {
  assert.equal(classifyAgentFailure(new AgentRunError({ message: "m", harness: "codex", reason: "timeout" })), "transport");
  assert.equal(classifyAgentFailure(new AgentRunError({ message: "m", harness: "claude-code", reason: "invalid-output" })), "contract");
  assert.equal(classifyAgentFailure(new Error("cited excerpt 4 but only 2 were opened")), "node");
});

test("readStructuredReply prefers the provider's parsed object", () => {
  assert.deepEqual(readStructuredReply("ignored prose", { op: "read" }), { ok: true, value: { op: "read" } });
});

test("readStructuredReply accepts one JSON value, optionally fenced", () => {
  assert.deepEqual(readStructuredReply(' {"op":"search"} '), { ok: true, value: { op: "search" } });
  assert.deepEqual(readStructuredReply('```json\n{"op":"search"}\n```'), { ok: true, value: { op: "search" } });
});

test("readStructuredReply rejects prose around JSON and empty replies instead of guessing", () => {
  const prose = readStructuredReply('I\'ll search first. ```json {"op":"search"} ```');
  assert.equal(prose.ok, false);
  const trailing = readStructuredReply('{"op":"report"}\n\nBased on my investigation...');
  assert.equal(trailing.ok, false);
  assert.deepEqual(readStructuredReply("  "), { ok: false, issue: "the reply was empty" });
});
