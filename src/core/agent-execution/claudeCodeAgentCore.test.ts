import assert from "node:assert/strict";
import test from "node:test";

import { resolveEffectivePermissionMode } from "./claudeCodeAgentCore";

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
