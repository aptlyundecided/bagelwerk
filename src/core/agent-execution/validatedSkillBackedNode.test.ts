import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { CursorCommandInvocation, CursorCommandResult } from "./cursorAgentCore";
import { executeValidatedSkillBackedNode, type ValidatedSkillBackedNodeValidation } from "./validatedSkillBackedNode";

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "validated-skill-node-"));
  const skillDir = path.join(root, "skill");
  const cwd = path.join(root, "cwd");
  const healingRoot = path.join(root, "node-run");
  const agentArtifactsRoot = path.join(root, "agent-artifacts");
  await mkdir(skillDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(healingRoot, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# Test skill\n\nWrite the expected JSON artifact.\n", "utf8");
  return { root, skillDir, cwd, healingRoot, agentArtifactsRoot };
}

function makeCursorResponder(payloads: unknown[], prompts: string[]) {
  let call = 0;
  return async (params: CursorCommandInvocation): Promise<CursorCommandResult> => {
    prompts.push(params.prompt);
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    params.onEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: [
            "Done.\n",
            "<<<ARTIFACT:json-artifact>>>\n",
            `${JSON.stringify(payload, null, 2)}\n`,
            "<<<END_ARTIFACT>>>",
          ].join(""),
        }],
      },
    });
    return { exitCode: 0, stderr: "" };
  };
}

function baseNodeSession(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return {
    provider: "cursor",
    model: "auto",
    thinkingLevel: "medium" as const,
    allowedTools: ["write"],
    cwd: fixture.cwd,
    skillDirectory: fixture.skillDir,
    inputArtifacts: [],
    outputArtifacts: [{ label: "json artifact", relativePath: "artifact.json", responseBlockId: "json-artifact" }],
    outputTransport: "response_blocks_preferred" as const,
    agentRuntime: "cursor" as const,
  };
}

async function validateJsonArtifact(skillResult: Parameters<Parameters<typeof executeValidatedSkillBackedNode<ValidatedSkillBackedNodeValidation>>[0]["validate"]>[0]["skillResult"]): Promise<ValidatedSkillBackedNodeValidation> {
  const artifact = skillResult.outputArtifacts[0];
  if (!artifact || artifact.recoveryMethod === "missing") return { ok: false, issues: ["json artifact was not published"] };
  const parsed = JSON.parse(await readFile(artifact.path, "utf8")) as { ok?: boolean; issues?: string[] };
  return { ok: parsed.ok === true, issues: parsed.issues ?? (parsed.ok ? [] : ["artifact ok was not true"]), artifact: parsed };
}

function validateJsonText(text: string): ValidatedSkillBackedNodeValidation {
  try {
    const parsed = JSON.parse(text) as { ok?: boolean; issues?: string[] };
    return { ok: parsed.ok === true, issues: parsed.issues ?? (parsed.ok ? [] : ["artifact ok was not true"]), artifact: parsed };
  } catch (error) {
    return { ok: false, issues: [error instanceof Error ? error.message : String(error)] };
  }
}

test("judgement repair salvages a close-but-invalid result without a full rerun", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  let judgeCalls = 0;
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 2 },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: false, issues: ["schema mismatch"] }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
      repair: {
        judge: () => { judgeCalls += 1; return { action: "repair", json: JSON.stringify({ ok: true }) }; },
        revalidate: (text) => validateJsonText(text),
      },
    });

    assert.equal(result.validation.ok, true);
    assert.equal(judgeCalls, 1);
    assert.equal(prompts.length, 1, "main session must not be re-run when repair succeeds");
    assert.ok(result.attempts.some((attempt) => attempt.kind === "repair" && attempt.status === "valid"));
    assert.ok(result.summary.attempts.some((attempt) => attempt.kind === "repair"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("judgement repair returns rerun when data is missing -> falls through to retry (no fabrication)", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  let judgeCalls = 0;
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 2 },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: false, issues: ["missing evidence"] }, { ok: true }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
      repair: {
        judge: () => { judgeCalls += 1; return { action: "rerun" }; },
        revalidate: (text) => validateJsonText(text),
      },
    });

    assert.equal(result.validation.ok, true);
    assert.equal(judgeCalls, 1);
    assert.equal(prompts.length, 2, "rerun path must re-run the full node");
    assert.ok(!result.attempts.some((attempt) => attempt.kind === "repair"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("judgement repair whose output still fails revalidation falls through to retry", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 2 },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: false, issues: ["bad"] }, { ok: true }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
      repair: {
        // Repair returns something that STILL fails the same schema -> must not be accepted.
        judge: () => ({ action: "repair", json: JSON.stringify({ ok: false, issues: ["still invalid"] }) }),
        revalidate: (text) => validateJsonText(text),
      },
    });

    assert.equal(result.validation.ok, true, "recovered via the normal retry, not the bad repair");
    assert.equal(prompts.length, 2);
    assert.ok(!result.attempts.some((attempt) => attempt.kind === "repair"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("judgement repair is bounded by maxRepairs", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  let judgeCalls = 0;
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 1 },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: false, issues: ["a"] }, { ok: false, issues: ["b"] }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
      repair: {
        maxRepairs: 1,
        judge: () => { judgeCalls += 1; return { action: "repair", json: JSON.stringify({ ok: false }) }; },
        revalidate: (text) => validateJsonText(text),
      },
    });

    assert.equal(result.validation.ok, false);
    assert.equal(judgeCalls, 1, "repair attempted at most maxRepairs times across the run");
    assert.equal(prompts.length, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("executeValidatedSkillBackedNode records clean success without retries", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: true }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
    });

    assert.equal(result.validation.ok, true);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.summary.status, "completed_clean");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.includes("This is a retry of a failed agent-backed Node."), false);
    assert.equal(JSON.parse(await readFile(path.join(fixture.healingRoot, "skill-healing-summary.json"), "utf8")).status, "completed_clean");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("executeValidatedSkillBackedNode retries with failure context and recovers", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([
          { ok: false, issues: ["schema mismatch"] },
          { ok: true },
        ], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
    });

    assert.equal(result.validation.ok, true);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.summary.status, "completed_after_retry");
    assert.equal(result.summary.recovered, true);
    assert.match(prompts[1]!, /This is a retry of a failed agent-backed Node/);
    assert.match(prompts[1]!, /skill healing retry context/);
    assert.match(await readFile(path.join(fixture.healingRoot, "skill-attempts", "attempt-002", "retry-context.md"), "utf8"), /schema mismatch/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("executeValidatedSkillBackedNode supports override policy that disables retry", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 2, enabled: false },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([{ ok: false, issues: ["do not retry"] }, { ok: true }], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
    });

    assert.equal(result.validation.ok, false);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.summary.status, "failed_after_retries");
    assert.equal(prompts.length, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("executeValidatedSkillBackedNode records final failure after retries", async () => {
  const fixture = await makeFixture();
  const prompts: string[] = [];
  try {
    const result = await executeValidatedSkillBackedNode({
      session: baseNodeSession(fixture),
      healingArtifactRoot: fixture.healingRoot,
      retryPolicy: { maxRetries: 1 },
      deps: {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: fixture.agentArtifactsRoot },
        runCursorCommand: makeCursorResponder([
          { ok: false, issues: ["first failure"] },
          { ok: false, issues: ["second failure"] },
        ], prompts),
      },
      validate: ({ skillResult }) => validateJsonArtifact(skillResult),
    });

    assert.equal(result.validation.ok, false);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.summary.status, "failed_after_retries");
    assert.deepEqual(result.summary.attempts.map((attempt) => attempt.issues[0]), ["first failure", "second failure"]);
    assert.equal(prompts.length, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
