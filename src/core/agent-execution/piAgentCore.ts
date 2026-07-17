import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

import {
  beginNodeObservation,
  type NodeQualityStatus,
} from "./nodeObservability";

export type PiThinkingLevel = "off" | "low" | "medium" | "high";

export type PiAgentNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
};

export type PiAgentUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

export type PiAgentNodeSessionResult = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  rawText: string;
  artifactPath: string;
  observationDir?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage?: PiAgentUsage;
};

type PiToolInfo = { name: string };

type PiSessionLike = {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  dispose(): void;
  getAllTools(): PiToolInfo[];
  setActiveToolsByName(toolNames: string[]): void;
  getSessionStats?: () => {
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
  };
  messages?: unknown[];
};

export type PiCommandInvocation = {
  piPath: string;
  cwd: string;
  provider: string;
  model: string;
  prompt: string;
  allowedTools: string[];
  env: NodeJS.ProcessEnv;
  onEvent: (event: unknown) => void;
  /** When aborted, the spawned `pi` child is killed and the call rejects (no hang, no orphaned child). */
  signal?: AbortSignal;
};

export type PiCommandResult = {
  exitCode: number;
  stderr: string;
};

type ExecutePiAgentNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  /** Optional in-process Pi SDK session override; when omitted, the installed `pi` CLI is spawned. */
  createSession?: (params: PiAgentNodeSessionParams) => Promise<PiSessionLike>;
  /** Injectable for tests; defaults to spawning the real `pi` CLI. */
  runPiCommand?: (params: PiCommandInvocation) => Promise<PiCommandResult>;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
  /**
   * Optional abort signal. When aborted, any spawned `pi` child is killed and the session rejects
   * with an `AbortError`. Lets callers bound agent calls (e.g. a worked example that must not hang
   * when the agent is unreachable) without orphaning the child process.
   */
  signal?: AbortSignal;
};

export function piCliArgsForInvocation(params: Pick<PiCommandInvocation, "provider" | "model" | "allowedTools">): string[] {
  const args = ["--print", "--mode", "json", "--no-session"];
  const provider = params.provider.trim();
  if (provider && provider.toLowerCase() !== "pi" && provider.toLowerCase() !== "auto") {
    args.push("--provider", provider);
  }
  const model = params.model.trim();
  if (model && model.toLowerCase() !== "auto") {
    args.push("--model", model);
  }
  const tools = params.allowedTools.map((tool) => tool.trim()).filter(Boolean);
  if (tools.length > 0) {
    args.push("--tools", tools.join(","));
  }
  return args;
}

const ARTIFACTS_ROOT_ENV = "BAGELWERK_AGENT_ARTIFACTS_ROOT";
const PI_AGENT_PATH_ENV = "PI_AGENT_PATH";
const PI_PATH_ENV = "PI_PATH";
const ALLOWED_THINKING_LEVELS = new Set<PiThinkingLevel>([
  "off",
  "low",
  "medium",
  "high",
]);
function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

function isoTimestampForFilename(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

async function assertDirectoryExists(dir: string, label: string): Promise<string> {
  const resolved = path.resolve(dir);
  let st;
  try {
    st = await stat(resolved);
  } catch (error) {
    throw new Error(
      `${label} is not accessible: ${resolved} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!st.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return resolved;
}

async function resolveArtifactsRoot(env: NodeJS.ProcessEnv): Promise<string> {
  const raw = env[ARTIFACTS_ROOT_ENV]?.trim();
  if (!raw) {
    throw new Error(`${ARTIFACTS_ROOT_ENV} is required and must point to the shared agent artifacts root.`);
  }

  const resolved = path.resolve(raw);
  await mkdir(resolved, { recursive: true });
  return assertDirectoryExists(resolved, ARTIFACTS_ROOT_ENV);
}

function validateParams(params: PiAgentNodeSessionParams): void {
  if (!params.provider.trim()) {
    throw new Error("provider is required");
  }
  if (!params.model.trim()) {
    throw new Error("model is required");
  }
  if (!ALLOWED_THINKING_LEVELS.has(params.thinkingLevel)) {
    throw new Error(`thinkingLevel must be one of: ${Array.from(ALLOWED_THINKING_LEVELS).join(", ")}`);
  }
  if (!Array.isArray(params.allowedTools)) {
    throw new Error("allowedTools must be an array");
  }
  if (!params.prompt.trim()) {
    throw new Error("prompt is required");
  }
  if (!params.cwd.trim()) {
    throw new Error("cwd is required");
  }
}

function normalizeAllowedTools(allowedTools: string[]): string[] {
  return allowedTools.map((tool) => tool.trim()).filter(Boolean);
}

function extractAssistantUsage(messages: unknown[] | undefined): PiAgentUsage | undefined {
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i] as { role?: unknown; usage?: unknown } | undefined;
    if (!candidate || candidate.role !== "assistant" || !candidate.usage) {
      continue;
    }

    const usage = candidate.usage as Partial<PiAgentUsage> & {
      cost?: Partial<PiAgentUsage["cost"]>;
    };

    if (
      typeof usage.input === "number" &&
      typeof usage.output === "number" &&
      typeof usage.cacheRead === "number" &&
      typeof usage.cacheWrite === "number" &&
      typeof usage.totalTokens === "number" &&
      usage.cost &&
      typeof usage.cost.input === "number" &&
      typeof usage.cost.output === "number" &&
      typeof usage.cost.cacheRead === "number" &&
      typeof usage.cost.cacheWrite === "number" &&
      typeof usage.cost.total === "number"
    ) {
      return {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        totalTokens: usage.totalTokens,
        cost: {
          input: usage.cost.input,
          output: usage.cost.output,
          cacheRead: usage.cost.cacheRead,
          cacheWrite: usage.cost.cacheWrite,
          total: usage.cost.total,
        },
      };
    }
  }

  return undefined;
}

function extractAssistantTextFromMessages(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i] as {
      role?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    } | undefined;
    if (!candidate || candidate.role !== "assistant" || !Array.isArray(candidate.content)) {
      continue;
    }

    const text = candidate.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function countAssistantMessages(messages: unknown[] | undefined): number {
  return Array.isArray(messages)
    ? messages.filter((message) => (message as { role?: unknown } | undefined)?.role === "assistant").length
    : 0;
}

function extractAssistantStopReason(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i] as { role?: unknown; stopReason?: unknown } | undefined;
    if (candidate?.role === "assistant" && typeof candidate.stopReason === "string") {
      return candidate.stopReason;
    }
  }

  return undefined;
}

function truncateDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth >= 5) return "[max-depth]";
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated ${value.length - 4000} chars]` : value;
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((item) => truncateDiagnosticValue(item, depth + 1));
    return value.length > 50 ? [...items, `[truncated ${value.length - 50} items]`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [index, [key, nested]] of Object.entries(value as Record<string, unknown>).entries()) {
      if (index >= 50) {
        out.__truncatedKeys = Object.keys(value as Record<string, unknown>).length - 50;
        break;
      }
      out[key] = truncateDiagnosticValue(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

function normalizePiEvent(event: unknown): Record<string, unknown> {
  const maybe = event as Record<string, unknown> | undefined;
  const type = typeof maybe?.type === "string" ? maybe.type : "unknown";
  const normalized: Record<string, unknown> = { type };

  if (type === "message_update") {
    const assistantEvent = maybe?.assistantMessageEvent as Record<string, unknown> | undefined;
    if (typeof assistantEvent?.type === "string") {
      normalized.assistantEventType = assistantEvent.type;
    }
    if (typeof assistantEvent?.delta === "string") {
      normalized.deltaChars = assistantEvent.delta.length;
      if (assistantEvent.type !== "thinking_delta") {
        normalized.deltaPreview = assistantEvent.delta.slice(0, 200);
      }
    }
  }

  if (type === "tool_execution_start" || type === "tool_execution_end") {
    if (typeof maybe?.toolName === "string") {
      normalized.toolName = maybe.toolName;
    }
    if (typeof maybe?.isError === "boolean") {
      normalized.isError = maybe.isError;
    }
  }

  if ((type === "agent_end" || type === "turn_end") && Array.isArray(maybe?.messages)) {
    normalized.messageCount = maybe.messages.length;
  }

  return normalized;
}

function renderMirroredPiEvent(event: unknown): string | undefined {
  const maybe = event as {
    type?: unknown;
    assistantMessageEvent?: { type?: unknown; delta?: unknown };
  };
  if (
    maybe.type === "message_update" &&
    maybe.assistantMessageEvent?.type === "text_delta" &&
    typeof maybe.assistantMessageEvent.delta === "string"
  ) {
    return maybe.assistantMessageEvent.delta;
  }
  if (
    maybe.type === "message_update" &&
    maybe.assistantMessageEvent?.type === "thinking_delta"
  ) {
    return undefined;
  }
  return `\n${JSON.stringify(truncateDiagnosticValue(event))}\n`;
}

function tryMirrorStreamChunk(writer: ((chunk: string) => void) | undefined, chunk: string | undefined): void {
  if (!writer || !chunk || chunk.length === 0) return;
  try {
    writer(chunk);
  } catch {
    // Streaming is best-effort observability only.
  }
}

function resolvePiAgentPath(env: NodeJS.ProcessEnv): string {
  return env[PI_AGENT_PATH_ENV]?.trim() || env[PI_PATH_ENV]?.trim() || "pi";
}

function parsePiLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function defaultRunPiCommand(params: PiCommandInvocation): Promise<PiCommandResult> {
  return await new Promise<PiCommandResult>((resolve, reject) => {
    const signal = params.signal;
    // Fail fast if the caller already aborted before we spawn.
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("pi CLI aborted before spawn"));
      return;
    }

    const args = piCliArgsForInvocation(params);

    const child = spawn(params.piPath, args, {
      cwd: params.cwd,
      // The prompt is written to stdin (below), never argv, so large prompts with quotes/
      // newlines survive the Windows shell needed to launch the pi .ps1/.cmd shim.
      stdio: ["pipe", "pipe", "pipe"],
      env: params.env,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const event = parsePiLine(line);
      if (event) params.onEvent(event);
    });

    // Kill the spawned `pi` child on abort so the session rejects promptly instead of hanging
    // on an unreachable agent. The `close` handler below sees the abort and rejects.
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // Best-effort kill; the close handler will still fire and reject on abort.
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      rl.close();
      signal?.removeEventListener("abort", onAbort);
      // If the caller aborted, the child was killed above; resolve as an abort, not a normal close.
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("pi CLI aborted"));
        return;
      }
      resolve({ exitCode: code ?? 0, stderr: stderrChunks.join("") });
    });

    // Feed the prompt via stdin, then close it so pi proceeds (an open stdin makes pi hang).
    child.stdin?.on("error", () => {
      // Ignore EPIPE if the child exits before we finish writing.
    });
    child.stdin?.end(params.prompt);
  });
}

async function writeFailureArtifact(params: {
  artifactDir: string;
  fileBase: string;
  error: unknown;
  nodeId: string;
  input: PiAgentNodeSessionParams;
  startedAt: string;
  finishedAt: string;
}): Promise<void> {
  const failurePath = path.join(params.artifactDir, `${params.fileBase}__failed.json`);
  const payload = {
    ok: false,
    nodeId: params.nodeId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    error: params.error instanceof Error ? params.error.message : String(params.error),
    input: params.input,
  };
  await writeFile(failurePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function executePiAgentNodeSession(
  params: PiAgentNodeSessionParams,
  deps: ExecutePiAgentNodeSessionDeps = {},
): Promise<PiAgentNodeSessionResult> {
  validateParams(params);

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => randomUUID().slice(0, 8));
  const runPiCommand = deps.runPiCommand ?? defaultRunPiCommand;
  const piAgentPath = resolvePiAgentPath(env);
  const nodeId = deps.nodeId ?? "pi.agent";
  const streamEnabled = deps.stream === true;
  const streamWriter = streamEnabled ? (deps.streamWriter ?? ((chunk: string) => process.stdout.write(chunk))) : undefined;

  const cwd = await assertDirectoryExists(params.cwd, "cwd");
  const normalizedAllowedTools = normalizeAllowedTools(params.allowedTools);
  const artifactsRoot = await resolveArtifactsRoot(env);
  const artifactDir = path.join(artifactsRoot, "pi-agent");
  await mkdir(artifactDir, { recursive: true });

  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const fileBase = `${isoTimestampForFilename(startedDate)}__${sanitizeFilePart(nodeId)}__${randomId()}`;
  const textArtifactPath = path.join(artifactDir, `${fileBase}.md`);
  const metadataArtifactPath = path.join(artifactDir, `${fileBase}.json`);
  const observation = await beginNodeObservation(
    { runId: deps.runId, nodeId },
    { env, now, randomId },
  );
  await observation.writeText("prompt.md", params.prompt);
  await observation.writeJson("input.json", {
    provider: params.provider.trim(),
    model: params.model.trim(),
    thinkingLevel: params.thinkingLevel,
    allowedTools: normalizedAllowedTools,
    cwd,
  });

  let session: PiSessionLike | undefined;
  let rawText = "";
  let toolExecutionCount = 0;
  let eventCount = 0;
  let mirroredAnyOutput = false;
  let mirroredEndsWithNewline = true;
  let capturedMessages: unknown[] | undefined;
  const pendingEventWrites: Array<Promise<unknown>> = [];

  // Shared across the in-process session and the CLI: pi's --mode json stream emits the same
  // event shapes the in-process session does (message_update/text_delta, tool_execution_*, and a
  // final agent_end carrying `messages`).
  const handlePiEvent = (event: unknown) => {
    const maybe = event as {
      type?: unknown;
      assistantMessageEvent?: { type?: unknown; delta?: unknown };
      messages?: unknown;
    };
    if (
      maybe.type === "message_update" &&
      maybe.assistantMessageEvent?.type === "text_delta" &&
      typeof maybe.assistantMessageEvent.delta === "string"
    ) {
      rawText += maybe.assistantMessageEvent.delta;
    }
    if (maybe.type === "tool_execution_start") {
      toolExecutionCount += 1;
    }
    if (Array.isArray(maybe.messages)) {
      capturedMessages = maybe.messages;
    }
    eventCount += 1;
    const mirroredChunk = renderMirroredPiEvent(event);
    if (mirroredChunk) {
      mirroredAnyOutput = true;
      mirroredEndsWithNewline = mirroredChunk.endsWith("\n");
      tryMirrorStreamChunk(streamWriter, mirroredChunk);
    }
    pendingEventWrites.push(
      observation.appendNdjson("events.ndjson", {
        at: now().toISOString(),
        ...normalizePiEvent(event),
      }),
    );
  };

  try {
    if (deps.createSession) {
      // Optional in-process Pi SDK session (tests / embedded SDK).
      session = await deps.createSession({
        ...params,
        cwd,
        provider: params.provider.trim(),
        model: params.model.trim(),
        prompt: params.prompt,
        allowedTools: normalizedAllowedTools,
      });
      const unsubscribe = session.subscribe(handlePiEvent);
      try {
        await session.prompt(params.prompt);
      } finally {
        unsubscribe();
      }
      capturedMessages = capturedMessages ?? session.messages;
    } else {
      // Default: spawn the installed `pi` CLI with explicit provider + model.
      const commandResult = await runPiCommand({
        piPath: piAgentPath,
        cwd,
        provider: params.provider.trim(),
        model: params.model.trim(),
        prompt: params.prompt,
        allowedTools: normalizedAllowedTools,
        env,
        onEvent: handlePiEvent,
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      if (commandResult.exitCode !== 0 && rawText.trim().length === 0) {
        throw new Error(commandResult.stderr.trim() || `pi CLI exited with code ${commandResult.exitCode}`);
      }
    }

    await Promise.allSettled(pendingEventWrites);
    rawText = rawText.trim() || extractAssistantTextFromMessages(capturedMessages);
    if (mirroredAnyOutput && !mirroredEndsWithNewline) {
      tryMirrorStreamChunk(streamWriter, "\n");
      mirroredEndsWithNewline = true;
    }
    const finishedDate = now();
    const finishedAt = finishedDate.toISOString();
    const durationMs = finishedDate.getTime() - startedDate.getTime();
    const usage = extractAssistantUsage(capturedMessages);
    const assistantMessageCount = countAssistantMessages(capturedMessages);
    const stopReason = extractAssistantStopReason(capturedMessages);
    const qualityStatus: NodeQualityStatus = rawText.length > 0 ? "success" : "failed";

    const result: PiAgentNodeSessionResult = {
      provider: params.provider.trim(),
      model: params.model.trim(),
      thinkingLevel: params.thinkingLevel,
      allowedTools: normalizedAllowedTools,
      cwd,
      prompt: params.prompt,
      rawText,
      artifactPath: textArtifactPath,
      observationDir: observation.artifactDir,
      startedAt,
      finishedAt,
      durationMs,
      ...(usage ? { usage } : {}),
    };

    await writeFile(textArtifactPath, rawText.length > 0 ? `${rawText}\n` : "", "utf8");
    await writeFile(
      metadataArtifactPath,
      `${JSON.stringify({ ...result, metadataArtifactPath }, null, 2)}\n`,
      "utf8",
    );
    await observation.writeText("raw-output.md", rawText);
    if (rawText.length === 0) {
      await observation.writeJson("messages.json", truncateDiagnosticValue(capturedMessages));
    }
    await observation.finalize({
      executionStatus: "completed",
      qualityStatus,
      provider: result.provider,
      model: result.model,
      thinkingLevel: result.thinkingLevel,
      legacyArtifactPath: textArtifactPath,
      metadataArtifactPath,
      rawTextLength: rawText.length,
      assistantMessageCount,
      toolExecutionCount,
      eventCount,
      stopReason,
      ...(usage ? { usage } : {}),
    });

    return result;
  } catch (error) {
    await Promise.allSettled(pendingEventWrites);
    if (mirroredAnyOutput && !mirroredEndsWithNewline) {
      tryMirrorStreamChunk(streamWriter, "\n");
      mirroredEndsWithNewline = true;
    }
    const finishedAt = now().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await writeFailureArtifact({
        artifactDir,
        fileBase,
        error,
        nodeId,
        input: { ...params, cwd, allowedTools: normalizedAllowedTools },
        startedAt,
        finishedAt,
      });
      await observation.writeJson("failure.json", {
        error: errorMessage,
        startedAt,
        finishedAt,
        input: {
          provider: params.provider.trim(),
          model: params.model.trim(),
          thinkingLevel: params.thinkingLevel,
          allowedTools: normalizedAllowedTools,
          cwd,
        },
      });
      if (capturedMessages !== undefined) {
        await observation.writeJson("messages.json", truncateDiagnosticValue(capturedMessages));
      }
      await observation.finalize({
        executionStatus: "failed",
        qualityStatus: "failed",
        errorMessage,
        legacyFailureArtifactPath: path.join(artifactDir, `${fileBase}__failed.json`),
        eventCount,
        toolExecutionCount,
        rawTextLength: rawText.length,
      });
    } catch {
      // Best-effort failure artifact only.
    }
    throw error;
  } finally {
    session?.dispose();
  }
}
