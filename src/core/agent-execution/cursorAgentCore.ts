import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  beginNodeObservation,
  type NodeQualityStatus,
} from "./nodeObservability";
import type { PiAgentUsage, PiThinkingLevel } from "./piAgentCore";

export type CursorAgentNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
};

export type CursorAgentNodeSessionResult = {
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
};

export type CursorAssistantEvent = {
  type: "assistant";
  message: { role: "assistant"; content: Array<{ type: "text"; text: string }> };
  session_id?: string;
};

export type CursorToolCallEvent = {
  type: "tool_call";
  subtype: "started" | "completed";
  tool_call: Record<string, {
    args?: Record<string, unknown>;
    result?: {
      success?: Record<string, unknown>;
      rejected?: { reason?: string };
      error?: { message?: string };
    };
  }>;
};

export type CursorResultEvent = {
  type: "result";
  subtype?: string;
  duration_ms?: number;
};

export type CursorStreamEvent =
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent
  | { type: string; [key: string]: unknown };

export type CursorCommandInvocation = {
  agentPath: string;
  cwd: string;
  model: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  onEvent: (event: CursorStreamEvent) => void;
};

type CursorLaunchSpec = {
  command: string;
  argsPrefix: string[];
  transport: "agent-cli" | "direct-node-runtime";
};

export type CursorCommandResult = {
  exitCode: number;
  stderr: string;
};

export type ExecuteCursorAgentNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
  runCursorCommand?: (params: CursorCommandInvocation) => Promise<CursorCommandResult>;
};

const ARTIFACTS_ROOT_ENV = "BAGELWERK_AGENT_ARTIFACTS_ROOT";
const ALLOWED_THINKING_LEVELS = new Set<PiThinkingLevel>([
  "off",
  "low",
  "medium",
  "high",
]);
const CURSOR_AGENT_PATH_ENV = "CURSOR_AGENT_PATH";
const AGENT_PATH_ENV = "AGENT_PATH";
// Default watchdog timeout for a single cursor-agent invocation (override via CURSOR_AGENT_TIMEOUT_MS).
// Sized to catch a true (indefinite) hang without killing legitimately long agent work — agents
// reasoning over a large context or doing tool/web calls can run several minutes.
const DEFAULT_CURSOR_AGENT_TIMEOUT_MS = 15 * 60 * 1000;

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

function validateParams(params: CursorAgentNodeSessionParams): void {
  if (!params.provider.trim()) throw new Error("provider is required");
  if (!params.model.trim()) throw new Error("model is required");
  if (!ALLOWED_THINKING_LEVELS.has(params.thinkingLevel)) {
    throw new Error(`thinkingLevel must be one of: ${Array.from(ALLOWED_THINKING_LEVELS).join(", ")}`);
  }
  if (!Array.isArray(params.allowedTools)) throw new Error("allowedTools must be an array");
  if (!params.prompt.trim()) throw new Error("prompt is required");
  if (!params.cwd.trim()) throw new Error("cwd is required");
}

function resolveAgentPath(env: NodeJS.ProcessEnv): string {
  const explicit = env[CURSOR_AGENT_PATH_ENV]?.trim() || env[AGENT_PATH_ENV]?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") {
    const localAppData = env["LOCALAPPDATA"]?.trim();
    if (localAppData) {
      const defaultWindowsAgent = path.join(localAppData, "cursor-agent", "agent.cmd");
      if (existsSync(defaultWindowsAgent)) return defaultWindowsAgent;
    }
  }
  return "agent";
}

function parseCursorLine(line: string): CursorStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as CursorStreamEvent;
  } catch {
    return null;
  }
}

function isCursorAssistantEvent(event: CursorStreamEvent): event is CursorAssistantEvent {
  return event.type === "assistant";
}

function isCursorToolCallEvent(event: CursorStreamEvent): event is CursorToolCallEvent {
  return event.type === "tool_call";
}

function isCursorResultEvent(event: CursorStreamEvent): event is CursorResultEvent {
  return event.type === "result";
}

function extractAssistantDelta(event: CursorStreamEvent): string {
  if (!isCursorAssistantEvent(event)) return "";
  return event.message.content
    .filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function toolCallName(event: CursorStreamEvent): string | undefined {
  if (!isCursorToolCallEvent(event)) return undefined;
  return Object.keys(event.tool_call)[0];
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

function normalizeCursorEvent(event: CursorStreamEvent): Record<string, unknown> {
  const normalized: Record<string, unknown> = { type: event.type };
  if (isCursorAssistantEvent(event)) {
    normalized.deltaChars = extractAssistantDelta(event).length;
  }
  if (isCursorToolCallEvent(event)) {
    normalized.subtype = event.subtype;
    normalized.toolName = toolCallName(event);
  }
  if (isCursorResultEvent(event)) {
    normalized.subtype = event.subtype;
    normalized.durationMs = event.duration_ms;
  }
  return normalized;
}

function renderMirroredCursorEvent(event: CursorStreamEvent): string | undefined {
  if (event.type === "assistant") {
    return extractAssistantDelta(event) || undefined;
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

function listVersionDirectories(versionsRoot: string): string[] {
  try {
    return readdirSync(versionsRoot)
      .filter((name) => /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/i.test(name))
      .filter((name) => {
        try {
          return statSync(path.join(versionsRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }));
  } catch {
    return [];
  }
}

function resolveCursorLaunchSpec(agentPath: string): CursorLaunchSpec {
  if (process.platform !== "win32" || !/\.cmd$/i.test(agentPath) || !path.isAbsolute(agentPath)) {
    return { command: agentPath, argsPrefix: [], transport: "agent-cli" };
  }

  const agentDir = path.dirname(agentPath);
  const directNodePath = path.join(agentDir, "node.exe");
  const directIndexPath = path.join(agentDir, "index.js");
  if (existsSync(directNodePath) && existsSync(directIndexPath)) {
    return {
      command: directNodePath,
      argsPrefix: [directIndexPath],
      transport: "direct-node-runtime",
    };
  }

  const versionsRoot = path.join(agentDir, "versions");
  for (const versionName of listVersionDirectories(versionsRoot)) {
    const versionDir = path.join(versionsRoot, versionName);
    const nodePath = path.join(versionDir, "node.exe");
    const indexPath = path.join(versionDir, "index.js");
    if (existsSync(nodePath) && existsSync(indexPath)) {
      return {
        command: nodePath,
        argsPrefix: [indexPath],
        transport: "direct-node-runtime",
      };
    }
  }

  return { command: agentPath, argsPrefix: [], transport: "agent-cli" };
}

async function defaultRunCursorCommand(params: CursorCommandInvocation): Promise<CursorCommandResult> {
  return await new Promise<CursorCommandResult>((resolve, reject) => {
    const launchSpec = resolveCursorLaunchSpec(params.agentPath);
    const args = [
      ...launchSpec.argsPrefix,
      "--print",
      "--output-format", "stream-json",
      "--model", params.model,
      "--trust",
      "--workspace", params.cwd,
      params.prompt,
    ];
    if (params.env["CURSOR_API_KEY"]?.trim()) {
      args.splice(launchSpec.argsPrefix.length, 0, "--api-key", params.env["CURSOR_API_KEY"]!.trim());
    }

    const child = spawn(launchSpec.command, args, {
      cwd: params.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: params.env,
      ...(process.platform === "win32" && /\.cmd$/i.test(launchSpec.command) ? { shell: true } : {}),
    });

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    // Watchdog: a cursor-agent invocation occasionally hangs (no output, never exits), which would
    // otherwise stall the whole Flow forever. Kill it after CURSOR_AGENT_TIMEOUT_MS and surface a
    // non-zero exit so the Node fails (and the supervisor can report/retry) instead of hanging.
    const timeoutMs = Number(params.env["CURSOR_AGENT_TIMEOUT_MS"]) || DEFAULT_CURSOR_AGENT_TIMEOUT_MS;
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, 2000).unref?.();
    }, timeoutMs);
    watchdog.unref?.();

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const event = parseCursorLine(line);
      if (event) params.onEvent(event);
    });

    child.on("error", (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(watchdog);
      rl.close();
      if (timedOut) {
        resolve({ exitCode: code ?? 124, stderr: `${stderrChunks.join("")}\nCursor agent timed out after ${timeoutMs}ms and was terminated.`.trim() });
        return;
      }
      resolve({ exitCode: code ?? 0, stderr: stderrChunks.join("") });
    });
  });
}

async function writeFailureArtifact(params: {
  artifactDir: string;
  fileBase: string;
  error: unknown;
  nodeId: string;
  input: CursorAgentNodeSessionParams;
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

export async function executeCursorAgentNodeSession(
  params: CursorAgentNodeSessionParams,
  deps: ExecuteCursorAgentNodeSessionDeps = {},
): Promise<CursorAgentNodeSessionResult> {
  validateParams(params);

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => randomUUID().slice(0, 8));
  const runCursorCommand = deps.runCursorCommand ?? defaultRunCursorCommand;
  const nodeId = deps.nodeId ?? "cursor.agent";
  const agentPath = resolveAgentPath(env);
  const streamEnabled = deps.stream === true;
  const streamWriter = streamEnabled ? (deps.streamWriter ?? ((chunk: string) => process.stdout.write(chunk))) : undefined;

  const cwd = await assertDirectoryExists(params.cwd, "cwd");
  const artifactsRoot = await resolveArtifactsRoot(env);
  const artifactDir = path.join(artifactsRoot, "cursor-agent");
  await mkdir(artifactDir, { recursive: true });

  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const fileBase = `${isoTimestampForFilename(startedDate)}__${sanitizeFilePart(nodeId)}__${randomId()}`;
  const textArtifactPath = path.join(artifactDir, `${fileBase}.md`);
  const metadataArtifactPath = path.join(artifactDir, `${fileBase}.json`);
  const observation = await beginNodeObservation({ runId: deps.runId, nodeId }, { env, now, randomId });
  await observation.writeText("prompt.md", params.prompt);
  await observation.writeJson("input.json", {
    provider: params.provider.trim(),
    model: params.model.trim(),
    thinkingLevel: params.thinkingLevel,
    allowedTools: params.allowedTools.map((tool) => tool.trim()),
    cwd,
    agentPath,
    outputFormat: "stream-json",
  });

  let rawText = "";
  let toolExecutionCount = 0;
  let eventCount = 0;
  let mirroredAnyOutput = false;
  let mirroredEndsWithNewline = true;
  const pendingEventWrites: Array<Promise<unknown>> = [];
  let stopReason: string | undefined;

  try {
    const commandResult = await runCursorCommand({
      agentPath,
      cwd,
      model: params.model.trim(),
      prompt: params.prompt,
      env,
      onEvent: (event) => {
        const delta = extractAssistantDelta(event);
        if (delta) rawText += delta;
        if (isCursorToolCallEvent(event) && event.subtype === "started") toolExecutionCount += 1;
        if (isCursorResultEvent(event) && typeof event.subtype === "string") stopReason = event.subtype;
        eventCount += 1;
        const mirroredChunk = renderMirroredCursorEvent(event);
        if (mirroredChunk) {
          mirroredAnyOutput = true;
          mirroredEndsWithNewline = mirroredChunk.endsWith("\n");
          tryMirrorStreamChunk(streamWriter, mirroredChunk);
        }
        pendingEventWrites.push(
          observation.appendNdjson("events.ndjson", {
            at: now().toISOString(),
            ...normalizeCursorEvent(event),
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
      throw new Error(commandResult.stderr.trim() || `Cursor CLI exited with code ${commandResult.exitCode}`);
    }

    const finishedDate = now();
    const finishedAt = finishedDate.toISOString();
    const durationMs = finishedDate.getTime() - startedDate.getTime();
    const qualityStatus: NodeQualityStatus = rawText.length > 0 ? "success" : "failed";

    const result: CursorAgentNodeSessionResult = {
      provider: params.provider.trim(),
      model: params.model.trim(),
      thinkingLevel: params.thinkingLevel,
      allowedTools: params.allowedTools.map((tool) => tool.trim()),
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
          allowedTools: params.allowedTools.map((tool) => tool.trim()),
          cwd,
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
