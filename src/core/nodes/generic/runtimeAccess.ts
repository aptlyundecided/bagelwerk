import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { executePiAgentNodeSession, type PiThinkingLevel } from "../../agent-execution";
import type { EmittedNodeArtifactRecord } from "../config";

// Shared runtime access for the generic primitive Nodes. These Nodes are runner-agnostic:
// they duck-type the execution input so they work under both the Flow Runner (`input.runtime`)
// and the legacy workbench (`input.workbench`) without importing either module.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The directory a Node writes its emitted artifacts into. Throws if it cannot be resolved. */
export function resolveRunDir(input: unknown): string {
  if (isRecord(input)) {
    for (const key of ["runtime", "workbench"] as const) {
      const surface = input[key];
      if (isRecord(surface) && isRecord(surface.record) && typeof surface.record.runDir === "string") {
        return surface.record.runDir;
      }
    }
  }
  throw new Error("Could not resolve the Node run directory from the execution input.");
}

export function resolveEnv(input: unknown): NodeJS.ProcessEnv {
  if (isRecord(input) && isRecord(input.userInput) && isRecord(input.userInput.env)) {
    return { ...process.env, ...(input.userInput.env as NodeJS.ProcessEnv) };
  }
  return process.env;
}

export function resolveSessionId(input: unknown): string {
  if (isRecord(input)) {
    for (const key of ["runtime", "workbench"] as const) {
      const surface = input[key];
      if (isRecord(surface) && typeof surface.sessionId === "string") return surface.sessionId;
    }
  }
  return "session";
}

/** Reject paths that escape the run directory (no absolute paths, no `..` segments). */
export function assertSafeRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/\\/g, "/");
  if (path.isAbsolute(relativePath) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Unsafe artifact path '${relativePath}' — must be a relative path inside the run directory.`);
  }
  return normalized;
}

export async function writeArtifactFile(runDir: string, relativePath: string, content: string, label?: string): Promise<EmittedNodeArtifactRecord> {
  const safe = assertSafeRelativePath(relativePath);
  const filePath = path.join(runDir, safe);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return { key: safe, label: label ?? path.basename(safe), path: filePath, relativePath: safe, required: true };
}

export type GenericAgentTextArgs = {
  prompt: string;
  input: unknown;
  nodeId: string;
  provider?: string;
  model?: string;
  thinkingLevel?: PiThinkingLevel;
};

export type GenericAgentText = (args: GenericAgentTextArgs) => Promise<{ rawText: string; provider: string; model: string }>;

/**
 * Default agent backend for the generic agent Nodes: the installed `pi` CLI via
 * executePiAgentNodeSession (not streamed). Injectable on the run* functions so tests
 * stay deterministic and offline.
 */
export const defaultGenericAgentText: GenericAgentText = async ({ prompt, input, nodeId, provider, model, thinkingLevel }) => {
  const runDir = resolveRunDir(input);
  const env = {
    ...resolveEnv(input),
    BAGELWERK_AGENT_ARTIFACTS_ROOT: process.env.BAGELWERK_AGENT_ARTIFACTS_ROOT ?? path.join(runDir, "__agent-artifacts__"),
  };
  const session = await executePiAgentNodeSession(
    { provider: provider?.trim() || "pi", model: model?.trim() || "auto", thinkingLevel: thinkingLevel ?? "low", allowedTools: [], cwd: runDir, prompt },
    { env, runId: `${resolveSessionId(input)}-${nodeId}`, nodeId },
  );
  return { rawText: session.rawText, provider: session.provider, model: session.model };
};

// ---- accepted upstream artifacts -----------------------------------------
// Robust consumption reads from the engine-resolved preflight dependency list
// (runner-agnostic over runtime|workbench). The flow's `acceptedArtifacts` is the
// single source of truth; we inherit the resolver's alias fallback + existence verdict
// instead of recomputing accepted paths ourselves.

export type AcceptedArtifactRef = { relativePath: string; acceptedPath: string; label?: string; fromQualifiedPath?: string };

function resolveDependencies(input: unknown): Record<string, unknown>[] {
  if (isRecord(input)) {
    for (const key of ["runtime", "workbench"] as const) {
      const surface = input[key];
      if (isRecord(surface) && isRecord(surface.preflight) && Array.isArray(surface.preflight.dependencies)) {
        return surface.preflight.dependencies.filter(isRecord);
      }
    }
  }
  return [];
}

/** Accepted upstream artifacts that actually exist, in declaration order. */
export function listAcceptedArtifacts(input: unknown): AcceptedArtifactRef[] {
  return resolveDependencies(input)
    .filter((dep) => dep.exists === true && typeof dep.acceptedPath === "string" && typeof dep.relativePath === "string")
    .map((dep) => ({
      relativePath: dep.relativePath as string,
      acceptedPath: dep.acceptedPath as string,
      ...(typeof dep.label === "string" ? { label: dep.label as string } : {}),
      ...(typeof dep.fromQualifiedPath === "string" ? { fromQualifiedPath: dep.fromQualifiedPath as string } : {}),
    }));
}

export function resolveAcceptedArtifact(input: unknown, relativePath: string): AcceptedArtifactRef {
  const matches = listAcceptedArtifacts(input).filter((artifact) => artifact.relativePath === relativePath);
  if (matches.length === 0) {
    throw new Error(`No accepted upstream artifact '${relativePath}' is available — declare it in this Node's acceptedArtifacts (and ensure the producing Node ran first).`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous accepted artifact '${relativePath}' — more than one upstream Node provides it.`);
  }
  return matches[0]!;
}

export async function readAcceptedArtifactText(input: unknown, relativePath: string): Promise<string> {
  return readFile(resolveAcceptedArtifact(input, relativePath).acceptedPath, "utf8");
}

const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".log", ".ts", ".js", ".tsx", ".jsx", ".html", ".xml", ".toml", ".ini", ".sh", ".py", ".sql", ".mmd"]);
const PER_ARTIFACT_CHAR_CAP = 20_000;
const TOTAL_CONTEXT_CHAR_CAP = 60_000;

/**
 * Fold every accepted text artifact into a labeled, size-capped context block for an
 * agent prompt. Driven entirely by the flow's acceptedArtifacts (single source of truth);
 * returns "" when there are none. Binary/oversized inputs are skipped or truncated.
 */
export async function buildAcceptedArtifactContext(input: unknown): Promise<string> {
  const artifacts = listAcceptedArtifacts(input).filter((artifact) => {
    const ext = path.extname(artifact.relativePath).toLowerCase();
    return ext === "" || TEXT_ARTIFACT_EXTENSIONS.has(ext);
  });
  let total = 0;
  const blocks: string[] = [];
  for (const artifact of artifacts) {
    if (total >= TOTAL_CONTEXT_CHAR_CAP) {
      blocks.push(`### ${artifact.relativePath}\n(omitted — context budget reached)`);
      continue;
    }
    let text: string;
    try {
      text = await readFile(artifact.acceptedPath, "utf8");
    } catch {
      continue;
    }
    if (text.length > PER_ARTIFACT_CHAR_CAP) text = `${text.slice(0, PER_ARTIFACT_CHAR_CAP)}\n…(truncated)`;
    if (total + text.length > TOTAL_CONTEXT_CHAR_CAP) text = `${text.slice(0, Math.max(0, TOTAL_CONTEXT_CHAR_CAP - total))}\n…(truncated)`;
    total += text.length;
    blocks.push(`### ${artifact.relativePath}\n${text}`);
  }
  return blocks.length ? `\n\nContext from upstream Nodes:\n\n${blocks.join("\n\n")}` : "";
}

/** Strip ```json fences and surrounding prose so an agent's reply can be JSON.parsed. */
export function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace > 0) return trimmed.slice(firstBrace).trim();
  return trimmed;
}
