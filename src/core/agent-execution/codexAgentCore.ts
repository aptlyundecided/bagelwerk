import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
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
  type JsonlProcessParams,
  type JsonlProcessResult,
} from "./agentRunEvents";
import { beginNodeObservation, type NodeQualityStatus } from "./nodeObservability";

/**
 * Codex CLI harness: `codex exec --json`.
 *
 * Codex prints one JSON `ThreadEvent` per line (thread.started, turn.*, item.*, error;
 * see codex-rs/exec/src/exec_events.rs). This harness records every raw event,
 * projects each one to an `AgentRunEvent` for live timelines, totals token usage,
 * and returns the final agent message.
 *
 * Sandboxing is the caller's decision. Bagelwerk adds no permission defaults: pass the
 * Codex flags/`-c` overrides you want in `execArgs` (sandbox mode, permission profile,
 * approval policy, provider retries, …) and a minimal `env` for the child.
 */

export type CodexAgentNodeSessionParams = {
  cwd: string;
  prompt: string;
  /** Passed as `--model` when set; otherwise Codex's configured default is used. */
  model?: string;
  /** Extra `codex exec` arguments, inserted before the stdin marker. Example: `["--sandbox", "read-only"]`. */
  execArgs?: string[];
  /** JSON Schema for the final message. Written into the observation dir and passed as `--output-schema`. */
  outputSchema?: unknown;
};

export type CodexFileChange = { path: string; kind: string };

export type CodexAgentNodeSessionResult = {
  cwd: string;
  prompt: string;
  model?: string;
  /** Final agent message (from `--output-last-message`, falling back to the last agent_message item). */
  rawText: string;
  threadId?: string;
  observationDir: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  tokenUsage: AgentTokenUsage;
  turnCount: number;
  commandCount: number;
  failedCommandCount: number;
  fileChanges: CodexFileChange[];
  toolCallCount: number;
  eventCount: number;
  /** Non-fatal error items and stream errors (for example reconnect notices). */
  warnings: string[];
  agentPath: string;
};

export type CodexCommandInvocation = Omit<JsonlProcessParams, "onJson" | "onTextLine" | "onStderr"> & {
  onEvent: (event: Record<string, unknown>) => void;
  onStderr?: (chunk: string) => void;
};

export type ExecuteCodexAgentNodeSessionDeps = {
  /** Environment for the Codex child process. Defaults to `process.env`. Pass a minimal env for isolated runs. */
  env?: NodeJS.ProcessEnv;
  /** Observation root. Defaults to `BAGELWERK_AGENT_ARTIFACTS_ROOT` (from `env`), then `<cwd>/.artifacts/agents`. */
  observationRoot?: string;
  now?: () => Date;
  randomId?: () => string;
  nodeId?: string;
  runId?: string;
  signal?: AbortSignal;
  /** Hard limit for the whole run. Kills the Codex process group. */
  timeoutMs?: number;
  /** Live projection of each step. Promise-returning sinks are awaited before the session returns. */
  onRunEvent?: (event: AgentRunEvent) => unknown;
  /** Raw Codex events, unmodified. */
  onRawEvent?: (event: Record<string, unknown>) => void;
  runCodexCommand?: (params: CodexCommandInvocation) => Promise<JsonlProcessResult>;
};

const CODEX_PATH_ENV = "CODEX_PATH";

function resolveAgentPath(env: NodeJS.ProcessEnv): string {
  return env[CODEX_PATH_ENV]?.trim() || "codex";
}

async function assertDirectory(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  const st = await stat(resolved).catch((error: unknown) => {
    throw new Error(`cwd is not accessible: ${resolved} (${error instanceof Error ? error.message : String(error)})`);
  });
  if (!st.isDirectory()) throw new Error(`cwd is not a directory: ${resolved}`);
  return resolved;
}

function last<T>(values: T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

const RESERVED_ARGS = new Set(["--json", "--output-last-message", "-o", "--output-schema"]);

export function buildCodexExecArgs(params: {
  model?: string;
  execArgs?: string[];
  lastMessagePath: string;
  outputSchemaPath?: string;
}): string[] {
  for (const arg of params.execArgs ?? []) {
    if (RESERVED_ARGS.has(arg)) throw new Error(`execArgs must not include ${arg}; the Codex harness sets it.`);
  }
  const args = ["exec", "--json", "--output-last-message", params.lastMessagePath];
  if (params.outputSchemaPath) args.push("--output-schema", params.outputSchemaPath);
  if (params.model?.trim()) args.push("--model", params.model.trim());
  args.push(...(params.execArgs ?? []));
  // Prompt arrives on stdin, never on the command line.
  args.push("-");
  return args;
}

type CodexItem = { id?: string; type?: string; [key: string]: unknown };

export function parseCodexUsage(value: unknown): Partial<AgentTokenUsage> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
  if (typeof usage.input_tokens !== "number" && typeof usage.output_tokens !== "number") return undefined;
  return {
    inputTokens: num("input_tokens"),
    cachedInputTokens: num("cached_input_tokens"),
    cacheWriteTokens: num("cache_write_input_tokens"),
    outputTokens: num("output_tokens"),
    reasoningOutputTokens: num("reasoning_output_tokens"),
  };
}

function phaseFor(eventType: string, item: CodexItem): AgentRunEventDraft["phase"] {
  const status = typeof item.status === "string" ? item.status : undefined;
  if (eventType === "item.started") return "started";
  if (eventType === "item.updated") return "updated";
  if (status === "failed" || status === "declined") return "failed";
  return "completed";
}

/** Projects one raw Codex `ThreadEvent` to timeline steps. Pure; exported for tests and other consumers. */
export function projectCodexEvent(event: Record<string, unknown>): AgentRunEventDraft[] {
  const type = typeof event.type === "string" ? event.type : "unknown";
  switch (type) {
    case "thread.started":
      return [{ kind: "session", phase: "started", summary: `Codex session ${String(event.thread_id ?? "")}`.trim(), detail: { threadId: event.thread_id } }];
    case "turn.started":
      return [{ kind: "turn", phase: "started", summary: "Turn started" }];
    case "turn.completed": {
      const usage = parseCodexUsage(event.usage);
      return [{
        kind: "usage",
        phase: "completed",
        summary: usage ? `Turn complete · ${describeTokenUsage(addTokenUsage(emptyTokenUsage(), usage))}` : "Turn complete",
        detail: { usage: event.usage },
      }];
    }
    case "turn.failed": {
      const message = (event.error as { message?: unknown } | undefined)?.message;
      return [{ kind: "error", phase: "failed", summary: `Turn failed: ${preview(message ?? "unknown error")}`, detail: { error: boundedDetail(event.error) as Record<string, unknown> } }];
    }
    case "error":
      return [{ kind: "error", phase: "failed", summary: `Stream error: ${preview(event.message ?? "unknown error")}`, detail: { message: event.message } }];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return projectCodexItem(type, (event.item ?? {}) as CodexItem);
    default:
      return [{ kind: "other", summary: type, detail: boundedDetail(event) as Record<string, unknown> }];
  }
}

function projectCodexItem(eventType: string, item: CodexItem): AgentRunEventDraft[] {
  const phase = phaseFor(eventType, item);
  const itemId = typeof item.id === "string" ? item.id : undefined;
  const base = { phase, ...(itemId ? { itemId } : {}) };
  switch (item.type) {
    case "agent_message":
      return [{ ...base, kind: "message", summary: preview(item.text, 300) || "(empty message)", detail: { text: boundedDetail(item.text, 0, 8000) } }];
    case "reasoning":
      return [{ ...base, kind: "reasoning", summary: preview(item.text, 300) || "(reasoning)", detail: { text: boundedDetail(item.text, 0, 4000) } }];
    case "command_execution": {
      const command = preview(item.command, 200);
      const exit = typeof item.exit_code === "number" ? ` → exit ${item.exit_code}` : "";
      const done = phase === "completed" || phase === "failed";
      return [{
        ...base,
        phase: done && typeof item.exit_code === "number" && item.exit_code !== 0 ? "failed" : base.phase,
        kind: "command",
        summary: `$ ${command}${done ? exit : ""}`,
        detail: {
          command: item.command,
          status: item.status,
          exitCode: item.exit_code,
          ...(done ? { outputTail: tail(String(item.aggregated_output ?? ""), 2000) } : {}),
        },
      }];
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? (item.changes as Array<{ path?: unknown; kind?: unknown }>) : [];
      const list = changes.slice(0, 5).map((change) => `${String(change.path)} (${String(change.kind)})`).join(", ");
      const more = changes.length > 5 ? ` +${changes.length - 5} more` : "";
      return [{ ...base, kind: "file_change", summary: `${phase === "failed" ? "Failed to change" : "Changed"} ${changes.length} file${changes.length === 1 ? "" : "s"}: ${list}${more}`, detail: { changes: boundedDetail(changes) } }];
    }
    case "mcp_tool_call":
      return [{
        ...base,
        kind: "tool",
        summary: `${String(item.server)}.${String(item.tool)}${phase === "started" ? "" : ` · ${String(item.status)}`}`,
        detail: { arguments: boundedDetail(item.arguments), error: boundedDetail(item.error), status: item.status },
      }];
    case "collab_tool_call":
      return [{ ...base, kind: "tool", summary: `collab ${String(item.tool)} · ${String(item.status)}`, detail: boundedDetail(item) as Record<string, unknown> }];
    case "web_search":
      return [{ ...base, kind: "web_search", summary: `Web search: ${preview(item.query, 200)}`, detail: { query: item.query } }];
    case "todo_list": {
      const items = Array.isArray(item.items) ? (item.items as Array<{ text?: unknown; completed?: unknown }>) : [];
      const done = items.filter((entry) => entry.completed === true).length;
      return [{ ...base, kind: "todo", summary: `Plan ${done}/${items.length} done`, detail: { items: boundedDetail(items) } }];
    }
    case "error":
      return [{ ...base, kind: "error", phase: "failed", summary: `Error: ${preview(item.message)}`, detail: { message: item.message } }];
    default:
      return [{ ...base, kind: "other", summary: `item ${String(item.type ?? "unknown")}`, detail: boundedDetail(item) as Record<string, unknown> }];
  }
}

async function defaultRunCodexCommand(params: CodexCommandInvocation): Promise<JsonlProcessResult> {
  const { onEvent, onStderr, ...rest } = params;
  return runJsonlProcess({ ...rest, onJson: onEvent, onStderr });
}

export async function executeCodexAgentNodeSession(
  params: CodexAgentNodeSessionParams,
  deps: ExecuteCodexAgentNodeSessionDeps = {},
): Promise<CodexAgentNodeSessionResult> {
  if (!params.prompt?.trim()) throw new Error("prompt is required");
  if (!params.cwd?.trim()) throw new Error("cwd is required");

  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const nodeId = deps.nodeId ?? "codex.agent";
  const agentPath = resolveAgentPath(env);
  const runCodexCommand = deps.runCodexCommand ?? defaultRunCodexCommand;
  const cwd = await assertDirectory(params.cwd);

  const observationEnv = deps.observationRoot ? { BAGELWERK_AGENT_ARTIFACTS_ROOT: deps.observationRoot } : env;
  const observation = await beginNodeObservation(
    { runId: deps.runId, nodeId },
    { env: observationEnv, now, randomId: deps.randomId ?? (() => randomUUID().slice(0, 8)) },
  );
  const lastMessagePath = path.join(observation.artifactDir, "last-message.txt");
  let outputSchemaPath: string | undefined;
  if (params.outputSchema !== undefined) {
    outputSchemaPath = path.join(observation.artifactDir, "output-schema.json");
    await writeFile(outputSchemaPath, JSON.stringify(params.outputSchema), "utf8");
  }
  const args = buildCodexExecArgs({ model: params.model, execArgs: params.execArgs, lastMessagePath, outputSchemaPath });

  await observation.writeText("prompt.md", params.prompt);
  await observation.writeJson("input.json", { harness: "codex", agentPath, cwd, model: params.model, args, timeoutMs: deps.timeoutMs });

  const started = now();
  const recorder = createRunEventRecorder({
    harness: "codex",
    now,
    sinks: [(event) => observation.appendNdjson("run-events.ndjson", event), deps.onRunEvent],
  });
  const rawWrites: Array<Promise<unknown>> = [];

  let usage = emptyTokenUsage();
  let threadId: string | undefined;
  let lastAgentMessage = "";
  let turnCount = 0;
  let commandCount = 0;
  let failedCommandCount = 0;
  let toolCallCount = 0;
  let rawEventCount = 0;
  const fileChanges: CodexFileChange[] = [];
  const warnings: string[] = [];
  const fatalErrors: string[] = [];

  const handleRaw = (event: Record<string, unknown>) => {
    rawEventCount += 1;
    rawWrites.push(observation.appendNdjson("events.ndjson", { at: now().toISOString(), ...event }).catch(() => undefined));
    try { deps.onRawEvent?.(event); } catch { /* observability only */ }

    const type = event.type;
    const item = (event.item ?? {}) as CodexItem;
    if (type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
    if (type === "turn.started") turnCount += 1;
    if (type === "turn.completed") {
      const parsed = parseCodexUsage(event.usage);
      if (parsed) usage = addTokenUsage(usage, parsed);
    }
    if (type === "turn.failed") fatalErrors.push(String((event.error as { message?: unknown } | undefined)?.message ?? "turn failed"));
    if (type === "error") {
      const message = String(event.message ?? "stream error");
      // Codex reports transient reconnects through the same channel; keep them as warnings and decide on exit.
      warnings.push(message);
    }
    if (type === "item.completed") {
      if (item.type === "agent_message" && typeof item.text === "string") lastAgentMessage = item.text;
      if (item.type === "command_execution") {
        commandCount += 1;
        if (item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0)) failedCommandCount += 1;
      }
      if (item.type === "file_change" && Array.isArray(item.changes)) {
        for (const change of item.changes as Array<{ path?: unknown; kind?: unknown }>) {
          fileChanges.push({ path: String(change.path), kind: String(change.kind) });
        }
      }
      if (item.type === "mcp_tool_call" || item.type === "collab_tool_call" || item.type === "web_search") toolCallCount += 1;
      if (item.type === "error" && typeof item.message === "string") warnings.push(item.message);
    }
    for (const draft of projectCodexEvent(event)) recorder.emit(draft);
  };

  const stderrChunks: string[] = [];
  let processResult: JsonlProcessResult | undefined;
  let failure: AgentRunError | undefined;
  try {
    processResult = await runCodexCommand({
      command: agentPath,
      args,
      cwd,
      env,
      stdin: params.prompt,
      signal: deps.signal,
      timeoutMs: deps.timeoutMs,
      onEvent: handleRaw,
      onStderr: (chunk) => { stderrChunks.push(chunk); },
    });
  } catch (error) {
    failure = new AgentRunError({
      message: `Could not start Codex (${agentPath}): ${error instanceof Error ? error.message : String(error)}`,
      harness: "codex",
      reason: "spawn",
      observationDir: observation.artifactDir,
    });
  }

  await Promise.allSettled(rawWrites);
  const finished = now();
  const stderrTail = processResult?.stderrTail ?? tail(stderrChunks.join(""), 16000);
  if (stderrTail) await observation.writeText("stderr.txt", stderrTail).catch(() => undefined);

  let rawText = lastAgentMessage;
  try {
    const fromFile = await readFile(lastMessagePath, "utf8");
    if (fromFile.trim()) rawText = fromFile;
  } catch {
    // Codex writes the file only when a final message exists.
  }
  rawText = rawText.trim();

  if (!failure && processResult) {
    const exitDescription = processResult.timedOut
      ? `Codex reached the ${Math.round((deps.timeoutMs ?? 0) / 1000)}s limit`
      : processResult.aborted
        ? "Codex run was cancelled"
        : processResult.exitCode !== 0
          ? `Codex exited ${processResult.exitCode ?? processResult.signal}`
          : undefined;
    if (exitDescription) {
      const cause = last(fatalErrors) ?? last(warnings) ?? preview(tail(stderrTail, 600), 600);
      failure = new AgentRunError({
        message: cause ? `${exitDescription}: ${cause}` : exitDescription,
        harness: "codex",
        reason: processResult.timedOut ? "timeout" : processResult.aborted ? "aborted" : "exit",
        observationDir: observation.artifactDir,
        exitCode: processResult.exitCode,
        stderrTail,
        tokenUsage: usage,
      });
    } else if (fatalErrors.length > 0) {
      failure = new AgentRunError({
        message: `Codex turn failed: ${last(fatalErrors)}`,
        harness: "codex",
        reason: "exit",
        observationDir: observation.artifactDir,
        exitCode: processResult.exitCode,
        stderrTail,
        tokenUsage: usage,
      });
    }
  }

  const summaryBase = {
    harness: "codex",
    threadId,
    model: params.model,
    exitCode: processResult?.exitCode ?? null,
    durationMs: finished.getTime() - started.getTime(),
    tokenUsage: usage,
    turnCount,
    commandCount,
    failedCommandCount,
    fileChangeCount: fileChanges.length,
    toolCallCount,
    rawEventCount,
    warnings: warnings.slice(-20),
  };

  if (failure) {
    recorder.emit({ kind: "result", phase: "failed", summary: failure.message, detail: { reason: failure.reason, exitCode: failure.exitCode } });
    await recorder.flush();
    await observation.writeJson("failure.json", { error: failure.message, reason: failure.reason, stderrTail: tail(stderrTail, 4000) }).catch(() => undefined);
    await observation.finalize({ ...summaryBase, executionStatus: "failed", qualityStatus: "failed", errorMessage: failure.message, runEventCount: recorder.count }).catch(() => undefined);
    throw failure;
  }

  recorder.emit({
    kind: "result",
    phase: "completed",
    summary: `Finished · ${turnCount} turn${turnCount === 1 ? "" : "s"} · ${commandCount} command${commandCount === 1 ? "" : "s"} · ${fileChanges.length} file change${fileChanges.length === 1 ? "" : "s"} · ${describeTokenUsage(usage)}`,
    detail: { tokenUsage: usage },
  });
  await recorder.flush();

  const qualityStatus: NodeQualityStatus = rawText.length === 0 ? "failed" : warnings.length > 0 ? "degraded" : "success";
  await observation.writeText("raw-output.md", rawText);
  await observation.finalize({
    ...summaryBase,
    runEventCount: recorder.count,
    executionStatus: "completed",
    qualityStatus,
    ...(qualityStatus !== "success" ? { qualityReasons: rawText.length === 0 ? ["no final agent message"] : ["stream warnings during run"] } : {}),
  });

  return {
    cwd,
    prompt: params.prompt,
    ...(params.model ? { model: params.model } : {}),
    rawText,
    ...(threadId ? { threadId } : {}),
    observationDir: observation.artifactDir,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: summaryBase.durationMs,
    exitCode: processResult?.exitCode ?? null,
    tokenUsage: usage,
    turnCount,
    commandCount,
    failedCommandCount,
    fileChanges,
    toolCallCount,
    eventCount: rawEventCount,
    warnings,
    agentPath,
  };
}
