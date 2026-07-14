import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentHarnessCheckNode } from "./index";
import type { HarnessProbeResult } from "../../../agent-execution/agentHarnessAvailability";

const okProbe = async (): Promise<HarnessProbeResult> => ({ ok: true, stdout: "cursor-agent 1.0.0", stderr: "" });
const enoentProbe = async (): Promise<HarnessProbeResult> => ({ ok: false, stdout: "", stderr: "", code: "ENOENT" });

function inputWith(runtime: string, runDir?: string, env: Record<string, string> = {}): unknown {
  return {
    userInput: { env },
    runtime: {
      ...(runDir ? { record: { runDir } } : {}),
      launchSnapshot: { executionPolicy: { agent: { runtime } } },
    },
  };
}

test("resolves runtime from executionPolicy and gates completed when the harness is present", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-node-ok-"));
  try {
    const res = await runAgentHarnessCheckNode({
      params: { artifactBaseName: "harness-status" },
      input: inputWith("cursor", dir),
      deps: { probeVersion: okProbe },
    });
    assert.equal(res.status, "completed");
    assert.equal(res.payload?.finalVerdict, "harness_ready");
    assert.equal(res.payload?.availability.runtime, "cursor");
    assert.equal(res.payload?.shouldProceed, true);
    assert.equal(res.payload?.artifactFiles.length, 2);
    const json = JSON.parse(await readFile(path.join(dir, "harness-status.json"), "utf8"));
    assert.equal(json.installed, true);
    assert.equal(json.runtime, "cursor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gates failed (mandatory resolve) when the selected harness CLI is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-node-missing-"));
  try {
    const res = await runAgentHarnessCheckNode({
      params: { artifactBaseName: "harness-status" },
      input: inputWith("cursor", dir),
      deps: { probeVersion: enoentProbe },
    });
    assert.equal(res.status, "failed");
    assert.equal(res.payload?.finalVerdict, "harness_missing");
    assert.equal(res.payload?.shouldProceed, false);
    assert.ok((res.note ?? "").length > 0, "failure note should carry guidance");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit runtime param overrides executionPolicy", async () => {
  let probed = "";
  const dir = await mkdtemp(path.join(tmpdir(), "harness-node-override-"));
  try {
    const res = await runAgentHarnessCheckNode({
      params: { runtime: "claude-code", artifactBaseName: "harness-status" },
      input: inputWith("cursor", dir, { CLAUDE_CODE_PATH: "C:/x/claude.exe" }),
      deps: {
        probeVersion: async (command: string): Promise<HarnessProbeResult> => {
          probed = command;
          return { ok: true, stdout: "2.1.160", stderr: "" };
        },
      },
    });
    assert.equal(res.payload?.availability.runtime, "claude-code");
    assert.equal(probed, "C:/x/claude.exe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolves runtime from the real CLI input shape (userInput, no launchSnapshot)", async () => {
  // Some external CLI inputs build top-level userInput.agentRuntime + userInput.executionPolicy
  // rather than runtime.launchSnapshot.executionPolicy. The node must still resolve it.
  const dir = await mkdtemp(path.join(tmpdir(), "harness-node-userinput-"));
  try {
    const res = await runAgentHarnessCheckNode({
      params: { artifactBaseName: "harness-status" },
      input: {
        userInput: { env: {}, agentRuntime: "opencode", executionPolicy: { agent: { runtime: "opencode" } } },
        runtime: { record: { runDir: dir } },
      },
      deps: { probeVersion: okProbe },
    });
    assert.equal(res.payload?.availability.runtime, "opencode");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emits no artifacts when no run directory is available", async () => {
  const res = await runAgentHarnessCheckNode({
    params: { artifactBaseName: "harness-status" },
    input: inputWith("cursor"), // no runDir
    deps: { probeVersion: okProbe },
  });
  assert.equal(res.status, "completed");
  assert.deepEqual(res.payload?.artifactFiles, []);
});
