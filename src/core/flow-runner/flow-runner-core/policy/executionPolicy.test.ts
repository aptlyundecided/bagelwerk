import assert from "node:assert/strict";
import test from "node:test";

import { executionPolicyOverlayFromInput, resolveExecutionPolicyOverlay } from "./executionPolicy";

test("executionPolicyOverlayFromInput parses input-embedded run overlay", () => {
  assert.deepEqual(executionPolicyOverlayFromInput({
    executionPolicy: {
      agent: { provider: "openai-codex", model: "gpt-5.4" },
      paths: {
        "root.review": { agent: { model: "gpt-5.4-high" } },
        "root.empty": {},
      },
    },
  }), {
    agent: { provider: "openai-codex", model: "gpt-5.4" },
    paths: {
      "root.review": { agent: { model: "gpt-5.4-high" } },
    },
  });
});

test("resolveExecutionPolicyOverlay prefers explicit params over input policy", () => {
  assert.deepEqual(resolveExecutionPolicyOverlay({
    input: { executionPolicy: { agent: { provider: "input-provider" } } },
    executionPolicyOverlay: { agent: { provider: "param-provider" } },
  }), { agent: { provider: "param-provider" } });
});

test("executionPolicyOverlayFromInput ignores non-object inputs", () => {
  assert.equal(executionPolicyOverlayFromInput(undefined), undefined);
  assert.equal(executionPolicyOverlayFromInput(null), undefined);
  assert.equal(executionPolicyOverlayFromInput([]), undefined);
});
