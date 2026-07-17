import assert from "node:assert/strict";
import test from "node:test";

import { piCliArgsForInvocation } from "./piAgentCore";

test("pi CLI args forward concrete providers while preserving pi and auto defaults", () => {
  assert.deepEqual(piCliArgsForInvocation({ provider: "openrouter", model: "gpt-5", allowedTools: ["read", " write "] }), [
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--provider",
    "openrouter",
    "--model",
    "gpt-5",
    "--tools",
    "read,write",
  ]);

  assert.deepEqual(piCliArgsForInvocation({ provider: "pi", model: "auto", allowedTools: [] }), [
    "--print",
    "--mode",
    "json",
    "--no-session",
  ]);

  assert.deepEqual(piCliArgsForInvocation({ provider: " auto ", model: " gemma ", allowedTools: [] }), [
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--model",
    "gemma",
  ]);
});
