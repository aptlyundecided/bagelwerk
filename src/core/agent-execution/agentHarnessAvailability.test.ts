import assert from "node:assert/strict";
import test from "node:test";

import { detectAgentHarness, type HarnessProbeResult } from "./agentHarnessAvailability";

const okProbe = (version: string) => async (): Promise<HarnessProbeResult> => ({ ok: true, stdout: version, stderr: "" });
const enoentProbe = async (): Promise<HarnessProbeResult> => ({ ok: false, stdout: "", stderr: "", code: "ENOENT" });

test("cursor present with CURSOR_API_KEY: installed, proceeds, auth present, no guidance", async () => {
  const r = await detectAgentHarness(
    { runtime: "cursor", env: { CURSOR_API_KEY: "x" } },
    { probeVersion: okProbe("cursor-agent 1.2.3") },
  );
  assert.equal(r.installed, true);
  assert.equal(r.shouldProceed, true);
  assert.equal(r.version, "cursor-agent 1.2.3");
  assert.equal(r.authSignal, "present");
  assert.deepEqual(r.installGuidance, []);
  assert.deepEqual(r.loginGuidance, []);
});

test("cursor present without api key: auth advisory (unknown) but still proceeds", async () => {
  const r = await detectAgentHarness({ runtime: "cursor", env: {} }, { probeVersion: okProbe("v1") });
  assert.equal(r.shouldProceed, true);
  assert.equal(r.authSignal, "unknown");
  assert.ok(r.loginGuidance.length > 0, "should surface login guidance when auth is unknown");
});

test("cursor missing (ENOENT): not installed, gated, install guidance present", async () => {
  const r = await detectAgentHarness({ runtime: "cursor", env: {} }, { probeVersion: enoentProbe });
  assert.equal(r.installed, false);
  assert.equal(r.shouldProceed, false);
  assert.equal(r.version, null);
  assert.ok(r.installGuidance.length > 0, "missing CLI should yield install guidance");
});

test("opencode with OPENROUTER_API_KEY: auth present", async () => {
  const r = await detectAgentHarness(
    { runtime: "opencode", env: { OPENROUTER_API_KEY: "k" } },
    { probeVersion: okProbe("opencode 9") },
  );
  assert.equal(r.authSignal, "present");
  assert.equal(r.shouldProceed, true);
});

test("claude-code resolves the probed command from CLAUDE_CODE_PATH override", async () => {
  let probed = "";
  const r = await detectAgentHarness(
    { runtime: "claude-code", env: { CLAUDE_CODE_PATH: "C:/x/claude.exe" } },
    {
      probeVersion: async (command: string): Promise<HarnessProbeResult> => {
        probed = command;
        return { ok: true, stdout: "2.1.160 (Claude Code)", stderr: "" };
      },
    },
  );
  assert.equal(probed, "C:/x/claude.exe");
  assert.equal(r.resolvedCommand, "C:/x/claude.exe");
  assert.equal(r.cliName, "claude");
});

test("pi: now a CLI — probes pi and hard-gates on presence; auth advisory", async () => {
  let probedCommand = "";
  const present = await detectAgentHarness(
    { runtime: "pi", env: {} },
    {
      probeVersion: async (command: string): Promise<HarnessProbeResult> => {
        probedCommand = command;
        return { ok: true, stdout: "0.78.0", stderr: "" };
      },
    },
  );
  assert.equal(present.isCli, true);
  assert.equal(present.cliName, "pi");
  assert.equal(present.installed, true);
  assert.equal(present.shouldProceed, true);
  assert.equal(present.authSignal, "unknown", "pi owns its own provider auth; advisory only");
  assert.equal(probedCommand, "pi", "pi is probed by default command name");
});

test("pi: missing CLI hard-gates the run with install guidance", async () => {
  const missing = await detectAgentHarness({ runtime: "pi", env: {} }, { probeVersion: enoentProbe });
  assert.equal(missing.installed, false);
  assert.equal(missing.shouldProceed, false);
  assert.ok(missing.installGuidance.length > 0);
});

test("pi: resolves command from PI_AGENT_PATH override", async () => {
  let probedCommand = "";
  await detectAgentHarness(
    { runtime: "pi", env: { PI_AGENT_PATH: "C:/x/pi.cmd" } },
    {
      probeVersion: async (command: string): Promise<HarnessProbeResult> => {
        probedCommand = command;
        return { ok: true, stdout: "0.78.0", stderr: "" };
      },
    },
  );
  assert.equal(probedCommand, "C:/x/pi.cmd");
});
