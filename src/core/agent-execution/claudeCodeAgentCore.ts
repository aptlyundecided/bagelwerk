import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AgentRunError,
  addTokenUsage,
  boundedDetail,
  createRunEventRecorder,
  describeTokenUsage,
  emptyTokenUsage,
  preview,
  runJsonlProcess,
  tail,
  type AgentRunEvent,
  type AgentRunEventDraft,
  type AgentTokenUsage,
} from "./agentRunEvents";
import {
  beginNodeObservation,
  type NodeQualityStatus,
} from "./nodeObservability";
import type { PiAgentUsage, PiThinkingLevel } from "./piAgentCore";

// `dontAsk` denies every tool call not pre-approved by `allowedTools`/settings: the right mode for unattended, scoped runs.
export type ClaudeCodePermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions" | "dontAsk";

export type ClaudeCodeAgentNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  permissionMode?: ClaudeCodePermissionMode;
  maxTurns?: number;
  /** Passed as `--disallowedTools`. */
  disallowedTools?: string[];
  /** Extra CLI arguments (for example `--settings <json>`, `--add-dir`, `--strict-mcp-config`), placed before the prompt. */
  extraArgs?: string[];
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
  /** Native Claude Code token accounting from the final `result` event. */
  tokenUsage?: AgentTokenUsage;
  costUsd?: number;
  numTurns?: number;
  sessionId?: string;
  /** The final `result` text Claude Code reports (the last assistant answer), when present. */
  resultText?: string;
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
  disallowedTools?: string[];
  extraArgs?: string[];
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent: (event: ClaudeCodeStreamEvent) => void;
};

export type ClaudeCodeCommandResult = {
  exitCode: number;
  stderr: string;
  timedOut?: boolean;
  aborted?: boolean;
};

export type ExecuteClaudeCodeAgentNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
  /** Observation/artifact root. Satisfies the `BAGELWERK_AGENT_ARTIFACTS_ROOT` requirement without adding it to the child env. */
  observationRoot?: string;
  signal?: AbortSignal;
  /** Hard limit for the whole run. Kills the Claude Code process group. */
  timeoutMs?: number;
  /** Live projection of each step (tool calls, results, messages, usage). */
  onRunEvent?: (event: AgentRunEvent) => unknown;
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
  "dontAsk",
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

async function resolveArtifactsRoot(env: NodeJS.ProcessEnv, override?: string): Promise<string> {
  const raw = override?.trim() || env[ARTIFACTS_ROOT_ENV]?.trim();
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
  if (params.disallowedTools !== undefined && !Array.isArray(params.disallowedTools)) throw new Error("disallowedTools must be an array");
  if (params.extraArgs !== undefined && !Array.isArray(params.extraArgs)) throw new Error("extraArgs must be an array");
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

/** Claude Code's own `result.usage` shape (Anthropic API field names). */
export function parseClaudeCodeNativeUsage(value: unknown): Partial<AgentTokenUsage> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  if (typeof usage.input_tokens !== "number" && typeof usage.output_tokens !== "number") return undefined;
  const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
  return {
    inputTokens: num("input_tokens") + num("cache_read_input_tokens"),
    cachedInputTokens: num("cache_read_input_tokens"),
    cacheWriteTokens: num("cache_creation_input_tokens"),
    outputTokens: num("output_tokens"),
  };
}

type ClaudeContentBlock = { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown };

function describeToolInput(name: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  const pick = value.command ?? value.file_path ?? value.path ?? value.pattern ?? value.url ?? value.query ?? value.description;
  return pick !== undefined ? `${name}: ${preview(pick, 200)}` : `${name} ${preview(value, 160)}`;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("\n");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

/**
 * Projects one Claude Code stream-json event to timeline steps. `toolNames` joins
 * tool_result blocks back to the tool_use that started them. Pure apart from that map.
 */
export function projectClaudeCodeEvent(event: ClaudeCodeStreamEvent, toolNames: Map<string, string> = new Map()): AgentRunEventDraft[] {
  const raw = event as Record<string, unknown>;
  if (event.type === "system") {
    if (raw.subtype === "init") {
      return [{
        kind: "session",
        phase: "started",
        summary: `Claude Code session${raw.model ? ` · ${String(raw.model)}` : ""}${raw.permissionMode ? ` · ${String(raw.permissionMode)}` : ""}`,
        detail: { sessionId: raw.session_id, model: raw.model, tools: Array.isArray(raw.tools) ? raw.tools.length : undefined, permissionMode: raw.permissionMode },
      }];
    }
    return [{ kind: "other", summary: `system ${String(raw.subtype ?? "")}`.trim(), detail: boundedDetail(raw) as Record<string, unknown> }];
  }
  if (event.type === "assistant" || event.type === "user") {
    const blocks = ((raw.message as { content?: unknown } | undefined)?.content ?? []) as ClaudeContentBlock[] | string;
    if (!Array.isArray(blocks)) return [];
    const drafts: AgentRunEventDraft[] = [];
    for (const block of blocks) {
      if (block?.type === "text" && event.type === "assistant" && block.text?.trim()) {
        drafts.push({ kind: "message", phase: "completed", summary: preview(block.text, 300), detail: { text: boundedDetail(block.text, 0, 8000) } });
      } else if (block?.type === "thinking" && block.thinking?.trim()) {
        drafts.push({ kind: "reasoning", phase: "completed", summary: preview(block.thinking, 300), detail: { text: boundedDetail(block.thinking, 0, 4000) } });
      } else if (block?.type === "tool_use") {
        const name = String(block.name ?? "tool");
        if (block.id) toolNames.set(block.id, name);
        drafts.push({
          kind: name === "Bash" ? "command" : name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit" ? "file_change" : name === "WebSearch" ? "web_search" : name === "TodoWrite" ? "todo" : "tool",
          phase: "started",
          ...(block.id ? { itemId: block.id } : {}),
          summary: name === "Bash" ? `$ ${preview((block.input as { command?: unknown } | undefined)?.command, 200)}` : describeToolInput(name, block.input),
          detail: { tool: name, input: boundedDetail(block.input) },
        });
      } else if (block?.type === "tool_result") {
        const name = (block.tool_use_id && toolNames.get(block.tool_use_id)) || "tool";
        const text = toolResultText(block.content);
        drafts.push({
          kind: name === "Bash" ? "command" : name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit" ? "file_change" : "tool",
          phase: block.is_error ? "failed" : "completed",
          ...(block.tool_use_id ? { itemId: block.tool_use_id } : {}),
          summary: `${name} ${block.is_error ? "failed" : "done"}${text.trim() ? `: ${preview(text, 160)}` : ""}`,
          detail: { tool: name, isError: block.is_error === true, outputTail: tail(text, 2000) },
        });
      }
    }
    return drafts;
  }
  if (event.type === "result") {
    const usage = parseClaudeCodeNativeUsage(raw.usage);
    const cost = typeof raw.total_cost_usd === "number" ? ` · $${raw.total_cost_usd.toFixed(4)}` : "";
    const failed = raw.is_error === true || (typeof raw.subtype === "string" && raw.subtype !== "success");
    return [{
      kind: "usage",
      phase: failed ? "failed" : "completed",
      summary: `Result ${String(raw.subtype ?? "")}${typeof raw.num_turns === "number" ? ` · ${raw.num_turns} turns` : ""}${usage ? ` · ${describeTokenUsage(addTokenUsage(emptyTokenUsage(), usage))}` : ""}${cost}`,
      detail: { subtype: raw.subtype, numTurns: raw.num_turns, durationMs: raw.duration_ms, costUsd: raw.total_cost_usd, usage: raw.usage, isError: raw.is_error },
    }];
  }
  if (event.type === "stream_event") return [];
  return [{ kind: "other", summary: String(event.type), detail: boundedDetail(raw) as Record<string, unknown> }];
}

export function buildClaudeCodeArgs(params: Pick<ClaudeCodeCommandInvocation, "model" | "permissionMode" | "maxTurns" | "allowedTools" | "disallowedTools" | "extraArgs" | "prompt">): string[] {
  const args = [
    "-p",
    // Claude Code requires --verbose when combining --print with stream-json output.
    "--verbose",
    "--output-format", "stream-json",
    "--model", params.model,
  ];
  if (params.permissionMode) args.push("--permission-mode", params.permissionMode);
  if (params.maxTurns !== undefined) args.push("--max-turns", String(params.maxTurns));
  const allowedTools = params.allowedTools.map((tool) => tool.trim()).filter(Boolean);
  if (allowedTools.length > 0) args.push("--allowedTools", ...allowedTools);
  const disallowedTools = (params.disallowedTools ?? []).map((tool) => tool.trim()).filter(Boolean);
  if (disallowedTools.length > 0) args.push("--disallowedTools", ...disallowedTools);
  args.push(...(params.extraArgs ?? []));
  // `--` ends variadic tool lists so the prompt is never read as a tool name.
  args.push("--", params.prompt);
  return args;
}

async function defaultRunClaudeCodeCommand(params: ClaudeCodeCommandInvocation): Promise<ClaudeCodeCommandResult> {
  const result = await runJsonlProcess({
    command: params.agentPath,
    args: buildClaudeCodeArgs(params),
    cwd: params.cwd,
    env: params.env,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    onJson: (value) => {
      if (typeof value.type === "string") params.onEvent(value as ClaudeCodeStreamEvent);
    },
  });
  return { exitCode: result.exitCode ?? 1, stderr: result.stderrTail, timedOut: result.timedOut, aborted: result.aborted };
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
  const artifactsRoot = await resolveArtifactsRoot(env, deps.observationRoot);
  const artifactDir = path.join(artifactsRoot, "claude-code-agent");
  await mkdir(artifactDir, { recursive: true });

  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const fileBase = `${isoTimestampForFilename(startedDate)}__${sanitizeFilePart(nodeId)}__${randomId()}`;
  const textArtifactPath = path.join(artifactDir, `${fileBase}.md`);
  const metadataArtifactPath = path.join(artifactDir, `${fileBase}.json`);
  const observation = await beginNodeObservation(
    { runId: deps.runId, nodeId },
    { env: deps.observationRoot ? { ...env, [ARTIFACTS_ROOT_ENV]: artifactsRoot } : env, now, randomId },
  );
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
    ...(params.disallowedTools?.length ? { disallowedTools: params.disallowedTools } : {}),
    ...(params.extraArgs?.length ? { extraArgs: params.extraArgs } : {}),
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  });

  const recorder = createRunEventRecorder({
    harness: "claude-code",
    now,
    sinks: [(event) => observation.appendNdjson("run-events.ndjson", event), deps.onRunEvent],
  });
  const toolNames = new Map<string, string>();
  let tokenUsage: AgentTokenUsage | undefined;
  let costUsd: number | undefined;
  let numTurns: number | undefined;
  let sessionId: string | undefined;
  let resultText: string | undefined;
  let resultIsError = false;

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
      disallowedTools: params.disallowedTools,
      extraArgs: params.extraArgs,
      env,
      signal: deps.signal,
      timeoutMs: deps.timeoutMs,
      onEvent: (event) => {
        const delta = extractAssistantDelta(event);
        if (delta) rawText += delta;
        if (event.type.includes("tool") || event.type.includes("Tool")) toolExecutionCount += 1;
        if (isClaudeCodeResultEvent(event) && typeof event.subtype === "string") stopReason = event.subtype;
        usage = extractUsage(event) ?? usage;
        const record = event as Record<string, unknown>;
        if (event.type === "system" && typeof record.session_id === "string") sessionId = record.session_id;
        if (isClaudeCodeResultEvent(event)) {
          const native = parseClaudeCodeNativeUsage(record.usage);
          if (native) tokenUsage = addTokenUsage(emptyTokenUsage(), native);
          if (typeof record.total_cost_usd === "number") costUsd = record.total_cost_usd;
          if (typeof record.num_turns === "number") numTurns = record.num_turns;
          if (typeof record.result === "string") resultText = record.result;
          resultIsError = record.is_error === true;
        }
        for (const draft of projectClaudeCodeEvent(event, toolNames)) recorder.emit(draft);
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
    await recorder.flush();
    rawText = rawText.trim();
    if (mirroredAnyOutput && !mirroredEndsWithNewline) {
      tryMirrorStreamChunk(streamWriter, "\n");
      mirroredEndsWithNewline = true;
    }
    if (commandResult.timedOut || commandResult.aborted) {
      throw new AgentRunError({
        message: commandResult.timedOut
          ? `Claude Code reached the ${Math.round((deps.timeoutMs ?? 0) / 1000)}s limit`
          : "Claude Code run was cancelled",
        harness: "claude-code",
        reason: commandResult.timedOut ? "timeout" : "aborted",
        observationDir: observation.artifactDir,
        exitCode: commandResult.exitCode,
        stderrTail: tail(commandResult.stderr, 16000),
        tokenUsage,
      });
    }
    if (commandResult.exitCode !== 0 && rawText.length === 0) {
      throw new AgentRunError({
        message: commandResult.stderr.trim() || `Claude Code CLI exited with code ${commandResult.exitCode}`,
        harness: "claude-code",
        reason: "exit",
        observationDir: observation.artifactDir,
        exitCode: commandResult.exitCode,
        stderrTail: tail(commandResult.stderr, 16000),
        tokenUsage,
      });
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
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(numTurns !== undefined ? { numTurns } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(resultText !== undefined ? { resultText } : {}),
    };
    recorder.emit({
      kind: "result",
      phase: resultIsError ? "failed" : "completed",
      summary: `Finished${numTurns !== undefined ? ` · ${numTurns} turns` : ""}${tokenUsage ? ` · ${describeTokenUsage(tokenUsage)}` : ""}${costUsd !== undefined ? ` · $${costUsd.toFixed(4)}` : ""}`,
      detail: { stopReason, tokenUsage, costUsd },
    });
    await recorder.flush();

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
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(numTurns !== undefined ? { numTurns } : {}),
      ...(sessionId ? { sessionId } : {}),
      runEventCount: recorder.count,
    });

    return result;
  } catch (error) {
    await Promise.allSettled(pendingEventWrites);
    recorder.emit({ kind: "result", phase: "failed", summary: error instanceof Error ? error.message : String(error) });
    await recorder.flush();
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
        ...(tokenUsage ? { tokenUsage } : {}),
        runEventCount: recorder.count,
      });
    } catch {
      // Best-effort failure artifact only.
    }
    if (error instanceof AgentRunError) throw error;
    throw new AgentRunError({
      message: error instanceof Error ? error.message : String(error),
      harness: "claude-code",
      reason: "spawn",
      observationDir: observation.artifactDir,
      tokenUsage,
    });
  }
}
