import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import {
  detectAgentHarness,
  type AgentHarnessAvailability,
  type DetectAgentHarnessDeps,
} from "../../../agent-execution/agentHarnessAvailability";
import {
  normalizeAgentRuntime,
  type SkillBackedAgentRuntime,
} from "../../../agent-execution/skillBackedCore";

/**
 * Generic, runtime-agnostic agent-harness availability gate (OI-0095).
 *
 * Detects whether the selected agent runtime's CLI is present (and surfaces an
 * advisory auth signal), writes a durable status artifact, and gates the run:
 * `completed` when the harness is usable, `failed` when it is missing. The
 * consuming flow decides how to branch on failure (mirrors the gh-prereqs gate).
 *
 * This node lives in `nodes/generic/` so any flow can compose it; it is not
 * tied to any single built-in flow.
 */

export type AgentHarnessCheckNodeParams = {
  /** Optional explicit runtime to check; defaults to the effective runtime from executionPolicy/env. */
  runtime?: SkillBackedAgentRuntime;
  artifactBaseName: string;
};

export type AgentHarnessCheckNodePayload = {
  finalVerdict: "harness_ready" | "harness_missing";
  acceptEligible: boolean;
  shouldProceed: boolean;
  availability: AgentHarnessAvailability;
  artifactFiles: EmittedNodeArtifactRecord[];
};

export const AgentHarnessCheckNodeParamsSchema = z
  .object({
    runtime: z.enum(["pi", "cursor", "claude-code", "opencode"]).optional(),
    artifactBaseName: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/, "artifactBaseName must be a safe file base name")
      .default("harness-status"),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Duck-type the run context (workbench or flow-runner) without coupling to flow-runner types.
function resolveRunDir(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const container of [input.runtime, input.workbench]) {
    if (isRecord(container) && isRecord(container.record)) {
      const runDir = container.record.runDir;
      if (typeof runDir === "string" && runDir.trim().length > 0) return runDir;
    }
  }
  return undefined;
}

function resolveEnvOverride(input: unknown): NodeJS.ProcessEnv {
  if (isRecord(input) && isRecord(input.userInput) && isRecord(input.userInput.env)) {
    return input.userInput.env as NodeJS.ProcessEnv;
  }
  return {};
}

function resolveExecutionPolicyAgent(input: unknown): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined;
  // The flow runner provides runtime.launchSnapshot.executionPolicy; some external CLI inputs
  // also carry userInput.executionPolicy. Prefer the runner's snapshot, fall back to userInput.
  const candidates: unknown[] = [];
  if (isRecord(input.runtime) && isRecord(input.runtime.launchSnapshot)) {
    candidates.push(input.runtime.launchSnapshot.executionPolicy);
  }
  if (isRecord(input.userInput)) {
    candidates.push(input.userInput.executionPolicy);
  }
  for (const policy of candidates) {
    if (isRecord(policy) && isRecord(policy.agent)) return policy.agent;
  }
  return undefined;
}

// Mirror skillBackedCore.resolveAgentRuntime precedence: explicit/policy -> env -> provider -> pi.
function resolveRuntime(
  input: unknown,
  env: NodeJS.ProcessEnv,
  override: SkillBackedAgentRuntime | undefined,
): SkillBackedAgentRuntime {
  if (override) return override;
  const agent = resolveExecutionPolicyAgent(input);
  const fromPolicy = typeof agent?.runtime === "string" ? normalizeAgentRuntime(agent.runtime) : undefined;
  const userInput = isRecord(input) && isRecord(input.userInput) ? input.userInput : undefined;
  const fromUserAgentRuntime = typeof userInput?.agentRuntime === "string" ? normalizeAgentRuntime(userInput.agentRuntime) : undefined;
  const fromProvider = typeof agent?.provider === "string" ? normalizeAgentRuntime(agent.provider) : undefined;
  return (
    fromPolicy ??
    fromUserAgentRuntime ??
    normalizeAgentRuntime(env.FLOW_AGENT_RUNTIME) ??
    normalizeAgentRuntime(env.BAGELWERK_AGENT_RUNTIME) ??
    normalizeAgentRuntime(env.AGENT_RUNTIME) ??
    fromProvider ??
    "pi"
  );
}

function renderMarkdown(availability: AgentHarnessAvailability): string {
  const lines = [
    "# Agent Harness Status",
    "",
    "## Runtime",
    availability.cliName ? `${availability.runtime} (\`${availability.cliName}\`)` : availability.runtime,
    "",
    "## Status",
    availability.shouldProceed ? "Ready." : "Not ready — the run is gated.",
    "",
    "## Detected",
    `- CLI: ${availability.isCli ? `\`${availability.cliName}\`` : "n/a (in-process runtime)"}`,
    `- Command probed: ${availability.resolvedCommand ? `\`${availability.resolvedCommand}\`` : "—"}`,
    `- Installed: ${availability.installed ? "yes" : "no"}`,
    `- Version: ${availability.version ?? "—"}`,
    `- Auth signal: ${availability.authSignal}`,
    "",
    "## Notes",
    ...availability.notes.map((note) => `- ${note}`),
  ];
  if (availability.installGuidance.length > 0) {
    lines.push("", "## Install", ...availability.installGuidance.map((g) => `- ${g}`));
  }
  if (availability.loginGuidance.length > 0) {
    lines.push("", "## Sign in", ...availability.loginGuidance.map((g) => `- ${g}`));
  }
  return `${lines.join("\n")}\n`;
}

async function writeHarnessArtifacts(args: {
  runDir: string | undefined;
  artifactBaseName: string;
  availability: AgentHarnessAvailability;
}): Promise<EmittedNodeArtifactRecord[]> {
  if (!args.runDir) return [];
  await mkdir(args.runDir, { recursive: true });
  const jsonRelativePath = `${args.artifactBaseName}.json`;
  const markdownRelativePath = `${args.artifactBaseName}.md`;
  const jsonPath = path.join(args.runDir, jsonRelativePath);
  const markdownPath = path.join(args.runDir, markdownRelativePath);
  await writeFile(jsonPath, `${JSON.stringify(args.availability, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(args.availability), "utf8");
  return [
    { key: jsonRelativePath, label: "Agent Harness Status JSON", path: jsonPath, relativePath: jsonRelativePath, required: true },
    { key: markdownRelativePath, label: "Agent Harness Status", path: markdownPath, relativePath: markdownRelativePath, required: true },
  ];
}

export async function runAgentHarnessCheckNode(args: {
  params: AgentHarnessCheckNodeParams;
  input: unknown;
  /** Test-only seam: forwarded to detectAgentHarness so tests avoid spawning a real CLI probe. */
  deps?: DetectAgentHarnessDeps;
}): Promise<NodeResult<AgentHarnessCheckNodePayload>> {
  const env = { ...process.env, ...resolveEnvOverride(args.input) };
  const runtime = resolveRuntime(args.input, env, args.params.runtime);
  const availability = await detectAgentHarness({ runtime, env }, args.deps);
  const runDir = resolveRunDir(args.input);
  const artifactFiles = await writeHarnessArtifacts({ runDir, artifactBaseName: args.params.artifactBaseName, availability });

  const guidance = [...availability.installGuidance, ...availability.loginGuidance];
  const note = availability.shouldProceed
    ? `Agent harness ready: ${runtime}${availability.version ? ` (${availability.version})` : ""}.`
    : `Agent harness not ready: ${runtime}. ${[...availability.notes, ...guidance].join(" ")}`.trim();

  return {
    status: availability.shouldProceed ? "completed" : "failed",
    note,
    payload: {
      finalVerdict: availability.shouldProceed ? "harness_ready" : "harness_missing",
      acceptEligible: true,
      shouldProceed: availability.shouldProceed,
      availability,
      artifactFiles,
    },
  };
}

export const coreAgentHarnessCheckNodeTypeEntry: NodeTypeEntry<
  AgentHarnessCheckNodeParams,
  unknown,
  AgentHarnessCheckNodePayload
> = {
  nodeType: "core.agent-harness-check",
  label: "Core Agent Harness Check",
  validateParams: (value: unknown) => AgentHarnessCheckNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runAgentHarnessCheckNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = AgentHarnessCheckNodeParamsSchema.parse(params);
    return {
      outputs: [
        { key: `${parsed.artifactBaseName}.json`, label: "Agent Harness Status JSON", relativePath: `${parsed.artifactBaseName}.json`, kind: "contract" },
        { key: `${parsed.artifactBaseName}.md`, label: "Agent Harness Status", relativePath: `${parsed.artifactBaseName}.md`, kind: "handoff" },
      ],
    };
  },
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
