import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeSkillBackedNodeSession, normalizeAgentRuntime } from "./skillBackedCore";
import type { CursorCommandInvocation, CursorCommandResult } from "./cursorAgentCore";

test("normalizeAgentRuntime rejects removed runtimes (agy/jules/antigravity)", () => {
  for (const removed of ["agy", "jules", "antigravity", "AGY", "Jules"]) {
    assert.equal(normalizeAgentRuntime(removed), undefined, `${removed} must be unsupported`);
  }
});

test("normalizeAgentRuntime resolves the supported runtimes", () => {
  assert.equal(normalizeAgentRuntime("pi"), "pi");
  assert.equal(normalizeAgentRuntime("cursor"), "cursor");
  assert.equal(normalizeAgentRuntime("claude-code"), "claude-code");
  assert.equal(normalizeAgentRuntime("opencode"), "opencode");
});

test("skill-backed response block pointer does not overwrite an existing filesystem artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-backed-pointer-artifact-"));
  const skillDir = path.join(root, "skill");
  const cwd = path.join(root, "cwd");
  const agentArtifactsRoot = path.join(root, "agent-artifacts");
  await mkdir(skillDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# Test skill\n\nWrite the expected JSON artifact.\n", "utf8");

  try {
    const runCursorCommand = async (params: CursorCommandInvocation): Promise<CursorCommandResult> => {
      const expectedPath = params.prompt.match(/json artifact \| path: ([^|]+) \| required:/)?.[1]?.trim();
      assert.ok(expectedPath, "expected output artifact path should be present in the prompt");
      await writeFile(expectedPath, `${JSON.stringify({ ok: true }, null, 2)}\n`, "utf8");
      params.onEvent({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{
            type: "text",
            text: [
              "Done.\n",
              "<<<ARTIFACT:json-artifact>>>\n",
              `See persisted file: \`${expectedPath}\`\n`,
              "<<<END_ARTIFACT>>>",
            ].join(""),
          }],
        },
      });
      return { exitCode: 0, stderr: "" };
    };

    const result = await executeSkillBackedNodeSession(
      {
        provider: "cursor",
        model: "auto",
        thinkingLevel: "medium",
        allowedTools: ["write"],
        cwd,
        skillDirectory: skillDir,
        inputArtifacts: [],
        outputArtifacts: [{ label: "json artifact", relativePath: "artifact.json", responseBlockId: "json-artifact" }],
        outputTransport: "response_blocks_preferred",
        agentRuntime: "cursor",
      },
      {
        env: { ...process.env, BAGELWERK_AGENT_ARTIFACTS_ROOT: agentArtifactsRoot },
        runCursorCommand,
      },
    );

    const artifact = result.outputArtifacts[0];
    assert.ok(artifact);
    assert.equal(await readFile(artifact.path, "utf8"), `${JSON.stringify({ ok: true }, null, 2)}\n`);
    assert.equal(result.recoveredArtifactCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
