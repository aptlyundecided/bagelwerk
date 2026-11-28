import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentRunError, classifyAgentFailure } from "./agentRunEvents";
import { buildOllamaChatRequest, executeOllamaChatNodeSession, resolveOllamaHost, resolveStructuredVia, type OllamaFetch } from "./ollamaAgentCore";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeFetch(reply: { status?: number; body: unknown } | (() => Promise<never>), sent: Sent[] = []): OllamaFetch {
  return async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    if (typeof reply === "function") return reply();
    const status = reply.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)) };
  };
}

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "bw-ollama-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SCHEMA = { type: "object", required: ["op"], properties: { op: { type: "string" } } };

test("resolveOllamaHost defaults to local Ollama and accepts a bare host", () => {
  assert.equal(resolveOllamaHost({}), "http://localhost:11434");
  assert.equal(resolveOllamaHost({ OLLAMA_HOST: "10.0.0.2:11434" }), "http://10.0.0.2:11434");
  assert.equal(resolveOllamaHost({ OLLAMA_HOST: "https://ollama.com/" }), "https://ollama.com");
});

test("structured replies use a reply tool on Ollama Cloud and format everywhere else", () => {
  assert.equal(resolveStructuredVia("https://ollama.com"), "tool");
  assert.equal(resolveStructuredVia("http://localhost:11434"), "format");
  assert.equal(resolveStructuredVia("https://ollama.com", "format"), "format");
  const tool = buildOllamaChatRequest({ model: "m", prompt: "p", outputSchema: SCHEMA }, "tool");
  assert.equal(tool.format, undefined);
  assert.deepEqual(tool.tools, [{ type: "function", function: { name: "reply", description: "Give your answer. Call this exactly once.", parameters: SCHEMA } }]);
});

test("buildOllamaChatRequest sends the schema as format and never streams", () => {
  const body = buildOllamaChatRequest({ model: "gemma4:31b", prompt: "p", system: "s", outputSchema: SCHEMA, options: { temperature: 0.2 }, think: false }, "format");
  assert.deepEqual(body, {
    model: "gemma4:31b",
    messages: [{ role: "system", content: "s" }, { role: "user", content: "p" }],
    stream: false,
    options: { temperature: 0.2 },
    think: false,
    format: SCHEMA,
  });
});

test("a structured reply is parsed and the call is recorded with stop reason, reasoning and tokens", async () => {
  await withDir(async (dir) => {
    const sent: Sent[] = [];
    const result = await executeOllamaChatNodeSession(
      { model: "gemma4:31b", prompt: "Pick an action.", outputSchema: SCHEMA },
      {
        env: {},
        host: "https://ollama.com",
        apiKey: "secret-key",
        observationRoot: path.join(dir, "obs"),
        fetch: fakeFetch({ body: { message: { content: "", thinking: "Search first.", tool_calls: [{ function: { name: "reply", arguments: { op: "search" } } }] }, done_reason: "stop", prompt_eval_count: 120, eval_count: 30 } }, sent),
      },
    );
    assert.equal(sent[0]?.url, "https://ollama.com/api/chat");
    assert.equal(sent[0]?.headers.Authorization, "Bearer secret-key");
    assert.equal(sent[0]?.body.format, undefined);
    assert(Array.isArray(sent[0]?.body.tools));
    assert.deepEqual(result.structured, { op: "search" });
    assert.equal(result.structuredVia, "tool");
    assert.equal(result.thinking, "Search first.");
    assert.equal(result.doneReason, "stop");
    assert.equal(result.tokenUsage.inputTokens, 120);
    assert.equal(result.tokenUsage.outputTokens, 30);

    const files = await readdir(result.observationDir);
    for (const name of ["prompt.md", "input.json", "response.json", "thinking.md", "structured-output.json", "output-schema.json", "run-events.ndjson", "summary.json"]) assert(files.includes(name), name);
    assert(!(await readFile(path.join(result.observationDir, "input.json"), "utf8")).includes("secret-key"));
    const summary = JSON.parse(await readFile(path.join(result.observationDir, "summary.json"), "utf8")) as Record<string, unknown>;
    assert.equal(summary.qualityStatus, "success");
    assert.equal(summary.doneReason, "stop");
    assert.equal(summary.thinkingChars, "Search first.".length);
  });
});

async function failure(reply: Parameters<typeof fakeFetch>[0], extra: { outputSchema?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}) {
  let error: unknown;
  await withDir(async (dir) => {
    error = await executeOllamaChatNodeSession(
      { model: "gemma4:31b", prompt: "p", ...(extra.outputSchema ? { outputSchema: extra.outputSchema } : {}) },
      { env: {}, observationRoot: path.join(dir, "obs"), fetch: fakeFetch(reply), timeoutMs: extra.timeoutMs, signal: extra.signal },
    ).then(() => undefined, (caught: unknown) => caught);
    assert(error instanceof AgentRunError);
    const recorded = JSON.parse(await readFile(path.join(error.observationDir!, "failure.json"), "utf8")) as Record<string, unknown>;
    assert.equal(recorded.reason, error.reason);
    assert.equal(recorded.failureClass, error.failureClass);
    const summary = JSON.parse(await readFile(path.join(error.observationDir!, "summary.json"), "utf8")) as Record<string, unknown>;
    assert.equal(summary.executionStatus, "failed");
    assert.equal(summary.failureClass, error.failureClass);
  });
  return error as AgentRunError;
}

test("an empty answer is a transport failure that says how much reasoning used the budget", async () => {
  const error = await failure({ body: { message: { content: "", thinking: "x".repeat(4000) }, done_reason: "stop", eval_count: 4096 } });
  assert.equal(error.reason, "empty-output");
  assert.equal(error.failureClass, "transport");
  assert.match(error.message, /4000 reasoning chars/);
});

test("a reply cut off at the token limit is a transport failure even when it has text", async () => {
  const error = await failure({ body: { message: { content: '{"op":"sea' }, done_reason: "length" } }, { outputSchema: SCHEMA });
  assert.equal(error.reason, "truncated");
  assert.equal(error.failureClass, "transport");
  assert.equal(error.rawText, '{"op":"sea');
});

test("prose instead of the requested structure is a contract failure that keeps the reply", async () => {
  const error = await failure({ body: { message: { content: 'I will search. {"op":"search"}' }, done_reason: "stop" } }, { outputSchema: SCHEMA });
  assert.equal(error.reason, "invalid-output");
  assert.equal(error.failureClass, "contract");
  assert.equal(error.rawText, 'I will search. {"op":"search"}');
  assert.equal(classifyAgentFailure(error), "contract");
});

test("HTTP errors keep only the provider's error string", async () => {
  const error = await failure({ status: 404, body: { error: "model 'gemma9' not found" } });
  assert.equal(error.reason, "http");
  assert.equal(error.failureClass, "transport");
  assert.equal(error.message, "Ollama HTTP 404: model 'gemma9' not found");
});

test("timeouts and cancellation are reported as such", async () => {
  const hang: OllamaFetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await withDir(async (dir) => {
    const timedOut = await executeOllamaChatNodeSession({ model: "m", prompt: "p" }, { env: {}, observationRoot: dir, fetch: hang, timeoutMs: 20 })
      .then(() => undefined, (caught: unknown) => caught);
    assert(timedOut instanceof AgentRunError);
    assert.equal(timedOut.reason, "timeout");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const cancelled = await executeOllamaChatNodeSession({ model: "m", prompt: "p" }, { env: {}, observationRoot: dir, fetch: hang, signal: controller.signal })
      .then(() => undefined, (caught: unknown) => caught);
    assert(cancelled instanceof AgentRunError);
    assert.equal(cancelled.reason, "aborted");
  });
});

test("with format, the answer text is parsed as the structure", async () => {
  await withDir(async (dir) => {
    const sent: Sent[] = [];
    const result = await executeOllamaChatNodeSession(
      { model: "gemma4:31b", prompt: "p", outputSchema: SCHEMA },
      { env: {}, observationRoot: dir, fetch: fakeFetch({ body: { message: { content: '{"op":"read"}' }, done_reason: "stop" } }, sent) },
    );
    assert.deepEqual(sent[0]?.body.format, SCHEMA);
    assert.deepEqual(result.structured, { op: "read" });
    assert.equal(result.structuredVia, "format");
  });
});

test("in tool mode, a prose answer with no reply call is a contract failure that keeps the prose", async () => {
  await withDir(async (dir) => {
    const error = await executeOllamaChatNodeSession(
      { model: "gemma4:31b", prompt: "p", outputSchema: SCHEMA, structuredVia: "tool" },
      { env: {}, observationRoot: dir, fetch: fakeFetch({ body: { message: { content: "I would grep for reset." }, done_reason: "stop" } }) },
    ).then(() => undefined, (caught: unknown) => caught);
    assert(error instanceof AgentRunError);
    assert.equal(error.failureClass, "contract");
    assert.equal(error.rawText, "I would grep for reset.");
    assert.match(error.message, /without calling the reply tool/);
  });
});
