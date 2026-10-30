import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentRunEvent } from "./agentRunEvents";
import { AgentRunError } from "./agentRunEvents";
import { buildCodexExecArgs, executeCodexAgentNodeSession, parseCodexUsage, projectCodexEvent } from "./codexAgentCore";

// Event shapes follow codex-rs/exec/src/exec_events.rs (ThreadEvent / ThreadItem).
const SAMPLE_EVENTS = [
  { type: "thread.started", thread_id: "thread-123" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "Look at the styles first." } },
  { type: "item.started", item: { id: "item_1", type: "command_execution", command: "rg -n nes.min.css", aggregated_output: "", exit_code: null, status: "in_progress" } },
  { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "rg -n nes.min.css", aggregated_output: "main.jsx:3:import './vendor/nes.min.css';\n", exit_code: 0, status: "completed" } },
  { type: "item.completed", item: { id: "item_2", type: "command_execution", command: "npm test", aggregated_output: "1 failing", exit_code: 1, status: "failed" } },
  { type: "item.completed", item: { id: "item_3", type: "file_change", changes: [{ path: "style.css", kind: "update" }, { path: "new.css", kind: "add" }], status: "completed" } },
  { type: "item.updated", item: { id: "item_4", type: "todo_list", items: [{ text: "inventory", completed: true }, { text: "report", completed: false }] } },
  { type: "item.completed", item: { id: "item_5", type: "agent_message", text: "{\"outcome\":\"ready_for_review\"}" } },
  { type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 300, reasoning_output_tokens: 120 } },
];

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** Writes a stand-in `codex` executable that echoes stdin into a file and replays JSONL events. */
async function fakeCodex(dir: string, options: { events: unknown[]; exitCode?: number; hang?: boolean; stderr?: string; lastMessage?: string }): Promise<string> {
  const script = path.join(dir, "fake-codex.js");
  await writeFile(
    script,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(path.join(dir, "stdin.txt"))}, input);
  fs.writeFileSync(${JSON.stringify(path.join(dir, "args.json"))}, JSON.stringify(args));
  for (const event of ${JSON.stringify(options.events)}) process.stdout.write(JSON.stringify(event) + "\\n");
  process.stdout.write("not json progress line\\n");
  ${options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : ""}
  const out = args[args.indexOf("--output-last-message") + 1];
  ${options.lastMessage !== undefined ? `fs.writeFileSync(out, ${JSON.stringify(options.lastMessage)});` : ""}
  ${options.hang ? "setInterval(() => {}, 1000);" : `process.exit(${options.exitCode ?? 0});`}
});
`,
    "utf8",
  );
  await chmod(script, 0o755);
  return script;
}

test("buildCodexExecArgs sets json/last-message/schema itself and sends the prompt on stdin", () => {
  const args = buildCodexExecArgs({
    model: "gpt-5.5",
    execArgs: ["-C", "/work", "-c", 'approval_policy="never"'],
    lastMessagePath: "/obs/last-message.txt",
    outputSchemaPath: "/obs/output-schema.json",
  });
  assert.deepEqual(args, [
    "exec", "--json", "--output-last-message", "/obs/last-message.txt", "--output-schema", "/obs/output-schema.json",
    "--model", "gpt-5.5", "-C", "/work", "-c", 'approval_policy="never"', "-",
  ]);
  assert.throws(() => buildCodexExecArgs({ execArgs: ["--json"], lastMessagePath: "/x" }), /must not include --json/);
});

test("projectCodexEvent turns raw thread events into readable timeline steps", () => {
  const drafts = SAMPLE_EVENTS.flatMap((event) => projectCodexEvent(event));
  const summaries = drafts.map((draft) => `${draft.kind}/${draft.phase ?? "-"}: ${draft.summary}`);
  assert.deepEqual(summaries, [
    "session/started: Codex session thread-123",
    "turn/started: Turn started",
    "reasoning/completed: Look at the styles first.",
    "command/started: $ rg -n nes.min.css",
    "command/completed: $ rg -n nes.min.css → exit 0",
    "command/failed: $ npm test → exit 1",
    "file_change/completed: Changed 2 files: style.css (update), new.css (add)",
    "todo/updated: Plan 1/2 done",
    'message/completed: {"outcome":"ready_for_review"}',
    "usage/completed: Turn complete · 1,200 in · 800 cached · 300 out · 120 reasoning",
  ]);
  assert.equal(drafts[4].itemId, "item_1");
  assert.match(String(drafts[4].detail?.outputTail), /nes\.min\.css/);
  assert.match(projectCodexEvent({ type: "error", message: "stream disconnected before completion" })[0].summary, /Stream error: stream disconnected/);
});

test("parseCodexUsage reads Codex token fields and ignores unrelated objects", () => {
  assert.deepEqual(parseCodexUsage({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 }), {
    inputTokens: 10, cachedInputTokens: 4, cacheWriteTokens: 0, outputTokens: 3, reasoningOutputTokens: 0,
  });
  assert.equal(parseCodexUsage({ foo: 1 }), undefined);
});

test("executeCodexAgentNodeSession records raw and projected events, usage, changes and the final message", async () => {
  const dir = await tempDir("bw-codex-");
  try {
    const script = await fakeCodex(dir, { events: SAMPLE_EVENTS, lastMessage: '{"outcome":"ready_for_review"}\n' });
    const live: AgentRunEvent[] = [];
    const result = await executeCodexAgentNodeSession(
      { cwd: dir, prompt: "Inventory NES.css usage.", model: "gpt-5.5", execArgs: ["--sandbox", "read-only"], outputSchema: { type: "object" } },
      { env: { ...process.env, CODEX_PATH: script }, observationRoot: path.join(dir, "obs"), runId: "queue-1", nodeId: "trace", onRunEvent: (event) => { live.push(event); } },
    );

    assert.equal(await readFile(path.join(dir, "stdin.txt"), "utf8"), "Inventory NES.css usage.");
    const args = JSON.parse(await readFile(path.join(dir, "args.json"), "utf8")) as string[];
    assert.equal(args[args.length - 1], "-");
    assert(args.includes("--output-schema"));

    assert.equal(result.rawText, '{"outcome":"ready_for_review"}');
    assert.equal(result.threadId, "thread-123");
    assert.equal(result.turnCount, 1);
    assert.equal(result.commandCount, 2);
    assert.equal(result.failedCommandCount, 1);
    assert.deepEqual(result.fileChanges, [{ path: "style.css", kind: "update" }, { path: "new.css", kind: "add" }]);
    assert.deepEqual(result.tokenUsage, { inputTokens: 1200, cachedInputTokens: 800, cacheWriteTokens: 0, outputTokens: 300, reasoningOutputTokens: 120, totalTokens: 1500 });
    assert.equal(result.eventCount, SAMPLE_EVENTS.length);

    assert.deepEqual(live.map((event) => event.seq), live.map((_, index) => index + 1));
    assert.equal(live[live.length - 1]?.kind, "result");
    assert(live.every((event) => event.harness === "codex"));

    assert(result.observationDir.startsWith(path.join(dir, "obs", "queue-1")));
    const files = await readdir(result.observationDir);
    for (const name of ["prompt.md", "input.json", "events.ndjson", "run-events.ndjson", "summary.json", "raw-output.md", "output-schema.json"]) assert(files.includes(name), name);
    const runEvents = (await readFile(path.join(result.observationDir, "run-events.ndjson"), "utf8")).trim().split("\n");
    assert.equal(runEvents.length, live.length);
    const summary = JSON.parse(await readFile(path.join(result.observationDir, "summary.json"), "utf8")) as Record<string, unknown>;
    assert.equal(summary.executionStatus, "completed");
    assert.equal(summary.qualityStatus, "success");
    assert.equal(summary.runEventCount, live.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-zero exit fails with the stream's own error instead of a stderr dump", async () => {
  const dir = await tempDir("bw-codex-fail-");
  try {
    const script = await fakeCodex(dir, {
      events: [
        { type: "thread.started", thread_id: "t" },
        { type: "turn.started" },
        { type: "error", message: "stream disconnected before completion: error decoding response body" },
        { type: "turn.failed", error: { message: "stream disconnected before completion" } },
      ],
      exitCode: 1,
      stderr: "x".repeat(50000) + "\nERROR: stream disconnected",
    });
    const error = await executeCodexAgentNodeSession(
      { cwd: dir, prompt: "p" },
      { env: { ...process.env, CODEX_PATH: script }, observationRoot: path.join(dir, "obs") },
    ).then(() => undefined, (failure: unknown) => failure);
    assert(error instanceof AgentRunError);
    assert.equal(error.reason, "exit");
    assert.equal(error.message, "Codex exited 1: stream disconnected before completion");
    assert(error.observationDir);
    assert(error.stderrTail && error.stderrTail.length <= 16000);
    const summary = JSON.parse(await readFile(path.join(error.observationDir!, "summary.json"), "utf8")) as Record<string, unknown>;
    assert.equal(summary.executionStatus, "failed");
    const failure = JSON.parse(await readFile(path.join(error.observationDir!, "failure.json"), "utf8")) as Record<string, unknown>;
    assert.equal(failure.reason, "exit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeouts kill the whole Codex process group and report reason=timeout", async () => {
  const dir = await tempDir("bw-codex-timeout-");
  try {
    const script = await fakeCodex(dir, { events: [{ type: "thread.started", thread_id: "t" }], hang: true });
    const started = Date.now();
    const error = await executeCodexAgentNodeSession(
      { cwd: dir, prompt: "p" },
      { env: { ...process.env, CODEX_PATH: script }, observationRoot: path.join(dir, "obs"), timeoutMs: 400 },
    ).then(() => undefined, (failure: unknown) => failure);
    assert(error instanceof AgentRunError);
    assert.equal(error.reason, "timeout");
    assert(Date.now() - started < 5000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("abort signals cancel a running session", async () => {
  const dir = await tempDir("bw-codex-abort-");
  try {
    const script = await fakeCodex(dir, { events: [], hang: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const error = await executeCodexAgentNodeSession(
      { cwd: dir, prompt: "p" },
      { env: { ...process.env, CODEX_PATH: script }, observationRoot: path.join(dir, "obs"), signal: controller.signal },
    ).then(() => undefined, (failure: unknown) => failure);
    assert(error instanceof AgentRunError);
    assert.equal(error.reason, "aborted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sink that throws never stops the run", async () => {
  const dir = await tempDir("bw-codex-sink-");
  try {
    const script = await fakeCodex(dir, { events: SAMPLE_EVENTS });
    const result = await executeCodexAgentNodeSession(
      { cwd: dir, prompt: "p" },
      { env: { ...process.env, CODEX_PATH: script }, observationRoot: path.join(dir, "obs"), onRunEvent: () => { throw new Error("sink down"); } },
    );
    assert.equal(result.rawText, '{"outcome":"ready_for_review"}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
