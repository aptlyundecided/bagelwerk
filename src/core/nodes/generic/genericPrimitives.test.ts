import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runReadJsonNode, runReadTextNode, runWriteJsonNode, runWriteTextNode } from "./file-io";
import { runRunCommandNode } from "./run-command";
import { runAgentJsonNode, runAgentMarkdownNode } from "./agent-io";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "generic-primitives-"));
}
const inputFor = (runDir: string) => ({ runtime: { record: { runDir }, sessionId: "test" } });
const fakeAgent = (rawText: string) => async () => ({ rawText, provider: "test", model: "stub" });

// Build an input whose preflight exposes accepted upstream artifacts (each backed by a real file).
async function inputWithAccepted(runDir: string, files: Record<string, string>) {
  const dependencies = [];
  for (const [relativePath, content] of Object.entries(files)) {
    const acceptedPath = path.join(runDir, "__accepted__", relativePath);
    await mkdir(path.dirname(acceptedPath), { recursive: true });
    await writeFile(acceptedPath, content, "utf8");
    dependencies.push({ fromQualifiedPath: `producer.${relativePath}`, relativePath, acceptedPath, exists: true, required: true });
  }
  return { runtime: { record: { runDir }, sessionId: "test", preflight: { dependencies } } };
}

test("write-text emits a text artifact", async () => {
  const runDir = await tmp();
  try {
    const result = await runWriteTextNode({ params: { content: "hello world", artifactPath: "note.txt" }, input: inputFor(runDir) });
    assert.equal(result.status, "completed");
    assert.equal(await readFile(path.join(runDir, "note.txt"), "utf8"), "hello world\n");
    assert.equal(result.payload?.artifactFiles[0]?.relativePath, "note.txt");
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("write-json serializes a value to a JSON artifact", async () => {
  const runDir = await tmp();
  try {
    const result = await runWriteJsonNode({ params: { value: { a: 1, b: [2, 3] }, artifactPath: "data.json" }, input: inputFor(runDir) });
    assert.equal(result.status, "completed");
    assert.deepEqual(JSON.parse(await readFile(path.join(runDir, "data.json"), "utf8")), { a: 1, b: [2, 3] });
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("read-text ingests an external file as an artifact", async () => {
  const runDir = await tmp();
  const src = path.join(runDir, "source.txt");
  try {
    await writeFile(src, "ingested content", "utf8");
    const result = await runReadTextNode({ params: { sourcePath: src }, input: inputFor(runDir) });
    assert.equal(result.status, "completed");
    assert.equal(result.payload?.artifactPath, "source.txt");
    assert.match(await readFile(path.join(runDir, "source.txt"), "utf8"), /ingested content/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("read-json parses then re-emits; bad JSON fails cleanly", async () => {
  const runDir = await tmp();
  const good = path.join(runDir, "good.json");
  const bad = path.join(runDir, "bad.json");
  try {
    await writeFile(good, '{"x":42}', "utf8");
    await writeFile(bad, "not json", "utf8");
    const ok = await runReadJsonNode({ params: { sourcePath: good }, input: inputFor(runDir) });
    assert.equal(ok.status, "completed");
    assert.deepEqual(ok.payload?.value, { x: 42 });
    const fail = await runReadJsonNode({ params: { sourcePath: bad }, input: inputFor(runDir) });
    assert.equal(fail.status, "failed");
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("run-command writes stdout and maps exit code to status", async () => {
  const runDir = await tmp();
  try {
    const ok = await runRunCommandNode({
      params: { command: "echo", args: ["hi"], artifactPath: "out.txt", timeoutMs: 1000, allowNonZeroExit: false },
      input: inputFor(runDir),
      commandRunner: async () => ({ exitCode: 0, stdout: "hi\n", stderr: "" }),
    });
    assert.equal(ok.status, "completed");
    assert.match(await readFile(path.join(runDir, "out.txt"), "utf8"), /hi/);

    const fail = await runRunCommandNode({
      params: { command: "false", args: [], artifactPath: "out.txt", timeoutMs: 1000, allowNonZeroExit: false },
      input: inputFor(runDir),
      commandRunner: async () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
    });
    assert.equal(fail.status, "failed");
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("agent-markdown writes the agent reply as markdown", async () => {
  const runDir = await tmp();
  try {
    const result = await runAgentMarkdownNode({
      nodeId: "core.agent-markdown",
      params: { prompt: "say hi", artifactPath: "agent.md" },
      input: inputFor(runDir),
      runAgent: fakeAgent("# Hi\nfrom the agent"),
    });
    assert.equal(result.status, "completed");
    assert.match(await readFile(path.join(runDir, "agent.md"), "utf8"), /from the agent/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("read-text can consume an upstream accepted artifact via fromArtifact (chaining)", async () => {
  const runDir = await tmp();
  try {
    const input = await inputWithAccepted(runDir, { "upstream.txt": "produced by a previous node" });
    const result = await runReadTextNode({ params: { fromArtifact: "upstream.txt" }, input });
    assert.equal(result.status, "completed");
    assert.match(result.payload!.origin, /artifact:upstream\.txt/);
    assert.match(await readFile(path.join(runDir, "upstream.txt"), "utf8"), /produced by a previous node/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("agent nodes fold all accepted upstream artifacts into the prompt (fan-in)", async () => {
  const runDir = await tmp();
  let capturedPrompt = "";
  try {
    const input = await inputWithAccepted(runDir, { "a.md": "ALPHA-CONTENT", "b.json": '{"beta":true}' });
    const result = await runAgentMarkdownNode({
      nodeId: "core.agent-markdown",
      params: { prompt: "summarize the inputs", artifactPath: "agent.md" },
      input,
      runAgent: async ({ prompt }) => { capturedPrompt = prompt; return { rawText: "ok", provider: "test", model: "stub" }; },
    });
    assert.equal(result.status, "completed");
    // Both accepted artifacts (from different upstream nodes) were folded in, labeled.
    assert.match(capturedPrompt, /summarize the inputs/);
    assert.match(capturedPrompt, /### a\.md\nALPHA-CONTENT/);
    assert.match(capturedPrompt, /### b\.json\n\{"beta":true\}/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("agent-json parses fenced JSON; non-JSON fails", async () => {
  const runDir = await tmp();
  try {
    const ok = await runAgentJsonNode({
      nodeId: "core.agent-json",
      params: { prompt: "give json", artifactPath: "agent.json" },
      input: inputFor(runDir),
      runAgent: fakeAgent('```json\n{"ok":true,"n":3}\n```'),
    });
    assert.equal(ok.status, "completed");
    assert.deepEqual(ok.payload?.value, { ok: true, n: 3 });

    const fail = await runAgentJsonNode({
      nodeId: "core.agent-json",
      params: { prompt: "give json", artifactPath: "agent.json" },
      input: inputFor(runDir),
      runAgent: fakeAgent("sorry, no json here"),
    });
    assert.equal(fail.status, "failed");
  } finally { await rm(runDir, { recursive: true, force: true }); }
});
