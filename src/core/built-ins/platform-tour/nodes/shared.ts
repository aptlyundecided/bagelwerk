import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { executePiAgentNodeSession } from "../../../agent-execution";
import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import { PlatformTourInputSchema, type PlatformTourInput } from "../platformTourTypes";

export function asTourInput(value: unknown): FlowRunnerNodeExecutionInput<PlatformTourInput> {
  return value as FlowRunnerNodeExecutionInput<PlatformTourInput>;
}

export function normalizeTourInput(input: PlatformTourInput): PlatformTourInput {
  return PlatformTourInputSchema.parse(input);
}

export function requireAcceptedArtifactPath(input: FlowRunnerNodeExecutionInput<unknown>, relativePath: string): string {
  const dependency = input.runtime.preflight.dependencies.find(
    (item) => item.relativePath === relativePath && item.exists && item.acceptedPath,
  );
  if (!dependency?.acceptedPath) throw new Error(`Missing accepted upstream artifact '${relativePath}'.`);
  return dependency.acceptedPath;
}

export async function readAcceptedTextArtifact(input: FlowRunnerNodeExecutionInput<unknown>, relativePath: string): Promise<string> {
  return readFile(requireAcceptedArtifactPath(input, relativePath), "utf8");
}

export async function writeTextArtifact(root: string, relativePath: string, value: string) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
  return { key: relativePath, label: path.basename(relativePath), path: filePath, relativePath };
}

export function openSvgHint(svgRelativePath: string): string {
  if (process.platform === "win32") return `start "" "%CD%\\${svgRelativePath.replace(/\//g, "\\")}"`;
  if (process.platform === "darwin") return `open "${svgRelativePath}"`;
  return `xdg-open "${svgRelativePath}"`;
}

export type TourAgentPolicy = { agent?: { provider?: string; model?: string } } | undefined;

export type TourRunAgentArgs = {
  prompt: string;
  cwd: string;
  runDir: string;
  nodeId: string;
  sessionId: string;
  executionPolicy?: TourAgentPolicy;
};

/** A real agent call: prompt in → text out. Injectable so tests stay deterministic and offline. */
export type TourRunAgent = (args: TourRunAgentArgs) => Promise<{ rawText: string; provider: string; model: string }>;

/**
 * Default tour agent backend: the installed `pi` CLI via executePiAgentNodeSession.
 * pi owns its own provider/auth, so provider/model are advisory labels (model "auto" lets pi decide).
 * Not streamed — the presenter TUI owns stdout/stderr.
 */
export const defaultTourRunAgent: TourRunAgent = async ({ prompt, cwd, runDir, nodeId, sessionId, executionPolicy }) => {
  // [@agents-focus] see: src/tools/built-ins/runPlatformTourFlowRunnerCli.ts — the `--present`
  // narrated playthrough swaps this real-model backend for `sampleTourRunAgent` so the
  // GETTING-STARTED "fresh clone → run a real Flow, no model cost" first step is genuinely free.
  const provider = executionPolicy?.agent?.provider?.trim() || "pi";
  const model = executionPolicy?.agent?.model?.trim() || "auto";
  const env = {
    ...process.env,
    BAGELWERK_AGENT_ARTIFACTS_ROOT: process.env.BAGELWERK_AGENT_ARTIFACTS_ROOT ?? path.join(runDir, "__agent-artifacts__"),
  };
  const session = await executePiAgentNodeSession(
    { provider, model, thinkingLevel: "low", allowedTools: [], cwd, prompt },
    { env, runId: `${sessionId}-${nodeId}`, nodeId },
  );
  return { rawText: session.rawText, provider: session.provider, model: session.model };
};

/**
 * Deterministic, offline, model-free agent stand-in for the narrated (`--present`) tour
 * playthrough. It returns a canned, node-aware friendly note instead of spawning the pi CLI,
 * so `npm run flow:tour -- --present --auto` spends no model quota and is CI-safe — the
 * GETTING-STARTED "fresh clone → run a real Flow, no model cost" first step. The tour CLI's
 * `--live` flag opts the presenter back into `defaultTourRunAgent` for a real agent run.
 *
 * Provider/model are labelled `dry-run`/`sample` so the produced notes are honest about their
 * origin; the agent-backed Nodes surface them as the `agentBackend` in their artifacts.
 */
export const sampleTourRunAgent: TourRunAgent = async ({ nodeId }) => {
  const rawText =
    nodeId === "platform-tour.read-handoff-packet"
      ? "This is a dry-run note (no live model was called): the previous step packed facts into a handoff packet, and this step opens it and explains them. Passing context in a file means later steps never rely on memory or vibes."
      : "This is a dry-run note (no live model was called): the tour has run its first small, file-producing steps. The point is that each step finishes and leaves a file the next step can build on.";
  return { rawText, provider: "dry-run", model: "sample" };
};
