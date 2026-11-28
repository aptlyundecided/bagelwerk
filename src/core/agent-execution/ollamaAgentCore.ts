import { randomUUID } from "node:crypto";

import {
  AgentRunError,
  addTokenUsage,
  createRunEventRecorder,
  describeTokenUsage,
  emptyTokenUsage,
  preview,
  readStructuredReply,
  type AgentRunErrorReason,
  type AgentRunEvent,
  type AgentTokenUsage,
} from "./agentRunEvents";
import { beginNodeObservation } from "./nodeObservability";

/**
 * Ollama chat harness: one `POST /api/chat` with `stream: false`.
 *
 * Works against a local Ollama (`http://localhost:11434`) or Ollama Cloud (`https://ollama.com`
 * with an API key). Unlike the CLI harnesses this is a single model call with no tools: the
 * caller owns any lookup loop.
 *
 * `outputSchema` can reach the model two ways (`structuredVia`):
 * - `format`: Ollama's `format`, which constrains decoding to the schema. Local Ollama enforces it.
 * - `tool`: a single `reply` tool whose parameters are the schema; the answer is its call arguments.
 *   Ollama Cloud (checked 2026-11-28 with gemma4:31b, glm-5.3-flash and gpt-oss:120b) accepts
 *   `format` and `response_format` but ignores both and returns prose, while it does return tool calls.
 *   Tool arguments are shaped by the model rather than enforced by decoding, so validate them.
 * The default, `auto`, uses `tool` for ollama.com and `format` for every other host.
 *
 * Every call records the stop reason, the reasoning text and token counts, so an empty or cut-off
 * reply can be explained after the fact. Empty and truncated replies throw instead of returning:
 * they are transport failures, and the model's judgement was never seen.
 */

export type OllamaThinkSetting = boolean | "low" | "medium" | "high";
export type OllamaStructuredVia = "auto" | "format" | "tool";

const REPLY_TOOL = "reply";

export type OllamaChatNodeSessionParams = {
  model: string;
  /** Sent as the single user message. */
  prompt: string;
  /** Optional system message, sent before the prompt. */
  system?: string;
  /** JSON Schema for the answer. The parsed answer is returned as `structured`. */
  outputSchema?: unknown;
  /** How `outputSchema` reaches the model. See the module comment. Defaults to `auto`. */
  structuredVia?: OllamaStructuredVia;
  /** Ollama model options, for example `{ temperature: 0.2, num_predict: 8192 }`. */
  options?: Record<string, unknown>;
  /** Ollama's `think` setting for reasoning models. Omitted when undefined. */
  think?: OllamaThinkSetting;
};

export type OllamaChatNodeSessionResult = {
  model: string;
  prompt: string;
  host: string;
  /** The answer text (`message.content`). */
  rawText: string;
  /** The parsed answer, when `outputSchema` was given. */
  structured?: unknown;
  /** How the structure was requested, when `outputSchema` was given. */
  structuredVia?: "format" | "tool";
  /** Reasoning text (`message.thinking`), when the model returned any. */
  thinking?: string;
  /** Ollama's `done_reason`, for example `stop` or `length`. */
  doneReason?: string;
  tokenUsage: AgentTokenUsage;
  observationDir: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type OllamaFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}>;

export type ExecuteOllamaChatNodeSessionDeps = {
  /** Reads `OLLAMA_HOST` and `OLLAMA_API_KEY`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Overrides `OLLAMA_HOST`. Defaults to `http://localhost:11434`. */
  host?: string;
  /** Overrides `OLLAMA_API_KEY`. Sent as a bearer token; never written to the observation directory. */
  apiKey?: string;
  fetch?: OllamaFetch;
  observationRoot?: string;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  signal?: AbortSignal;
  /** Hard limit for the whole request. */
  timeoutMs?: number;
  onRunEvent?: (event: AgentRunEvent) => unknown;
};

const DEFAULT_HOST = "http://localhost:11434";

export function resolveOllamaHost(env: NodeJS.ProcessEnv, override?: string): string {
  const raw = override?.trim() || env.OLLAMA_HOST?.trim() || DEFAULT_HOST;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export function resolveStructuredVia(host: string, requested: OllamaStructuredVia = "auto"): "format" | "tool" {
  if (requested !== "auto") return requested;
  return /^https:\/\/(www\.)?ollama\.com$/i.test(host) ? "tool" : "format";
}

export function buildOllamaChatRequest(params: OllamaChatNodeSessionParams, via: "format" | "tool" = "format"): Record<string, unknown> {
  const messages = [
    ...(params.system?.trim() ? [{ role: "system", content: params.system }] : []),
    { role: "user", content: params.prompt },
  ];
  return {
    model: params.model.trim(),
    messages,
    stream: false,
    ...(params.options ? { options: params.options } : {}),
    ...(params.think !== undefined ? { think: params.think } : {}),
    ...(params.outputSchema !== undefined && via === "format" ? { format: params.outputSchema } : {}),
    ...(params.outputSchema !== undefined && via === "tool"
      ? { tools: [{ type: "function", function: { name: REPLY_TOOL, description: "Give your answer. Call this exactly once.", parameters: params.outputSchema } }] }
      : {}),
  };
}

type OllamaChatResponse = {
  message?: { content?: unknown; thinking?: unknown; tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> };
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
};

// Provider error bodies can echo request data, so keep only a bounded `error` string.
function providerErrorText(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? preview(parsed.error, 300) : undefined;
  } catch {
    return undefined;
  }
}

export async function executeOllamaChatNodeSession(
  params: OllamaChatNodeSessionParams,
  deps: ExecuteOllamaChatNodeSessionDeps = {},
): Promise<OllamaChatNodeSessionResult> {
  if (!params.model?.trim()) throw new Error("model is required");
  if (!params.prompt?.trim()) throw new Error("prompt is required");

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const nodeId = deps.nodeId ?? "ollama.chat";
  const host = resolveOllamaHost(env, deps.host);
  const apiKey = deps.apiKey?.trim() || env.OLLAMA_API_KEY?.trim();
  const doFetch: OllamaFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const model = params.model.trim();

  const observationEnv = deps.observationRoot ? { BAGELWERK_AGENT_ARTIFACTS_ROOT: deps.observationRoot } : env;
  const observation = await beginNodeObservation(
    { runId: deps.runId, nodeId },
    { env: observationEnv, now, randomId: deps.randomId ?? (() => randomUUID().slice(0, 8)) },
  );
  const via = params.outputSchema !== undefined ? resolveStructuredVia(host, params.structuredVia) : undefined;
  const request = buildOllamaChatRequest(params, via);
  await observation.writeText("prompt.md", params.system?.trim() ? `${params.system}\n\n---\n\n${params.prompt}` : params.prompt);
  await observation.writeJson("input.json", {
    harness: "ollama",
    host,
    model,
    authenticated: Boolean(apiKey),
    ...(params.options ? { options: params.options } : {}),
    ...(params.think !== undefined ? { think: params.think } : {}),
    ...(via ? { outputSchema: true, structuredVia: via } : {}),
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  });
  if (params.outputSchema !== undefined) await observation.writeJson("output-schema.json", params.outputSchema);

  const recorder = createRunEventRecorder({
    harness: "ollama",
    now,
    sinks: [(event) => observation.appendNdjson("run-events.ndjson", event), deps.onRunEvent],
  });
  recorder.emit({ kind: "session", phase: "started", summary: `Ollama chat · ${model} · ${host}`, detail: { model, host } });

  const started = now();
  const controller = new AbortController();
  let timedOut = false;
  let aborted = false;
  const onAbort = () => { aborted = true; controller.abort(); };
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  if (deps.signal?.aborted) onAbort();
  const timer = deps.timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(); }, deps.timeoutMs) : undefined;

  let usage = emptyTokenUsage();
  let rawText = "";
  let thinking: string | undefined;
  let doneReason: string | undefined;
  let structured: unknown;

  const fail = (reason: AgentRunErrorReason, message: string, extra: { rawText?: string } = {}) =>
    new AgentRunError({ message, harness: "ollama", reason, observationDir: observation.artifactDir, tokenUsage: usage, ...extra });

  try {
    let response: Awaited<ReturnType<OllamaFetch>>;
    let body: string;
    try {
      response = await doFetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      body = await response.text();
    } catch (error) {
      if (timedOut) throw fail("timeout", `Ollama reached the ${Math.round((deps.timeoutMs ?? 0) / 1000)}s limit`);
      if (aborted) throw fail("aborted", "Ollama request was cancelled");
      throw fail("http", `Could not reach Ollama at ${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const detail = providerErrorText(body);
      throw fail("http", `Ollama HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    let parsed: OllamaChatResponse;
    try {
      parsed = JSON.parse(body) as OllamaChatResponse;
    } catch {
      throw fail("http", "Ollama returned a response that is not JSON");
    }
    await observation.writeText("response.json", body);
    rawText = typeof parsed.message?.content === "string" ? parsed.message.content.trim() : "";
    const replyCall = parsed.message?.tool_calls?.find((call) => call.function?.name === REPLY_TOOL)?.function;
    const replyArguments = typeof replyCall?.arguments === "string" ? replyCall.arguments : replyCall?.arguments !== undefined ? JSON.stringify(replyCall.arguments) : undefined;
    thinking = typeof parsed.message?.thinking === "string" && parsed.message.thinking.trim() ? parsed.message.thinking : undefined;
    doneReason = typeof parsed.done_reason === "string" ? parsed.done_reason : undefined;
    usage = addTokenUsage(emptyTokenUsage(), {
      inputTokens: typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : 0,
      outputTokens: typeof parsed.eval_count === "number" ? parsed.eval_count : 0,
    });
    if (thinking) {
      await observation.writeText("thinking.md", thinking);
      recorder.emit({ kind: "reasoning", phase: "completed", summary: preview(thinking, 300), detail: { chars: thinking.length } });
    }
    if (rawText) recorder.emit({ kind: "message", phase: "completed", summary: preview(rawText, 300) });
    if (replyArguments !== undefined) recorder.emit({ kind: "tool", phase: "completed", summary: `${REPLY_TOOL}: ${preview(replyArguments, 280)}` });
    recorder.emit({ kind: "usage", phase: "completed", summary: `Result ${doneReason ?? "unknown"} · ${describeTokenUsage(usage)}`, detail: { doneReason, tokenUsage: usage } });

    const reasoningNote = thinking ? `, ${thinking.length} reasoning chars` : "";
    if (doneReason === "length") {
      throw fail("truncated", `Ollama stopped at its token limit before finishing (done_reason length${reasoningNote})`, { rawText });
    }
    if (!rawText && replyArguments === undefined) {
      throw fail("empty-output", `Ollama returned no answer (done_reason ${doneReason ?? "unknown"}${reasoningNote})`);
    }
    if (via === "tool") {
      if (replyArguments === undefined) throw fail("invalid-output", `Ollama answered without calling the ${REPLY_TOOL} tool`, { rawText });
      const read = readStructuredReply(replyArguments);
      if (!read.ok) throw fail("invalid-output", `Ollama's ${REPLY_TOOL} call was not readable: ${read.issue}`, { rawText: replyArguments });
      structured = read.value;
    } else if (via === "format") {
      const read = readStructuredReply(rawText);
      if (!read.ok) throw fail("invalid-output", `Ollama did not return the requested structure: ${read.issue}`, { rawText });
      structured = read.value;
    }
  } catch (error) {
    if (timer) clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
    const failure = error instanceof AgentRunError ? error : fail("http", error instanceof Error ? error.message : String(error));
    recorder.emit({ kind: "result", phase: "failed", summary: failure.message, detail: { reason: failure.reason, failureClass: failure.failureClass } });
    await recorder.flush();
    if (rawText) await observation.writeText("raw-output.md", rawText).catch(() => undefined);
    await observation.writeJson("failure.json", { error: failure.message, reason: failure.reason, failureClass: failure.failureClass, doneReason }).catch(() => undefined);
    await observation.finalize({
      harness: "ollama",
      model,
      host,
      executionStatus: "failed",
      qualityStatus: "failed",
      errorMessage: failure.message,
      failureReason: failure.reason,
      failureClass: failure.failureClass,
      doneReason,
      tokenUsage: usage,
      thinkingChars: thinking?.length ?? 0,
      rawTextLength: rawText.length,
      runEventCount: recorder.count,
    }).catch(() => undefined);
    throw failure;
  }
  if (timer) clearTimeout(timer);
  deps.signal?.removeEventListener("abort", onAbort);

  const finished = now();
  recorder.emit({ kind: "result", phase: "completed", summary: `Finished · ${describeTokenUsage(usage)}`, detail: { doneReason, tokenUsage: usage } });
  await recorder.flush();
  await observation.writeText("raw-output.md", rawText);
  if (structured !== undefined) await observation.writeJson("structured-output.json", structured);
  await observation.finalize({
    harness: "ollama",
    model,
    host,
    executionStatus: "completed",
    qualityStatus: "success",
    doneReason,
    ...(via ? { structuredVia: via } : {}),
    tokenUsage: usage,
    thinkingChars: thinking?.length ?? 0,
    rawTextLength: rawText.length,
    durationMs: finished.getTime() - started.getTime(),
    runEventCount: recorder.count,
  });

  return {
    model,
    prompt: params.prompt,
    host,
    rawText,
    ...(structured !== undefined ? { structured } : {}),
    ...(via ? { structuredVia: via } : {}),
    ...(thinking ? { thinking } : {}),
    ...(doneReason ? { doneReason } : {}),
    tokenUsage: usage,
    observationDir: observation.artifactDir,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
  };
}
