import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  beginNodeObservation,
  type NodeQualityStatus,
} from "./nodeObservability";
import type { PiAgentUsage, PiThinkingLevel } from "./piAgentCore";

export type ClaudeCodePermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type ClaudeCodeAgentNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  permissionMode?: ClaudeCodePermissionMode;
  maxTurns?: number;
};

export type ClaudeCodeAgentNodeSessionResult = {
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
  agentPath: string;
  outputFormat: "stream-json";
  permissionMode?: ClaudeCodePermissionMode;
  maxTurns?: number;
};

export type ClaudeCodeAssistantEvent = {
  type: "assistant";
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
};

export type ClaudeCodeResultEvent = {
  type: "result";
  subtype?: string;
  duration_ms?: number;
  durationMs?: number;
  usage?: unknown;
};

export type ClaudeCodeStreamEvent =
  | ClaudeCodeAssistantEvent
  | ClaudeCodeResultEvent
  | { type: string; [key: string]: unknown };

export type ClaudeCodeCommandInvocation = {
  agentPath: string;
  cwd: string;
  model: string;
  prompt: string;
  allowedTools: string[];
  permissionMode?: ClaudeCodePermissionMode;
  maxTurns?: number;
  env: NodeJS.ProcessEnv;
  onEvent: (event: ClaudeCodeStreamEvent) => void;
};

export type ClaudeCodeCommandResult = {
  exitCode: number;
  stderr: string;
};

export type ExecuteClaudeCodeAgentNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
  runClaudeCodeCommand?: (params: ClaudeCodeCommandInvocation) => Promise<ClaudeCodeCommandResult>;
};

const ARTIFACTS_ROOT_ENV = "BAGELWERK_AGENT_ARTIFACTS_ROOT";
const ALLOWED_THINKING_LEVELS = new Set<PiThinkingLevel>([
  "off",
  "low",
  "medium",
  "high",
]);
const CLAUDE_CODE_PATH_ENV = "CLAUDE_CODE_PATH";
const CLAUDE_PATH_ENV = "CLAUDE_PATH";
const ALLOWED_PERMISSION_MODES = new Set<ClaudeCodePermissionMode>([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
]);
const CLAUDE_CODE_PERMISSION_MODE_ENV = "CLAUDE_CODE_PERMISSION_MODE";
// Default to bypassPermissions so headless `-p` runs don't auto-deny tool calls.
// The workspace trust dialog is already skipped in `-p` mode (see `claude --help`),
// so no interactive first-run "yes" prompt blocks the wrapper on this path.
const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = "bypassPermissions";

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

function validateParams(params: ClaudeCodeAgentNodeSessionParams): void {
  if (!params.provider.trim()) throw new Error("provider is required");
  if (!params.model.trim()) throw new Error("model is required");
  if (!ALLOWED_THINKING_LEVELS.has(params.thinkingLevel)) {
    throw new Error(`thinkingLevel must be one of: ${Array.from(ALLOWED_THINKING_LEVELS).join(", ")}`);
  }
  if (!Array.isArray(params.allowedTools)) throw new Error("allowedTools must be an array");
  if (!params.prompt.trim()) throw new Error("prompt is required");
  if (!params.cwd.trim()) throw new Error("cwd is required");
  if (params.permissionMode !== undefined && !ALLOWED_PERMISSION_MODES.has(params.permissionMode)) {
    throw new Error(`permissionMode must be one of: ${Array.from(ALLOWED_PERMISSION_MODES).join(", ")}`);
  }
  if (params.maxTurns !== undefined && (!Number.isInteger(params.maxTurns) || params.maxTurns < 1)) {
    throw new Error("maxTurns must be a positive integer when provided");
  }
}

function resolveAgentPath(env: NodeJS.ProcessEnv): string {
  return env[CLAUDE_CODE_PATH_ENV]?.trim() || env[CLAUDE_PATH_ENV]?.trim() || "claude";
}

export function resolveEffectivePermissionMode(
  explicit: ClaudeCodePermissionMode | undefined,
  env: NodeJS.ProcessEnv,
): ClaudeCodePermissionMode {
  if (explicit) return explicit;
  const fromEnv = env[CLAUDE_CODE_PERMISSION_MODE_ENV]?.trim();
  if (fromEnv && ALLOWED_PERMISSION_MODES.has(fromEnv as ClaudeCodePermissionMode)) {
    return fromEnv as ClaudeCodePermissionMode;
  }
  return DEFAULT_CLAUDE_CODE_PERMISSION_MODE;
}

function parseClaudeCodeLine(line: string): ClaudeCodeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ClaudeCodeStreamEvent;
  } catch {
    return null;
  }
}

function isClaudeCodeAssistantEvent(event: ClaudeCodeStreamEvent): event is ClaudeCodeAssistantEvent {
  return event.type === "assistant";
}

function isClaudeCodeResultEvent(event: ClaudeCodeStreamEvent): event is ClaudeCodeResultEvent {
  return event.type === "result";
}

function extractAssistantDelta(event: ClaudeCodeStreamEvent): string {
  if (isClaudeCodeAssistantEvent(event) && Array.isArray(event.message?.content)) {
    return event.message.content
      .filter((block): block is { type: string; text: string } => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }

  const maybe = event as {
    delta?: { type?: unknown; text?: unknown } | string;
    text?: unknown;
  };
  if (typeof maybe.delta === "object" && maybe.delta?.type === "text_delta" && typeof maybe.delta.text === "string") {
    return maybe.delta.text;
  }
  if ((event.type === "text_delta" || event.type === "content_block_delta") && typeof maybe.text === "string") {
    return maybe.text;
  }
  if (typeof maybe.delta === "string" && (event.type === "text_delta" || event.type === "content_block_delta")) {
    return maybe.delta;
  }
  return "";
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
  ) return value;
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

function normalizeClaudeCodeEvent(event: ClaudeCodeStreamEvent): Record<string, unknown> {
  const normalized: Record<string, unknown> = { type: event.type };
  const delta = extractAssistantDelta(event);
  if (delta) normalized.deltaChars = delta.length;
  if (isClaudeCodeResultEvent(event)) {
    normalized.subtype = event.subtype;
    normalized.durationMs = event.durationMs ?? event.duration_ms;
  }
  return normalized;
}

function renderMirroredClaudeCodeEvent(event: ClaudeCodeStreamEvent): string | undefined {
  const delta = extractAssistantDelta(event);
  if (delta) return delta;
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

function extractUsage(event: ClaudeCodeStreamEvent): PiAgentUsage | undefined {
  const usage = (event as { usage?: unknown }).usage as Partial<PiAgentUsage> & {
    cost?: Partial<PiAgentUsage["cost"]>;
  } | undefined;
  if (
    usage &&
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
  return undefined;
}

async function defaultRunClaudeCodeCommand(params: ClaudeCodeCommandInvocation): Promise<ClaudeCodeCommandResult> {
  return await new Promise<ClaudeCodeCommandResult>((resolve, reject) => {
    const args = [
      "-p",
      // Claude Code requires --verbose when combining --print with stream-json output.
      "--verbose",
      "--output-format", "stream-json",
      "--model", params.model,
    ];
    if (params.permissionMode) {
      args.push("--permission-mode", params.permissionMode);
    }
    if (params.maxTurns !== undefined) {
      args.push("--max-turns", String(params.maxTurns));
    }
    const allowedTools = params.allowedTools.map((tool) => tool.trim()).filter(Boolean);
    if (allowedTools.length > 0) {
      args.push("--allowedTools", ...allowedTools);
    }
    args.push(params.prompt);

    const child = spawn(params.agentPath, args, {
      cwd: params.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: params.env,
      ...(process.platform === "win32" && /\.(cmd|bat)$/i.test(params.agentPath) ? { shell: true } : {}),
    });

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const event = parseClaudeCodeLine(line);
      if (event) params.onEvent(event);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      rl.close();
      resolve({ exitCode: code ?? 0, stderr: stderrChunks.join("") });
    });
  });
}

async function writeFailureArtifact(params: {
  artifactDir: string;
  fileBase: string;
  error: unknown;
  nodeId: string;
  input: ClaudeCodeAgentNodeSessionParams;
  startedAt: string;
  finishedAt: string;
  agentPath: string;
}): Promise<void> {
  const failurePath = path.join(params.artifactDir, `${params.fileBase}__failed.json`);
  const payload = {
    ok: false,
    nodeId: params.nodeId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    error: params.error instanceof Error ? params.error.message : String(params.error),
    agentPath: params.agentPath,
    input: params.input,
  };
  await writeFile(failurePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function executeClaudeCodeAgentNodeSession(
  params: ClaudeCodeAgentNodeSessionParams,
  deps: ExecuteClaudeCodeAgentNodeSessionDeps = {},
): Promise<ClaudeCodeAgentNodeSessionResult> {
  validateParams(params);

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => randomUUID().slice(0, 8));
  const runClaudeCodeCommand = deps.runClaudeCodeCommand ?? defaultRunClaudeCodeCommand;
  const nodeId = deps.nodeId ?? "claude-code.agent";
  const agentPath = resolveAgentPath(env);
  const permissionMode = resolveEffectivePermissionMode(params.permissionMode, env);
  const streamEnabled = deps.stream === true;
  const streamWriter = streamEnabled ? (deps.streamWriter ?? ((chunk: string) => process.stdout.write(chunk))) : undefined;

  const cwd = await assertDirectoryExists(params.cwd, "cwd");
  const artifactsRoot = await resolveArtifactsRoot(env);
  const artifactDir = path.join(artifactsRoot, "claude-code-agent");
  await mkdir(artifactDir, { recursive: true });

  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const fileBase = `${isoTimestampForFilename(startedDate)}__${sanitizeFilePart(nodeId)}__${randomId()}`;
  const textArtifactPath = path.join(artifactDir, `${fileBase}.md`);
  const metadataArtifactPath = path.join(artifactDir, `${fileBase}.json`);
  const observation = await beginNodeObservation({ runId: deps.runId, nodeId }, { env, now, randomId });
  const normalizedAllowedTools = params.allowedTools.map((tool) => tool.trim()).filter(Boolean);
  await observation.writeText("prompt.md", params.prompt);
  await observation.writeJson("input.json", {
    provider: params.provider.trim(),
    model: params.model.trim(),
    thinkingLevel: params.thinkingLevel,
    allowedTools: normalizedAllowedTools,
    cwd,
    agentPath,
    outputFormat: "stream-json",
    permissionMode,
    ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
  });

  let rawText = "";
  let toolExecutionCount = 0;
  let eventCount = 0;
  let mirroredAnyOutput = false;
  let mirroredEndsWithNewline = true;
  const pendingEventWrites: Array<Promise<unknown>> = [];
  let stopReason: string | undefined;
  let usage: PiAgentUsage | undefined;

  try {
    const commandResult = await runClaudeCodeCommand({
      agentPath,
      cwd,
      model: params.model.trim(),
      prompt: params.prompt,
      allowedTools: normalizedAllowedTools,
      permissionMode,
      maxTurns: params.maxTurns,
      env,
      onEvent: (event) => {
        const delta = extractAssistantDelta(event);
        if (delta) rawText += delta;
        if (event.type.includes("tool") || event.type.includes("Tool")) toolExecutionCount += 1;
        if (isClaudeCodeResultEvent(event) && typeof event.subtype === "string") stopReason = event.subtype;
        usage = extractUsage(event) ?? usage;
        eventCount += 1;
        const mirroredChunk = renderMirroredClaudeCodeEvent(event);
        if (mirroredChunk) {
          mirroredAnyOutput = true;
          mirroredEndsWithNewline = mirroredChunk.endsWith("\n");
          tryMirrorStreamChunk(streamWriter, mirroredChunk);
        }
        pendingEventWrites.push(
          observation.appendNdjson("events.ndjson", {
            at: now().toISOString(),
            ...normalizeClaudeCodeEvent(event),
          }),
        );
      },
    });

    await Promise.allSettled(pendingEventWrites);
    rawText = rawText.trim();
    if (mirroredAnyOutput && !mirroredEndsWithNewline) {
      tryMirrorStreamChunk(streamWriter, "\n");
      mirroredEndsWithNewline = true;
    }
    if (commandResult.exitCode !== 0 && rawText.length === 0) {
      throw new Error(commandResult.stderr.trim() || `Claude Code CLI exited with code ${commandResult.exitCode}`);
    }

    const finishedDate = now();
    const finishedAt = finishedDate.toISOString();
    const durationMs = finishedDate.getTime() - startedDate.getTime();
    const qualityStatus: NodeQualityStatus = rawText.length > 0 ? "success" : "failed";

    const result: ClaudeCodeAgentNodeSessionResult = {
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
      agentPath,
      outputFormat: "stream-json",
      permissionMode,
      ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
      ...(usage ? { usage } : {}),
    };

    await writeFile(textArtifactPath, rawText.length > 0 ? `${rawText}\n` : "", "utf8");
    await writeFile(metadataArtifactPath, `${JSON.stringify({ ...result, metadataArtifactPath }, null, 2)}\n`, "utf8");
    await observation.writeText("raw-output.md", rawText);
    await observation.finalize({
      executionStatus: "completed",
      qualityStatus,
      provider: result.provider,
      model: result.model,
      thinkingLevel: result.thinkingLevel,
      legacyArtifactPath: textArtifactPath,
      metadataArtifactPath,
      rawTextLength: rawText.length,
      toolExecutionCount,
      eventCount,
      stopReason,
      agentPath,
      outputFormat: "stream-json",
      permissionMode,
      ...(result.maxTurns !== undefined ? { maxTurns: result.maxTurns } : {}),
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
        input: { ...params, cwd },
        startedAt,
        finishedAt,
        agentPath,
      });
      await observation.writeJson("failure.json", {
        error: errorMessage,
        startedAt,
        finishedAt,
        agentPath,
        input: {
          provider: params.provider.trim(),
          model: params.model.trim(),
          thinkingLevel: params.thinkingLevel,
          allowedTools: normalizedAllowedTools,
          cwd,
          permissionMode,
          ...(params.maxTurns !== undefined ? { maxTurns: params.maxTurns } : {}),
        },
      });
      await observation.finalize({
        executionStatus: "failed",
        qualityStatus: "failed",
        errorMessage,
        legacyFailureArtifactPath: path.join(artifactDir, `${fileBase}__failed.json`),
        eventCount,
        toolExecutionCount,
        rawTextLength: rawText.length,
        agentPath,
        outputFormat: "stream-json",
      });
    } catch {
      // Best-effort failure artifact only.
    }
    throw error;
  }
}
