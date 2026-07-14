import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  beginNodeObservation,
  type NodeQualityStatus,
} from "./nodeObservability";
import type { PiAgentUsage, PiThinkingLevel } from "./piAgentCore";

export type OpenCodeAgentNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  agent?: string;
  skipPermissions?: boolean;
};

export type OpenCodeAgentNodeSessionResult = {
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
  outputFormat: "json";
  agent?: string;
  skipPermissions?: boolean;
};

export type OpenCodeMessagePartUpdatedEvent = {
  type: "message.part.updated";
  id?: string;
  messageId?: string;
  role?: string;
  delta?: { type?: string; text?: string };
  part?: { type?: string; content?: string };
  done?: boolean;
};

export type OpenCodeTextEvent = {
  type: "text";
  id?: string;
  messageID?: string;
  sessionID?: string;
  part?: { type?: string; text?: string };
};

export type OpenCodeMessageCompletedEvent = {
  type: "message.completed";
  id?: string;
  role?: string;
};

export type OpenCodeSessionCompletedEvent = {
  type: "session.completed";
  status?: string;
};

export type OpenCodeStreamEvent =
  | OpenCodeMessagePartUpdatedEvent
  | OpenCodeTextEvent
  | OpenCodeMessageCompletedEvent
  | OpenCodeSessionCompletedEvent
  | { type: string; [key: string]: unknown };

export type OpenCodeCommandInvocation = {
  agentPath: string;
  cwd: string;
  model: string;
  prompt: string;
  agent?: string;
  skipPermissions?: boolean;
  env: NodeJS.ProcessEnv;
  onEvent: (event: OpenCodeStreamEvent) => void;
};

export type OpenCodeCommandResult = {
  exitCode: number;
  stderr: string;
};

export type ExecuteOpenCodeAgentNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
  runOpenCodeCommand?: (params: OpenCodeCommandInvocation) => Promise<OpenCodeCommandResult>;
};

const ARTIFACTS_ROOT_ENV = "BAGELWERK_AGENT_ARTIFACTS_ROOT";
const ALLOWED_THINKING_LEVELS = new Set<PiThinkingLevel>([
  "off",
  "low",
  "medium",
  "high",
]);
const OPENCODE_PATH_ENV = "OPENCODE_PATH";

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

function validateParams(params: OpenCodeAgentNodeSessionParams): void {
  if (!params.provider.trim()) throw new Error("provider is required");
  if (!params.model.trim()) throw new Error("model is required");
  if (!ALLOWED_THINKING_LEVELS.has(params.thinkingLevel)) {
    throw new Error(`thinkingLevel must be one of: ${Array.from(ALLOWED_THINKING_LEVELS).join(", ")}`);
  }
  if (!Array.isArray(params.allowedTools)) throw new Error("allowedTools must be an array");
  if (!params.prompt.trim()) throw new Error("prompt is required");
  if (!params.cwd.trim()) throw new Error("cwd is required");
  if (params.agent !== undefined && !params.agent.trim()) throw new Error("agent must not be empty when provided");
}

function resolveAgentPath(env: NodeJS.ProcessEnv): string {
  const explicit = env[OPENCODE_PATH_ENV]?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") {
    const pathEntries = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
    for (const entry of pathEntries) {
      for (const name of ["opencode.cmd", "opencode.exe", "opencode"]) {
        const candidate = path.join(entry, name);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "opencode";
}

type OpenCodeLaunchSpec = {
  command: string;
  argsPrefix: string[];
  shell?: boolean;
};

function resolveOpenCodeLaunchSpec(agentPath: string): OpenCodeLaunchSpec {
  if (process.platform !== "win32") return { command: agentPath, argsPrefix: [] };

  const candidates = [agentPath];
  const dir = path.dirname(agentPath);
  const opencodeScript = path.join(dir, "node_modules", "opencode-ai", "bin", "opencode");
  if (existsSync(opencodeScript)) {
    return { command: process.execPath, argsPrefix: [opencodeScript] };
  }

  for (const candidate of candidates) {
    if (/\.(cmd|bat)$/i.test(candidate)) return { command: candidate, argsPrefix: [], shell: true };
  }
  return { command: agentPath, argsPrefix: [] };
}

function parseOpenCodeLine(line: string): OpenCodeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as OpenCodeStreamEvent;
  } catch {
    return null;
  }
}

function isOpenCodeMessagePartUpdatedEvent(event: OpenCodeStreamEvent): event is OpenCodeMessagePartUpdatedEvent {
  return event.type === "message.part.updated";
}

function isOpenCodeTextEvent(event: OpenCodeStreamEvent): event is OpenCodeTextEvent {
  return event.type === "text";
}

function isOpenCodeMessageCompletedEvent(event: OpenCodeStreamEvent): event is OpenCodeMessageCompletedEvent {
  return event.type === "message.completed";
}

function isOpenCodeSessionCompletedEvent(event: OpenCodeStreamEvent): event is OpenCodeSessionCompletedEvent {
  return event.type === "session.completed";
}

function extractAssistantDelta(event: OpenCodeStreamEvent): string {
  if (isOpenCodeTextEvent(event)) {
    return typeof event.part?.text === "string" ? event.part.text : "";
  }
  if (!isOpenCodeMessagePartUpdatedEvent(event)) return "";
  if (event.role && event.role !== "assistant") return "";
  if (event.delta?.type === "text" && typeof event.delta.text === "string") return event.delta.text;
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

function normalizeOpenCodeEvent(event: OpenCodeStreamEvent): Record<string, unknown> {
  const normalized: Record<string, unknown> = { type: event.type };
  if (isOpenCodeMessagePartUpdatedEvent(event)) {
    normalized.deltaChars = extractAssistantDelta(event).length;
    normalized.messageId = event.messageId;
    normalized.partId = event.id;
    normalized.done = event.done;
  }
  if (isOpenCodeTextEvent(event)) {
    normalized.deltaChars = extractAssistantDelta(event).length;
    normalized.messageId = event.messageID;
    normalized.partId = event.id;
  }
  if (isOpenCodeMessageCompletedEvent(event)) {
    normalized.messageId = event.id;
    normalized.role = event.role;
  }
  if (isOpenCodeSessionCompletedEvent(event)) {
    normalized.status = event.status;
  }
  if (event.type.includes("tool") || event.type.includes("Tool")) {
    normalized.toolEvent = true;
  }
  return normalized;
}

function renderMirroredOpenCodeEvent(event: OpenCodeStreamEvent): string | undefined {
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

async function defaultRunOpenCodeCommand(params: OpenCodeCommandInvocation): Promise<OpenCodeCommandResult> {
  return await new Promise<OpenCodeCommandResult>((resolve, reject) => {
    const launchSpec = resolveOpenCodeLaunchSpec(params.agentPath);
    const args = [
      ...launchSpec.argsPrefix,
      "run",
      "--model", params.model,
      "--format", "json",
      "--dir", params.cwd,
    ];
    if (params.agent) {
      args.push("--agent", params.agent);
    }
    if (params.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    args.push(params.prompt);

    const child = spawn(launchSpec.command, args, {
      cwd: params.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: params.env,
      ...(launchSpec.shell ? { shell: true } : {}),
    });

    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const event = parseOpenCodeLine(line);
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
  input: OpenCodeAgentNodeSessionParams;
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

export async function executeOpenCodeAgentNodeSession(
  params: OpenCodeAgentNodeSessionParams,
  deps: ExecuteOpenCodeAgentNodeSessionDeps = {},
): Promise<OpenCodeAgentNodeSessionResult> {
  validateParams(params);

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const randomId = deps.randomId ?? (() => randomUUID().slice(0, 8));
  const runOpenCodeCommand = deps.runOpenCodeCommand ?? defaultRunOpenCodeCommand;
  const nodeId = deps.nodeId ?? "opencode.agent";
  const agentPath = resolveAgentPath(env);
  const streamEnabled = deps.stream === true;
  const streamWriter = streamEnabled ? (deps.streamWriter ?? ((chunk: string) => process.stdout.write(chunk))) : undefined;

  const cwd = await assertDirectoryExists(params.cwd, "cwd");
  const artifactsRoot = await resolveArtifactsRoot(env);
  const artifactDir = path.join(artifactsRoot, "opencode-agent");
  await mkdir(artifactDir, { recursive: true });

  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const fileBase = `${isoTimestampForFilename(startedDate)}__${sanitizeFilePart(nodeId)}__${randomId()}`;
  const textArtifactPath = path.join(artifactDir, `${fileBase}.md`);
  const metadataArtifactPath = path.join(artifactDir, `${fileBase}.json`);
  const observation = await beginNodeObservation({ runId: deps.runId, nodeId }, { env, now, randomId });
  const normalizedAllowedTools = params.allowedTools.map((tool) => tool.trim()).filter(Boolean);
  const normalizedAgent = params.agent?.trim();
  await observation.writeText("prompt.md", params.prompt);
  await observation.writeJson("input.json", {
    provider: params.provider.trim(),
    model: params.model.trim(),
    thinkingLevel: params.thinkingLevel,
    allowedTools: normalizedAllowedTools,
    cwd,
    agentPath,
    outputFormat: "json",
    ...(normalizedAgent ? { agent: normalizedAgent } : {}),
    ...(params.skipPermissions !== undefined ? { skipPermissions: params.skipPermissions } : {}),
  });

  let rawText = "";
  let toolExecutionCount = 0;
  let eventCount = 0;
  let mirroredAnyOutput = false;
  let mirroredEndsWithNewline = true;
  const pendingEventWrites: Array<Promise<unknown>> = [];
  let stopReason: string | undefined;

  try {
    const commandResult = await runOpenCodeCommand({
      agentPath,
      cwd,
      model: params.model.trim(),
      prompt: params.prompt,
      agent: normalizedAgent,
      skipPermissions: params.skipPermissions,
      env,
      onEvent: (event) => {
        const delta = extractAssistantDelta(event);
        if (delta) rawText += delta;
        if (event.type.includes("tool") || event.type.includes("Tool")) toolExecutionCount += 1;
        if (isOpenCodeSessionCompletedEvent(event) && typeof event.status === "string") stopReason = event.status;
        eventCount += 1;
        const mirroredChunk = renderMirroredOpenCodeEvent(event);
        if (mirroredChunk) {
          mirroredAnyOutput = true;
          mirroredEndsWithNewline = mirroredChunk.endsWith("\n");
          tryMirrorStreamChunk(streamWriter, mirroredChunk);
        }
        pendingEventWrites.push(
          observation.appendNdjson("events.ndjson", {
            at: now().toISOString(),
            ...normalizeOpenCodeEvent(event),
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
      throw new Error(commandResult.stderr.trim() || `OpenCode CLI exited with code ${commandResult.exitCode}`);
    }

    const finishedDate = now();
    const finishedAt = finishedDate.toISOString();
    const durationMs = finishedDate.getTime() - startedDate.getTime();
    const qualityStatus: NodeQualityStatus = rawText.length > 0 ? "success" : "failed";

    const result: OpenCodeAgentNodeSessionResult = {
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
      outputFormat: "json",
      ...(normalizedAgent ? { agent: normalizedAgent } : {}),
      ...(params.skipPermissions !== undefined ? { skipPermissions: params.skipPermissions } : {}),
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
      outputFormat: "json",
      ...(result.agent ? { agent: result.agent } : {}),
      ...(result.skipPermissions !== undefined ? { skipPermissions: result.skipPermissions } : {}),
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
        input: { ...params, cwd, ...(normalizedAgent ? { agent: normalizedAgent } : {}) },
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
          ...(normalizedAgent ? { agent: normalizedAgent } : {}),
          ...(params.skipPermissions !== undefined ? { skipPermissions: params.skipPermissions } : {}),
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
        outputFormat: "json",
      });
    } catch {
      // Best-effort failure artifact only.
    }
    throw error;
  }
}
