import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Harness-neutral observability vocabulary for one agent run.
 *
 * Each harness keeps its native events (raw JSONL) and also projects them to
 * `AgentRunEvent`s: small, human-readable steps (a command ran, a file changed, the
 * agent said something, tokens were spent) that a caller can stream to a UI or a
 * database while the run is still going. Projection is lossy by design; the raw
 * stream stays in the Node observation directory for anything the summary drops.
 */

export type AgentHarnessId = "codex" | "claude-code";

export type AgentRunEventKind =
  | "session"
  | "turn"
  | "message"
  | "reasoning"
  | "command"
  | "file_change"
  | "tool"
  | "web_search"
  | "todo"
  | "usage"
  | "error"
  | "result"
  | "other";

export type AgentRunEventPhase = "started" | "updated" | "completed" | "failed";

export type AgentRunEvent = {
  /** 1-based order within the run. */
  seq: number;
  at: string;
  harness: AgentHarnessId;
  kind: AgentRunEventKind;
  phase?: AgentRunEventPhase;
  /** Harness item/tool id, when the harness supplies one, so started/completed pairs can be joined. */
  itemId?: string;
  /** One line a person can read in a timeline. */
  summary: string;
  /** Bounded structured detail (see `boundedDetail`). */
  detail?: Record<string, unknown>;
};

export type AgentRunEventDraft = Omit<AgentRunEvent, "seq" | "at" | "harness">;

/** Token accounting shared across harnesses. Fields a harness does not report stay 0. */
export type AgentTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export function emptyTokenUsage(): AgentTokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
}

export function addTokenUsage(a: AgentTokenUsage, b: Partial<AgentTokenUsage>): AgentTokenUsage {
  const next = {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    cachedInputTokens: a.cachedInputTokens + (b.cachedInputTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    reasoningOutputTokens: a.reasoningOutputTokens + (b.reasoningOutputTokens ?? 0),
    totalTokens: 0,
  };
  next.totalTokens = next.inputTokens + next.cacheWriteTokens + next.outputTokens;
  return next;
}

export function describeTokenUsage(usage: AgentTokenUsage): string {
  const parts = [`${usage.inputTokens.toLocaleString("en-US")} in`];
  if (usage.cachedInputTokens) parts.push(`${usage.cachedInputTokens.toLocaleString("en-US")} cached`);
  parts.push(`${usage.outputTokens.toLocaleString("en-US")} out`);
  if (usage.reasoningOutputTokens) parts.push(`${usage.reasoningOutputTokens.toLocaleString("en-US")} reasoning`);
  return parts.join(" · ");
}

export function preview(value: unknown, max = 240): string {
  const text = (typeof value === "string" ? value : JSON.stringify(value) ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function tail(value: string, max: number): string {
  return value.length > max ? `…${value.slice(-(max - 1))}` : value;
}

/** Bounds strings, arrays, objects and depth so one event can never carry a whole file or log. */
export function boundedDetail(value: unknown, depth = 0, maxString = 2000): unknown {
  if (depth >= 4) return "[max-depth]";
  if (typeof value === "string") {
    return value.length > maxString ? `${value.slice(0, maxString)}…[truncated ${value.length - maxString} chars]` : value;
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 25).map((item) => boundedDetail(item, depth + 1, maxString));
    return value.length > 25 ? [...items, `[truncated ${value.length - 25} items]`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, nested] of entries.slice(0, 25)) out[key] = boundedDetail(nested, depth + 1, maxString);
    if (entries.length > 25) out.__truncatedKeys = entries.length - 25;
    return out;
  }
  return String(value);
}

/** Error thrown by harness sessions. Carries what a caller needs to show and inspect the failure. */
export class AgentRunError extends Error {
  readonly harness: AgentHarnessId;
  readonly observationDir?: string;
  readonly exitCode?: number | null;
  readonly stderrTail?: string;
  readonly reason: "timeout" | "aborted" | "exit" | "spawn" | "invalid-output";
  readonly tokenUsage?: AgentTokenUsage;

  constructor(params: {
    message: string;
    harness: AgentHarnessId;
    reason: AgentRunError["reason"];
    observationDir?: string;
    exitCode?: number | null;
    stderrTail?: string;
    tokenUsage?: AgentTokenUsage;
  }) {
    super(params.message);
    this.name = "AgentRunError";
    this.harness = params.harness;
    this.reason = params.reason;
    this.observationDir = params.observationDir;
    this.exitCode = params.exitCode;
    this.stderrTail = params.stderrTail;
    this.tokenUsage = params.tokenUsage;
  }
}

export type JsonlProcessParams = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to stdin then closed. When omitted stdin is closed immediately. */
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onJson: (value: Record<string, unknown>) => void;
  /** Non-JSON stdout lines (progress text some CLIs still print). */
  onTextLine?: (line: string) => void;
  onStderr?: (chunk: string) => void;
  stderrTailChars?: number;
};

export type JsonlProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  timedOut: boolean;
  aborted: boolean;
};

/**
 * Spawns a CLI that writes one JSON object per stdout line.
 *
 * The child gets its own process group so timeout/abort kills the agent and every
 * command it started, not only the wrapper. Resolves on exit (never rejects on a
 * non-zero code); callers decide what an exit means. Rejects only if spawning fails.
 */
export function runJsonlProcess(params: JsonlProcessParams): Promise<JsonlProcessResult> {
  return new Promise<JsonlProcessResult>((resolve, reject) => {
    const posix = process.platform !== "win32";
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: posix,
      ...(!posix && /\.(cmd|bat)$/i.test(params.command) ? { shell: true } : {}),
    });

    let stderrTail = "";
    const maxTail = params.stderrTailChars ?? 16000;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const kill = () => {
      try {
        if (posix && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    };
    const timer = params.timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, params.timeoutMs) : undefined;
    const onAbort = () => { aborted = true; kill(); };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    if (params.signal?.aborted) onAbort();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
    };

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-maxTail);
      try { params.onStderr?.(text); } catch { /* observability only */ }
    });
    child.stdin.on("error", () => { /* child may exit before reading stdin */ });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        try { params.onTextLine?.(trimmed); } catch { /* observability only */ }
        return;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        params.onJson(parsed as Record<string, unknown>);
      } else {
        try { params.onTextLine?.(trimmed); } catch { /* observability only */ }
      }
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      rl.close();
      resolve({ exitCode: code, signal, stderrTail, timedOut, aborted });
    });

    if (params.stdin !== undefined) child.stdin.end(params.stdin);
    else child.stdin.end();
  });
}

/** Builds the per-run event recorder: stamps seq/at/harness and fans out to sinks without letting a sink break the run. */
export function createRunEventRecorder(params: {
  harness: AgentHarnessId;
  now: () => Date;
  sinks: Array<((event: AgentRunEvent) => unknown) | undefined>;
}) {
  let seq = 0;
  const pending: Array<Promise<unknown>> = [];
  return {
    emit(draft: AgentRunEventDraft): AgentRunEvent {
      const event: AgentRunEvent = { seq: ++seq, at: params.now().toISOString(), harness: params.harness, ...draft };
      for (const sink of params.sinks) {
        if (!sink) continue;
        try {
          const result = sink(event);
          if (result && typeof (result as Promise<unknown>).then === "function") {
            pending.push((result as Promise<unknown>).catch(() => undefined));
          }
        } catch {
          // A broken sink must not stop the agent.
        }
      }
      return event;
    },
    get count() {
      return seq;
    },
    async flush() {
      await Promise.allSettled(pending.splice(0));
    },
  };
}
