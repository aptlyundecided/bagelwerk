import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { SkillBackedAgentRuntime } from "./skillBackedCore";

const execFileAsync = promisify(execFile);

/**
 * Generic agent-harness availability check.
 *
 * Mirrors the prerequisite pattern (detect -> guidance -> gate) but for the selected
 * agent runtime CLI. Policy (see OI-0095):
 * - HARD gate on CLI presence (high-confidence `--version` probe).
 * - SOFT/advisory on auth — OAuth login state for cursor/claude can't be detected
 *   reliably headlessly, so we never block on it; we only surface guidance.
 * - GUIDANCE-ONLY for a missing CLI (no auto-install).
 * - `pi` is in-process / not bundled, so it is informational and non-gating.
 */

export type AgentHarnessAuthSignal = "present" | "unknown" | "missing" | "not-applicable";

export type AgentHarnessAvailability = {
  runtime: SkillBackedAgentRuntime;
  /** False for runtimes that are not launched via a CLI (currently `pi`). */
  isCli: boolean;
  cliName: string | null;
  /** The command name/path we probed (env override or default), or null for non-CLI runtimes. */
  resolvedCommand: string | null;
  installed: boolean;
  version: string | null;
  authSignal: AgentHarnessAuthSignal;
  /** Gate decision: true means the run may proceed. Gates on CLI presence only. */
  shouldProceed: boolean;
  notes: string[];
  /** How to install the harness when it is missing (empty when already installed). */
  installGuidance: string[];
  /** How to authenticate when auth is not detected (empty when auth looks present). */
  loginGuidance: string[];
};

export type HarnessProbeResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: string | number;
};

export type DetectAgentHarnessParams = {
  runtime: SkillBackedAgentRuntime;
  env?: NodeJS.ProcessEnv;
};

export type DetectAgentHarnessDeps = {
  /** Injectable for tests; defaults to a real `<command> --version` probe. */
  probeVersion?: (command: string, env: NodeJS.ProcessEnv) => Promise<HarnessProbeResult>;
};

const VERSION_PROBE_TIMEOUT_MS = 30_000;

async function defaultProbeVersion(command: string, env: NodeJS.ProcessEnv): Promise<HarnessProbeResult> {
  try {
    const result = await execFileAsync(command, ["--version"], {
      env,
      timeout: VERSION_PROBE_TIMEOUT_MS,
      windowsHide: true,
      // On Windows these CLIs are often .cmd/.exe shims resolved via PATHEXT, which
      // execFile only finds through a shell. Args are fixed (`--version`), not user input.
      shell: process.platform === "win32",
    });
    return { ok: true, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    return {
      ok: false,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? "").trim(),
      code: err.code,
    };
  }
}

type RuntimeDescriptor = {
  isCli: boolean;
  cliName: string | null;
  resolveCommand: (env: NodeJS.ProcessEnv) => string;
  resolveAuth: (env: NodeJS.ProcessEnv) => { signal: AgentHarnessAuthSignal; notes: string[] };
  installGuidance: string[];
  loginGuidance: string[];
};

function trimmedEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

const RUNTIME_DESCRIPTORS: Record<SkillBackedAgentRuntime, RuntimeDescriptor> = {
  cursor: {
    isCli: true,
    cliName: "cursor-agent",
    resolveCommand: (env) => trimmedEnv(env, "CURSOR_AGENT_PATH") ?? trimmedEnv(env, "AGENT_PATH") ?? "cursor-agent",
    resolveAuth: (env) =>
      trimmedEnv(env, "CURSOR_API_KEY")
        ? { signal: "present", notes: ["CURSOR_API_KEY is set."] }
        : { signal: "unknown", notes: ["No CURSOR_API_KEY; relying on cursor-agent's own login."] },
    installGuidance: ["Install the Cursor Agent CLI, or set CURSOR_AGENT_PATH to its location."],
    loginGuidance: ["Sign in to Cursor for cursor-agent, or set CURSOR_API_KEY in your environment/.env."],
  },
  "claude-code": {
    isCli: true,
    cliName: "claude",
    resolveCommand: (env) => trimmedEnv(env, "CLAUDE_CODE_PATH") ?? trimmedEnv(env, "CLAUDE_PATH") ?? "claude",
    resolveAuth: (env) =>
      trimmedEnv(env, "ANTHROPIC_API_KEY")
        ? { signal: "present", notes: ["ANTHROPIC_API_KEY is set."] }
        : { signal: "unknown", notes: ["No ANTHROPIC_API_KEY; relying on Claude Code's OAuth login."] },
    installGuidance: ["Install Claude Code (`claude`), or set CLAUDE_CODE_PATH to its location."],
    loginGuidance: ["Run `claude` once interactively to sign in, or set ANTHROPIC_API_KEY."],
  },
  opencode: {
    isCli: true,
    cliName: "opencode",
    resolveCommand: (env) => trimmedEnv(env, "OPENCODE_PATH") ?? "opencode",
    resolveAuth: (env) =>
      trimmedEnv(env, "OPENROUTER_API_KEY")
        ? { signal: "present", notes: ["OPENROUTER_API_KEY is set."] }
        : { signal: "unknown", notes: ["No OPENROUTER_API_KEY; opencode typically needs it for OpenRouter models."] },
    installGuidance: ["Install the opencode CLI, or set OPENCODE_PATH to its location."],
    loginGuidance: ["Set OPENROUTER_API_KEY (or your opencode provider's credentials) in your environment/.env."],
  },
  pi: {
    // pi is a spawned CLI (see piAgentCore), so it gates on presence like the others.
    isCli: true,
    cliName: "pi",
    resolveCommand: (env) => trimmedEnv(env, "PI_AGENT_PATH") ?? trimmedEnv(env, "PI_PATH") ?? "pi",
    // pi resolves its own provider + auth from its config; we can't (and shouldn't) probe that here.
    resolveAuth: () => ({ signal: "unknown", notes: ["pi manages its own provider + auth via its config; not checked here."] }),
    installGuidance: ["Install the pi CLI, or set PI_AGENT_PATH/PI_PATH to its location."],
    loginGuidance: ["pi manages provider credentials via its own config (e.g. its /login flow or models.json)."],
  },
};

export async function detectAgentHarness(
  params: DetectAgentHarnessParams,
  deps: DetectAgentHarnessDeps = {},
): Promise<AgentHarnessAvailability> {
  const env = params.env ?? process.env;
  const descriptor = RUNTIME_DESCRIPTORS[params.runtime];

  if (!descriptor.isCli) {
    // `pi` runs in-process and is not bundled; it needs a createSession provider wired.
    // Informational and non-gating per design.
    return {
      runtime: params.runtime,
      isCli: false,
      cliName: null,
      resolvedCommand: null,
      installed: false,
      version: null,
      authSignal: "not-applicable",
      shouldProceed: true,
      notes: [
        "pi runs in-process and is not bundled as a CLI; it requires a createSession provider to be wired.",
        "Availability cannot be verified from the command line — this check is informational only.",
      ],
      installGuidance: [],
      loginGuidance: [],
    };
  }

  const command = descriptor.resolveCommand(env);
  const probe = deps.probeVersion ?? defaultProbeVersion;
  const result = await probe(command, env);
  const installed = result.ok;
  const version = installed ? result.stdout.split(/\r?\n/, 1)[0]?.trim() || null : null;
  const auth = installed ? descriptor.resolveAuth(env) : { signal: "unknown" as AgentHarnessAuthSignal, notes: [] };

  const notes: string[] = [];
  if (installed) {
    notes.push(version ? `Detected ${descriptor.cliName} (${version}).` : `${descriptor.cliName} is installed.`);
  } else if (result.code === "ENOENT") {
    notes.push(`${descriptor.cliName} was not found on PATH${command !== descriptor.cliName ? ` or at "${command}"` : ""}.`);
  } else {
    notes.push(result.stderr || `Unable to run \`${command} --version\`.`);
  }
  notes.push(...auth.notes);

  return {
    runtime: params.runtime,
    isCli: true,
    cliName: descriptor.cliName,
    resolvedCommand: command,
    installed,
    version,
    authSignal: installed ? auth.signal : "unknown",
    // HARD gate on CLI presence; auth stays advisory and never blocks.
    shouldProceed: installed,
    notes,
    installGuidance: installed ? [] : descriptor.installGuidance,
    loginGuidance: auth.signal === "present" ? [] : descriptor.loginGuidance,
  };
}
