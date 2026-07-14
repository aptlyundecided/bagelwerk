import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentExecutionPolicy } from "../flows/config/executionPolicy";
import { runWithSkillBackedAgentSlot } from "./agentConcurrencyGate";
import { beginNodeObservation, type NodeQualityStatus } from "./nodeObservability";
import {
  executePiAgentNodeSession,
  type PiAgentNodeSessionResult,
  type PiAgentUsage,
  type PiCommandInvocation,
  type PiCommandResult,
  type PiThinkingLevel,
} from "./piAgentCore";
import {
  executeCursorAgentNodeSession,
  type CursorCommandInvocation,
  type CursorCommandResult,
} from "./cursorAgentCore";
import {
  executeClaudeCodeAgentNodeSession,
  type ClaudeCodeCommandInvocation,
  type ClaudeCodeCommandResult,
  type ClaudeCodePermissionMode,
} from "./claudeCodeAgentCore";
import {
  executeOpenCodeAgentNodeSession,
  type OpenCodeCommandInvocation,
  type OpenCodeCommandResult,
} from "./opencodeAgentCore";


export type SkillBackedNodeInputArtifact = {
  label: string;
  path: string;
  summary?: string;
  required?: boolean;
  availabilityStatus?: "present" | "missing";
  pathKind?: "file" | "directory" | "other";
  availabilityNote?: string;
};

export type SkillBackedNodeOutputTransport = "filesystem" | "response_blocks_preferred";

export type SkillBackedNodeOutputArtifact = {
  label: string;
  relativePath: string;
  summary?: string;
  required?: boolean;
  responseBlockId?: string;
};

export type SkillBackedResolvedOutputArtifact = {
  label: string;
  path: string;
  summary?: string;
  required?: boolean;
  responseBlockId: string;
  recoveryMethod?: "response_block" | "fenced_code_block" | "raw_text_fallback" | "missing";
};

export type SkillBackedArtifactDiagnostics = {
  recoveredArtifacts: Array<{
    responseBlockId: string;
    recoveryMethod: "response_block" | "fenced_code_block" | "raw_text_fallback";
  }>;
  missingRequiredArtifactIds: string[];
  rawTextSalvageable: boolean;
};

export type SkillBackedPromptInputMode = "staged_paths" | "inline_contents";

export type SkillBackedAgentRuntime = "pi" | "cursor" | "claude-code" | "opencode";

export type SkillBackedNodeSessionParams = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  skillDirectory: string;
  inputArtifacts: SkillBackedNodeInputArtifact[];
  outputArtifacts: SkillBackedNodeOutputArtifact[];
  promptInputMode?: SkillBackedPromptInputMode;
  outputTransport?: SkillBackedNodeOutputTransport;
  extraInstructions?: string;
  agentRuntime?: SkillBackedAgentRuntime;
  claudeCodePermissionMode?: ClaudeCodePermissionMode;
  claudeCodeMaxTurns?: number;
  openCodeAgent?: string;
  openCodeSkipPermissions?: boolean;
};

export type SkillBackedNodeSessionResult = {
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  skillPath: string;
  skillArtifactDir: string;
  inputArtifacts: SkillBackedNodeInputArtifact[];
  outputArtifacts: SkillBackedResolvedOutputArtifact[];
  rawText: string;
  artifactPath: string;
  agentRuntime: SkillBackedAgentRuntime;
  agentBackend: string;
  agentArtifactPath: string;
  piArtifactPath: string;
  observationDir?: string;
  agentObservationDir?: string;
  piObservationDir?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage?: PiAgentUsage;
  outputTransport: SkillBackedNodeOutputTransport;
  recoveredArtifactCount: number;
  artifactDiagnostics: SkillBackedArtifactDiagnostics;
  transportRepairApplied?: boolean;
};

type PiToolInfo = { name: string };

type PiSessionLike = {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  dispose(): void;
  getAllTools(): PiToolInfo[];
  setActiveToolsByName(toolNames: string[]): void;
  getSessionStats?: () => {
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
  };
  messages?: unknown[];
};

export type ExecuteSkillBackedNodeSessionDeps = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  randomId?: () => string;
  createSession?: (params: {
    provider: string;
    model: string;
    thinkingLevel: PiThinkingLevel;
    allowedTools: string[];
    cwd: string;
    prompt: string;
  }) => Promise<PiSessionLike>;
  runCursorCommand?: (params: CursorCommandInvocation) => Promise<CursorCommandResult>;
  runClaudeCodeCommand?: (params: ClaudeCodeCommandInvocation) => Promise<ClaudeCodeCommandResult>;
  runOpenCodeCommand?: (params: OpenCodeCommandInvocation) => Promise<OpenCodeCommandResult>;
  runPiCommand?: (params: PiCommandInvocation) => Promise<PiCommandResult>;
  nodeId?: string;
  runId?: string;
  stream?: boolean;
  streamWriter?: (chunk: string) => void;
};

function sanitizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    throw new Error("output artifact relativePath is required");
  }
  if (path.isAbsolute(normalized)) {
    throw new Error(`output artifact relativePath must be relative: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`output artifact relativePath must not contain empty, '.' or '..' segments: ${value}`);
  }
  return segments.join(path.sep);
}

function sanitizeResponseBlockId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error(`output artifact responseBlockId is invalid: ${value}`);
  }
  return normalized;
}

function extractResponseBlocks(rawText: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const pattern = /<<<ARTIFACT:([a-zA-Z0-9._-]+)>>>\s*([\s\S]*?)\s*(?:(?:<<<END_ARTIFACT>>>)|(?:<<<ARTIFACT:[a-zA-Z0-9._-]*end>>>))/g;
  for (const match of rawText.matchAll(pattern)) {
    const rawId = match[1] ?? "";
    if (/^end_artifact$/i.test(rawId) || /(?:^|[-_.])end$/i.test(rawId)) continue;
    const blockId = sanitizeResponseBlockId(rawId);
    const body = match[2]?.trim();
    if (body) blocks.set(blockId, body);
  }
  return blocks;
}

function extractFencedLabeledBlocks(rawText: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const pattern = /```\s*([^\r\n`]+)\r?\n([\s\S]*?)\r?\n```/g;
  for (const match of rawText.matchAll(pattern)) {
    const rawLabel = match[1]?.trim();
    const body = match[2]?.trim();
    if (!rawLabel || !body) continue;
    blocks.set(sanitizeResponseBlockId(rawLabel), body);
  }
  return blocks;
}

function extractSingleArtifactFallback(rawText: string): string | undefined {
  const trimmed = rawText.trim();
  if (!trimmed) return undefined;
  const firstHeadingIndex = trimmed.search(/^##\s+/m);
  if (firstHeadingIndex >= 0) return `${trimmed.slice(firstHeadingIndex).trim()}\n`;
  if (trimmed.includes("\n") || trimmed.length > 120) return `${trimmed}\n`;
  return undefined;
}

function buildResponseBlockAliases(artifact: SkillBackedResolvedOutputArtifact): string[] {
  const aliases = new Set<string>();
  const basename = path.basename(artifact.path);
  const stem = path.basename(artifact.path, path.extname(artifact.path));
  const ext = path.extname(artifact.path).replace(/^\./, "").trim();
  aliases.add(sanitizeResponseBlockId(artifact.responseBlockId));
  aliases.add(sanitizeResponseBlockId(basename));
  aliases.add(sanitizeResponseBlockId(stem));
  aliases.add(sanitizeResponseBlockId(artifact.label));
  aliases.add(sanitizeResponseBlockId(basename.replace(/\./g, "-")));
  if (ext) aliases.add(sanitizeResponseBlockId(`${artifact.responseBlockId}-${ext}`));
  if (ext) aliases.add(sanitizeResponseBlockId(`${stem}-${ext}`));
  return [...aliases];
}

async function assertDirectoryExists(dir: string, label: string): Promise<string> {
  const resolved = path.resolve(dir);
  let st;
  try {
    st = await stat(resolved);
  } catch (error) {
    throw new Error(`${label} is not accessible: ${resolved} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!st.isDirectory()) throw new Error(`${label} is not a directory: ${resolved}`);
  return resolved;
}

async function assertFileExists(filePath: string, label: string): Promise<string> {
  const resolved = path.resolve(filePath);
  let st;
  try {
    st = await stat(resolved);
  } catch (error) {
    throw new Error(`${label} is not accessible: ${resolved} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!st.isFile()) throw new Error(`${label} is not a file: ${resolved}`);
  return resolved;
}

async function inspectInputArtifactPath(artifactPath: string): Promise<{
  availabilityStatus: "present" | "missing";
  pathKind?: "file" | "directory" | "other";
  availabilityNote?: string;
}> {
  const resolved = path.resolve(artifactPath);
  try {
    const st = await stat(resolved);
    return {
      availabilityStatus: "present",
      pathKind: st.isFile() ? "file" : st.isDirectory() ? "directory" : "other",
    };
  } catch (error) {
    return {
      availabilityStatus: "missing",
      availabilityNote: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveSkillPath(skillDirectory: string): Promise<string> {
  const resolvedDir = await assertDirectoryExists(skillDirectory, "skillDirectory");
  return assertFileExists(path.join(resolvedDir, "SKILL.md"), `Local skill in ${resolvedDir}`);
}

async function normalizeInputArtifacts(inputArtifacts: SkillBackedNodeInputArtifact[]): Promise<SkillBackedNodeInputArtifact[]> {
  return Promise.all(
    inputArtifacts.map(async (artifact, index) => {
      const label = artifact.label.trim();
      if (!label) throw new Error(`inputArtifacts[${index}].label is required`);
      const artifactPath = artifact.path.trim();
      if (!artifactPath) throw new Error(`inputArtifacts[${index}].path is required`);
      const resolvedPath = path.resolve(artifactPath);
      const inspected = await inspectInputArtifactPath(resolvedPath);
      return {
        label,
        path: resolvedPath,
        ...(artifact.summary?.trim() ? { summary: artifact.summary.trim() } : {}),
        ...(artifact.required !== undefined ? { required: artifact.required } : {}),
        availabilityStatus: inspected.availabilityStatus,
        ...(inspected.pathKind ? { pathKind: inspected.pathKind } : {}),
        ...(inspected.availabilityNote ? { availabilityNote: inspected.availabilityNote } : {}),
      };
    }),
  );
}

function normalizeOutputArtifacts(params: { outputArtifacts: SkillBackedNodeOutputArtifact[]; outputRoot: string }): SkillBackedResolvedOutputArtifact[] {
  return params.outputArtifacts.map((artifact, index) => {
    const label = artifact.label.trim();
    if (!label) throw new Error(`outputArtifacts[${index}].label is required`);
    const relativePath = sanitizeRelativePath(artifact.relativePath);
    const responseBlockId = sanitizeResponseBlockId(artifact.responseBlockId ?? label);
    return {
      label,
      path: path.join(params.outputRoot, relativePath),
      responseBlockId,
      ...(artifact.summary?.trim() ? { summary: artifact.summary.trim() } : {}),
      ...(artifact.required !== undefined ? { required: artifact.required } : {}),
    };
  });
}

type PromptInputArtifact = SkillBackedNodeInputArtifact & { promptPath?: string; sourcePath?: string; inlineContent?: string };

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function truncatePromptInputContent(content: string, maxChars = 12000): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n…[truncated ${content.length - maxChars} chars]`;
}

async function preparePromptInputArtifacts(params: {
  inputArtifacts: SkillBackedNodeInputArtifact[];
  skillArtifactDir: string;
  promptInputMode: SkillBackedPromptInputMode;
}): Promise<PromptInputArtifact[]> {
  if (params.promptInputMode === "inline_contents") {
    return Promise.all(
      params.inputArtifacts.map(async (artifact) => {
        if (artifact.availabilityStatus === "present" && artifact.pathKind === "file") {
          return {
            ...artifact,
            inlineContent: truncatePromptInputContent(await readFile(artifact.path, "utf8")),
            sourcePath: artifact.path,
          };
        }
        return { ...artifact, sourcePath: artifact.path };
      }),
    );
  }

  const inputRoot = path.join(params.skillArtifactDir, "inputs");
  await mkdir(inputRoot, { recursive: true });
  return Promise.all(
    params.inputArtifacts.map(async (artifact, index) => {
      if (artifact.availabilityStatus === "present" && artifact.pathKind === "file") {
        const parsed = path.parse(artifact.path);
        const stagedPath = path.join(
          inputRoot,
          `${String(index + 1).padStart(2, "0")}-${sanitizeFileStem(artifact.label)}${parsed.ext || ".md"}`,
        );
        await copyFile(artifact.path, stagedPath);
        return { ...artifact, promptPath: stagedPath, sourcePath: artifact.path };
      }
      return { ...artifact, promptPath: artifact.path };
    }),
  );
}

function renderPrompt(params: {
  skillPath: string;
  skillText: string;
  inputArtifacts: PromptInputArtifact[];
  outputArtifacts: SkillBackedResolvedOutputArtifact[];
  skillArtifactDir: string;
  promptInputMode: SkillBackedPromptInputMode;
  outputTransport: SkillBackedNodeOutputTransport;
  extraInstructions?: string;
}): string {
  const lines: string[] = [
    "You are running inside a local skill-backed Node session for the Flow / Node runtime.",
    "",
    "Your task is to follow the provided local skill definition, use only the provided artifact context, write the expected output artifacts, then perform a final self-check before responding.",
    "",
    `Skill definition path: ${params.skillPath}`,
    "",
    "<skill-definition>",
    params.skillText.trim(),
    "</skill-definition>",
    "",
    `Node artifact workspace: ${params.skillArtifactDir}`,
    "The runtime owns canonical artifact persistence. Prefer focusing on artifact content over memorizing exact paths.",
    "If you do write files, write generated artifacts only under the expected output paths listed below unless the skill explicitly needs additional supporting files inside that workspace.",
    "",
    "Input artifacts:",
  ];

  if (params.inputArtifacts.length === 0) lines.push("- none");
  else {
    for (const artifact of params.inputArtifacts) {
      const descriptor = params.promptInputMode === "inline_contents"
        ? `- ${artifact.label} | required: ${artifact.required === false ? "no" : "yes"} | availability: ${artifact.availabilityStatus ?? "present"}${artifact.pathKind ? ` | kind: ${artifact.pathKind}` : ""}${artifact.summary ? ` | summary: ${artifact.summary}` : ""}${artifact.sourcePath ? ` | source path: ${artifact.sourcePath}` : ""}${artifact.availabilityNote ? ` | note: ${artifact.availabilityNote}` : ""}`
        : `- ${artifact.label} | path: ${artifact.promptPath} | required: ${artifact.required === false ? "no" : "yes"} | availability: ${artifact.availabilityStatus ?? "present"}${artifact.pathKind ? ` | kind: ${artifact.pathKind}` : ""}${artifact.summary ? ` | summary: ${artifact.summary}` : ""}${artifact.sourcePath ? ` | source path: ${artifact.sourcePath}` : ""}${artifact.availabilityNote ? ` | note: ${artifact.availabilityNote}` : ""}`;
      lines.push(descriptor);
      if (params.promptInputMode === "inline_contents" && artifact.inlineContent !== undefined) {
        lines.push("  <inline-content>");
        lines.push(artifact.inlineContent);
        lines.push("  </inline-content>");
      }
    }
  }

  lines.push("", "Expected output artifacts:");
  if (params.outputArtifacts.length === 0) lines.push("- none declared");
  else {
    for (const artifact of params.outputArtifacts) {
      lines.push(`- ${artifact.label} | path: ${artifact.path} | required: ${artifact.required === false ? "no" : "yes"} | response block: ${artifact.responseBlockId}${artifact.summary ? ` | summary: ${artifact.summary}` : ""}`);
    }
  }

  if (params.extraInstructions?.trim()) {
    lines.push("", "Additional run instructions:", params.extraInstructions.trim());
  }

  lines.push(
    "",
    "Execution rules:",
    "- Treat the listed input artifacts as the only intended context surface for this run.",
    "- If the listed artifacts already give you enough information to complete the task, do so without additional tool calls.",
    "- This is an artifact-only Node session, not a live operator chat. Do not ask the operator new questions here; if clarification is still needed, record it in the output artifacts instead.",
    ...(params.promptInputMode === "inline_contents"
      ? ["- The input artifact contents are already inlined below; do not call read on them again unless the task explicitly requires verification of a specific detail."]
      : ["- For present file inputs, prefer the staged input paths listed above; they are the easiest reread surfaces for this run." ]),
    "- Prefer the named input artifacts and their summaries over directory exploration or path guessing.",
    "- Do not try to read expected output artifact paths before you write them.",
    "- Some declared input artifacts may be missing or may point at directories instead of files; account for their reported availability rather than failing blindly.",
    "- Do not explore directories, guess alternate artifact paths, or debug slash/path formatting unless the task explicitly requires artifact recovery or repository investigation.",
    "- If one artifact lookup fails, make at most one normalized retry; after that, continue from the available context or clearly note the limitation in your outputs.",
    "- Read only the minimum files needed.",
    "- When a missing artifact is non-blocking, proceed with best judgment and note the gap instead of stalling on filesystem investigation.",
    "- Keep outputs concise, useful, and ready for downstream reread.",
    ...(params.outputTransport === "response_blocks_preferred"
      ? [
          "- Prefer returning each expected output artifact in response blocks instead of relying on tool-written files.",
          "- For each declared output artifact, return a block shaped exactly like:",
          "  <<<ARTIFACT:<response-block-id>>>",
          "  ...artifact body...",
          "  <<<END_ARTIFACT>>>",
          "- You may still write files if the skill strongly benefits from it, but the response blocks are the primary handoff surface.",
        ]
      : [
          "- Write the expected output artifacts at the exact listed paths whenever you can.",
          "- If a file write becomes awkward, you may still return the artifact body in the matching response block and the runtime will persist it for you.",
        ]),
    "- Before your final response, perform a self-check in this same session: reread your produced artifacts as needed, verify they fit the skill and expected artifact roles, and fix them if needed.",
    "",
    "Final response requirements:",
    "- Brief status line",
    "- Bullet list of output artifacts written or updated, or note that runtime-owned response blocks are being used",
    "- Note any expected artifact you could not produce",
    "- Include the artifact response blocks for any outputs you want the runtime to persist from your final response",
  );

  return lines.join("\n");
}

function classifySkillBackedQuality(result: SkillBackedNodeSessionResult): { qualityStatus: NodeQualityStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (!result.rawText.trim()) reasons.push("raw_text_empty");
  if (result.recoveredArtifactCount > 0) reasons.push(`artifacts_recovered:${result.recoveredArtifactCount}`);
  for (const artifact of result.artifactDiagnostics.recoveredArtifacts) {
    reasons.push(`artifact_recovered:${artifact.recoveryMethod}:${artifact.responseBlockId}`);
  }
  const missingRequiredOutputs = result.outputArtifacts.filter((artifact) => artifact.required !== false && artifact.recoveryMethod === "missing");
  for (const artifact of missingRequiredOutputs) {
    reasons.push(`required_output_missing:${artifact.responseBlockId}`);
  }
  return {
    qualityStatus: reasons.some((reason) => reason.startsWith("required_output_missing:")) ? "failed" : reasons.length === 0 ? "success" : "degraded",
    reasons,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

// ─── Transport Repair ────────────────────────────────────────────────────────

function buildTransportRepairPrompt(rawText: string, expectedBlockIds: string[]): string {
  return [
    "You are a transport repair agent. Your ONLY task is to fix malformed artifact delimiters in the text below.",
    "",
    "Expected artifact block IDs: " + expectedBlockIds.map((id) => `\`${id}\``).join(", "),
    "",
    "Rules:",
    "- Each artifact block MUST use exactly: <<<ARTIFACT:block-id>>> to open and <<<END_ARTIFACT>>> to close.",
    "- Fix common issues: missing/extra angle brackets (e.g. `<<` or `>>>>>`), missing END markers, markdown fences wrapping the markers, stray text inside the artifact envelope that is not the artifact body.",
    "- Do NOT change the artifact body content. Only fix the delimiter markers.",
    "- Do NOT add commentary, explanations, or status lines. Return ONLY the corrected artifact blocks.",
    "- If there is preamble text before the first artifact marker, remove it from the artifact block output.",
    "- Return one block per expected artifact ID, using the exact corrected delimiters.",
    "",
    "Raw agent output to repair:",
    "<raw-output>",
    rawText,
    "</raw-output>",
    "",
    "Return the corrected artifact blocks now:",
  ].join("\n");
}

function hasRequiredArtifactsMissing(diagnostics: SkillBackedArtifactDiagnostics): boolean {
  return diagnostics.missingRequiredArtifactIds.length > 0;
}

function hasRequiredArtifactsDegraded(outputArtifacts: SkillBackedResolvedOutputArtifact[]): boolean {
  // Transport repair should also fire when required artifacts were recovered
  // via raw_text_fallback — this almost always means the markers were broken
  // and the fallback captured garbage (preamble + artifact body mixed together).
  return outputArtifacts.some(
    (a) => a.required !== false && a.recoveryMethod === "raw_text_fallback",
  );
}

type SkillBackedAgentInvocationResult = {
  rawText: string;
  artifactPath: string;
  observationDir?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage?: PiAgentUsage;
};

const VALID_AGENT_RUNTIMES = new Set<SkillBackedAgentRuntime>(["pi", "cursor", "claude-code", "opencode"]);

export function normalizeAgentRuntime(value: string | undefined): SkillBackedAgentRuntime | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "claude" || normalized === "claude_code" || normalized === "claudecode") return "claude-code";
  if (normalized === "open-code" || normalized === "open_code") return "opencode";
  return VALID_AGENT_RUNTIMES.has(normalized as SkillBackedAgentRuntime)
    ? normalized as SkillBackedAgentRuntime
    : undefined;
}

export function envFlag(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function optionalTrim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type ResolvedSkillBackedAgentSettings = {
  provider: string;
  model: string;
  agentRuntime: SkillBackedAgentRuntime;
  openCodeAgent?: string;
  openCodeSkipPermissions?: boolean;
};

export function resolveSkillBackedAgentSettings(args: {
  executionPolicyAgent?: AgentExecutionPolicy;
  provider?: string;
  modelOverride?: string;
  agentRuntime?: SkillBackedAgentRuntime;
  env?: NodeJS.ProcessEnv;
  defaultProvider?: string;
  defaultModel: string;
  openCodeAgent?: string;
  openCodeSkipPermissions?: boolean;
}): ResolvedSkillBackedAgentSettings {
  const env = args.env ?? process.env;
  const provider = optionalTrim(args.executionPolicyAgent?.provider)
    ?? optionalTrim(args.provider)
    ?? optionalTrim(env.FLOW_PROVIDER)
    ?? args.defaultProvider
    ?? "pi";
  const model = optionalTrim(args.executionPolicyAgent?.model)
    ?? optionalTrim(args.modelOverride)
    ?? optionalTrim(env.FLOW_MODEL)
    ?? args.defaultModel;
  const agentRuntime = args.executionPolicyAgent?.runtime
    ?? args.agentRuntime
    ?? normalizeAgentRuntime(env.FLOW_AGENT_RUNTIME)
    ?? normalizeAgentRuntime(env.BAGELWERK_AGENT_RUNTIME)
    ?? normalizeAgentRuntime(env.AGENT_RUNTIME)
    ?? normalizeAgentRuntime(provider)
    ?? "pi";
  return {
    provider,
    model,
    agentRuntime,
    openCodeAgent: optionalTrim(args.executionPolicyAgent?.openCodeAgent)
      ?? optionalTrim(args.openCodeAgent)
      ?? optionalTrim(env.FLOW_OPENCODE_AGENT)
      ?? optionalTrim(env.OPENCODE_AGENT),
    openCodeSkipPermissions: args.executionPolicyAgent?.openCodeSkipPermissions
      ?? args.openCodeSkipPermissions
      ?? envFlag(env.FLOW_OPENCODE_SKIP_PERMISSIONS ?? env.OPENCODE_SKIP_PERMISSIONS),
  };
}

function resolveAgentRuntime(params: SkillBackedNodeSessionParams, env: NodeJS.ProcessEnv): SkillBackedAgentRuntime {
  const explicitRuntime = params.agentRuntime
    ?? normalizeAgentRuntime(env.FLOW_AGENT_RUNTIME)
    ?? normalizeAgentRuntime(env.BAGELWERK_AGENT_RUNTIME)
    ?? normalizeAgentRuntime(env.AGENT_RUNTIME);
  if (explicitRuntime) return explicitRuntime;

  const providerRuntime = normalizeAgentRuntime(params.provider);
  if (providerRuntime) return providerRuntime;
  return "pi";
}

function agentBackendLabel(agentRuntime: SkillBackedAgentRuntime): string {
  switch (agentRuntime) {
    case "pi": return "pi-agent-session";
    case "cursor": return "cursor-agent-cli";
    case "claude-code": return "claude-code-cli";
    case "opencode": return "opencode-cli";
  }
}

async function invokeSkillBackedAgent(params: {
  runtime: SkillBackedAgentRuntime;
  nodeId: string;
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  deps: ExecuteSkillBackedNodeSessionDeps;
  skillParams: SkillBackedNodeSessionParams;
}): Promise<SkillBackedAgentInvocationResult> {
  return runWithSkillBackedAgentSlot(() => invokeSkillBackedAgentNow(params));
}

async function invokeSkillBackedAgentNow(params: {
  runtime: SkillBackedAgentRuntime;
  nodeId: string;
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  allowedTools: string[];
  cwd: string;
  prompt: string;
  deps: ExecuteSkillBackedNodeSessionDeps;
  skillParams: SkillBackedNodeSessionParams;
}): Promise<SkillBackedAgentInvocationResult> {
  switch (params.runtime) {
    case "cursor":
      return executeCursorAgentNodeSession(
        {
          provider: params.provider,
          model: params.model,
          thinkingLevel: params.thinkingLevel,
          allowedTools: params.allowedTools,
          cwd: params.cwd,
          prompt: params.prompt,
        },
        {
          env: params.deps.env,
          now: params.deps.now,
          randomId: params.deps.randomId,
          runCursorCommand: params.deps.runCursorCommand,
          nodeId: params.nodeId,
          runId: params.deps.runId,
          stream: params.deps.stream,
          streamWriter: params.deps.streamWriter,
        },
      );
    case "claude-code":
      return executeClaudeCodeAgentNodeSession(
        {
          provider: params.provider,
          model: params.model,
          thinkingLevel: params.thinkingLevel,
          allowedTools: params.allowedTools,
          cwd: params.cwd,
          prompt: params.prompt,
          permissionMode: params.skillParams.claudeCodePermissionMode,
          maxTurns: params.skillParams.claudeCodeMaxTurns,
        },
        {
          env: params.deps.env,
          now: params.deps.now,
          randomId: params.deps.randomId,
          runClaudeCodeCommand: params.deps.runClaudeCodeCommand,
          nodeId: params.nodeId,
          runId: params.deps.runId,
          stream: params.deps.stream,
          streamWriter: params.deps.streamWriter,
        },
      );
    case "opencode":
      return executeOpenCodeAgentNodeSession(
        {
          provider: params.provider,
          model: params.model,
          thinkingLevel: params.thinkingLevel,
          allowedTools: params.allowedTools,
          cwd: params.cwd,
          prompt: params.prompt,
          agent: params.skillParams.openCodeAgent ?? params.deps.env?.FLOW_OPENCODE_AGENT ?? params.deps.env?.OPENCODE_AGENT,
          skipPermissions: params.skillParams.openCodeSkipPermissions ?? envFlag(params.deps.env?.FLOW_OPENCODE_SKIP_PERMISSIONS ?? params.deps.env?.OPENCODE_SKIP_PERMISSIONS),
        },
        {
          env: params.deps.env,
          now: params.deps.now,
          randomId: params.deps.randomId,
          runOpenCodeCommand: params.deps.runOpenCodeCommand,
          nodeId: params.nodeId,
          runId: params.deps.runId,
          stream: params.deps.stream,
          streamWriter: params.deps.streamWriter,
        },
      );
    case "pi":
      return executePiAgentNodeSession(
        {
          provider: params.provider,
          model: params.model,
          thinkingLevel: params.thinkingLevel,
          allowedTools: params.allowedTools,
          cwd: params.cwd,
          prompt: params.prompt,
        },
        {
          env: params.deps.env,
          now: params.deps.now,
          randomId: params.deps.randomId,
          createSession: params.deps.createSession,
          runPiCommand: params.deps.runPiCommand,
          nodeId: params.nodeId,
          runId: params.deps.runId,
          stream: params.deps.stream,
          streamWriter: params.deps.streamWriter,
        },
      );
  }
}

async function attemptTransportRepair(params: {
  rawText: string;
  outputArtifacts: SkillBackedResolvedOutputArtifact[];
  missingBlockIds: string[];
  runtime: SkillBackedAgentRuntime;
  provider: string;
  model: string;
  thinkingLevel: PiThinkingLevel;
  cwd: string;
  deps: ExecuteSkillBackedNodeSessionDeps;
  skillParams: SkillBackedNodeSessionParams;
  observationDir: string;
}): Promise<{ repairedText: string; repairAttempted: true } | { repairAttempted: false }> {
  const repairPrompt = buildTransportRepairPrompt(params.rawText, params.missingBlockIds);

  // Write repair prompt for observability
  const repairDir = path.join(params.observationDir, "transport-repair");
  await mkdir(repairDir, { recursive: true });
  await writeFile(path.join(repairDir, "repair-prompt.md"), repairPrompt, "utf8");
  await writeFile(path.join(repairDir, "missing-block-ids.json"), JSON.stringify(params.missingBlockIds, null, 2), "utf8");

  try {
    const repairResult = await invokeSkillBackedAgent({
      runtime: params.runtime,
      nodeId: `${params.deps.nodeId ?? "skill.backed"}.transport_repair`,
      provider: params.provider,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      allowedTools: params.runtime === "pi" ? ["read"] : [],
      cwd: params.cwd,
      prompt: repairPrompt,
      deps: params.deps,
      skillParams: params.skillParams,
    });

    await writeFile(path.join(repairDir, "repair-output.md"), repairResult.rawText, "utf8");
    return { repairedText: repairResult.rawText, repairAttempted: true };
  } catch (error) {
    await writeFile(
      path.join(repairDir, "repair-failure.json"),
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
      "utf8",
    );
    return { repairAttempted: false };
  }
}

// ─── Artifact Recovery ───────────────────────────────────────────────────────

function extractPersistedFilePointer(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^See persisted file:\s*`([^`]+)`\.?$/i)
    ?? trimmed.match(/^See persisted file:\s*(\S+)\.?$/i);
  return match?.[1]?.trim();
}

async function recoverOutputArtifacts(params: {
  rawText: string;
  outputArtifacts: SkillBackedResolvedOutputArtifact[];
}): Promise<{ outputArtifacts: SkillBackedResolvedOutputArtifact[]; recoveredArtifactCount: number; diagnostics: SkillBackedArtifactDiagnostics }> {
  const responseBlocks = extractResponseBlocks(params.rawText);
  const fencedBlocks = extractFencedLabeledBlocks(params.rawText);
  const canUseSingleArtifactFallback = params.outputArtifacts.length === 1;
  const fallbackContent = canUseSingleArtifactFallback ? extractSingleArtifactFallback(params.rawText) : undefined;
  let recoveredArtifactCount = 0;
  const recoveredArtifacts: SkillBackedArtifactDiagnostics["recoveredArtifacts"] = [];
  const missingRequiredArtifactIds: string[] = [];

  const resolvedArtifacts = await Promise.all(
    params.outputArtifacts.map(async (artifact) => {
      const aliases = buildResponseBlockAliases(artifact);
      const responseBlock = aliases.map((alias) => responseBlocks.get(alias)).find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (responseBlock) {
        const persistedFilePointer = extractPersistedFilePointer(responseBlock);
        if (persistedFilePointer) {
          const resolvedPointer = path.resolve(persistedFilePointer);
          const resolvedArtifactPath = path.resolve(artifact.path);
          if (resolvedPointer !== resolvedArtifactPath && await pathExists(resolvedPointer)) {
            await copyFile(resolvedPointer, artifact.path);
            recoveredArtifactCount += 1;
            recoveredArtifacts.push({ responseBlockId: artifact.responseBlockId, recoveryMethod: "response_block" });
            return { ...artifact, recoveryMethod: "response_block" as const };
          }
          if (await pathExists(artifact.path)) return artifact;
          if (artifact.required !== false) missingRequiredArtifactIds.push(artifact.responseBlockId);
          return { ...artifact, recoveryMethod: "missing" as const };
        }

        // Response block is canonical when it contains artifact content. Do not treat pointer/prose as content.
        await writeFile(artifact.path, `${responseBlock.trim()}\n`, "utf8");
        recoveredArtifactCount += 1;
        recoveredArtifacts.push({ responseBlockId: artifact.responseBlockId, recoveryMethod: "response_block" });
        return { ...artifact, recoveryMethod: "response_block" as const };
      }
      if (await pathExists(artifact.path)) return artifact;
      const fencedBlock = aliases.map((alias) => fencedBlocks.get(alias)).find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (fencedBlock) {
        await writeFile(artifact.path, `${fencedBlock.trim()}\n`, "utf8");
        recoveredArtifactCount += 1;
        recoveredArtifacts.push({ responseBlockId: artifact.responseBlockId, recoveryMethod: "fenced_code_block" });
        return { ...artifact, recoveryMethod: "fenced_code_block" as const };
      }
      if (fallbackContent) {
        await writeFile(artifact.path, fallbackContent, "utf8");
        recoveredArtifactCount += 1;
        recoveredArtifacts.push({ responseBlockId: artifact.responseBlockId, recoveryMethod: "raw_text_fallback" });
        return { ...artifact, recoveryMethod: "raw_text_fallback" as const };
      }
      if (artifact.required !== false) missingRequiredArtifactIds.push(artifact.responseBlockId);
      return { ...artifact, recoveryMethod: "missing" as const };
    }),
  );

  return {
    outputArtifacts: resolvedArtifacts,
    recoveredArtifactCount,
    diagnostics: {
      recoveredArtifacts,
      missingRequiredArtifactIds,
      rawTextSalvageable: Boolean(fallbackContent || responseBlocks.size > 0 || fencedBlocks.size > 0),
    },
  };
}

export async function executeSkillBackedNodeSession(
  params: SkillBackedNodeSessionParams,
  deps: ExecuteSkillBackedNodeSessionDeps = {},
): Promise<SkillBackedNodeSessionResult> {
  const nodeId = deps.nodeId ?? "skill.backed";
  const cwd = await assertDirectoryExists(params.cwd, "cwd");
  const skillPath = await resolveSkillPath(params.skillDirectory);
  const inputArtifacts = await normalizeInputArtifacts(params.inputArtifacts);

  const observation = await beginNodeObservation({ runId: deps.runId, nodeId }, { env: deps.env, now: deps.now, randomId: deps.randomId });
  const skillArtifactDir = path.join(observation.artifactDir, "generated");
  await mkdir(skillArtifactDir, { recursive: true });

  const outputTransport = params.outputTransport ?? "filesystem";
  const outputArtifacts = normalizeOutputArtifacts({ outputArtifacts: params.outputArtifacts, outputRoot: skillArtifactDir });
  for (const artifact of outputArtifacts) {
    await mkdir(path.dirname(artifact.path), { recursive: true });
  }

  const promptInputMode = params.promptInputMode ?? "staged_paths";
  const promptInputArtifacts = await preparePromptInputArtifacts({ inputArtifacts, skillArtifactDir, promptInputMode });

  const skillText = await readFile(skillPath, "utf8");
  const prompt = renderPrompt({
    skillPath,
    skillText,
    inputArtifacts: promptInputArtifacts,
    outputArtifacts,
    skillArtifactDir,
    promptInputMode,
    outputTransport,
    extraInstructions: params.extraInstructions,
  });

  await observation.writeText("skill.md", skillText);
  await observation.writeJson("input-artifacts.json", inputArtifacts);
  await observation.writeJson("expected-output-artifacts.json", outputArtifacts);
  await observation.writeText("prompt.md", prompt);

  try {
    const trimmedProvider = params.provider.trim();
    const agentRuntime = resolveAgentRuntime(params, deps.env ?? process.env);
    const agentBackend = agentBackendLabel(agentRuntime);
    const agentResult = await invokeSkillBackedAgent({
      runtime: agentRuntime,
      nodeId: `${nodeId}.invoke_${agentRuntime.replace(/-/g, "_")}`,
      provider: params.provider,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      allowedTools: params.allowedTools,
      cwd,
      prompt,
      deps,
      skillParams: params,
    });

    const recoveredArtifacts = await recoverOutputArtifacts({ rawText: agentResult.rawText, outputArtifacts });

    // Transport repair: if required artifacts are missing or degraded (raw_text_fallback), attempt agent-based marker repair
    let finalRecovered = recoveredArtifacts;
    let transportRepairApplied = false;
    if (hasRequiredArtifactsMissing(recoveredArtifacts.diagnostics) || hasRequiredArtifactsDegraded(recoveredArtifacts.outputArtifacts)) {
      const missingBlockIds = recoveredArtifacts.diagnostics.missingRequiredArtifactIds.length > 0
        ? recoveredArtifacts.diagnostics.missingRequiredArtifactIds
        : recoveredArtifacts.outputArtifacts
            .filter((a) => a.required !== false && a.recoveryMethod === "raw_text_fallback")
            .map((a) => a.responseBlockId);

      const repairResult = await attemptTransportRepair({
        rawText: agentResult.rawText,
        outputArtifacts,
        missingBlockIds,
        runtime: agentRuntime,
        provider: trimmedProvider,
        model: params.model.trim(),
        thinkingLevel: params.thinkingLevel,
        cwd,
        deps,
        skillParams: params,
        observationDir: observation.artifactDir,
      });

      if (repairResult.repairAttempted) {
        // Remove artifacts from degraded recovery so re-extraction can overwrite
        for (const artifact of recoveredArtifacts.outputArtifacts) {
          if (artifact.recoveryMethod === "raw_text_fallback" || artifact.recoveryMethod === "missing") {
            try { await unlink(artifact.path); } catch { /* may not exist */ }
          }
        }
        const repairedRecovery = await recoverOutputArtifacts({ rawText: repairResult.repairedText, outputArtifacts });
        // Use repaired result if it resolved missing artifacts OR upgraded from raw_text_fallback to response_block
        const improvedMissing = repairedRecovery.diagnostics.missingRequiredArtifactIds.length < recoveredArtifacts.diagnostics.missingRequiredArtifactIds.length;
        const improvedDegraded = !hasRequiredArtifactsDegraded(repairedRecovery.outputArtifacts) && hasRequiredArtifactsDegraded(recoveredArtifacts.outputArtifacts);
        if (improvedMissing || improvedDegraded) {
          finalRecovered = repairedRecovery;
          transportRepairApplied = true;
        }
      }
    }

    const result: SkillBackedNodeSessionResult = {
      provider: trimmedProvider,
      model: params.model.trim(),
      thinkingLevel: params.thinkingLevel,
      allowedTools: params.allowedTools.map((tool) => tool.trim()),
      cwd,
      skillPath,
      skillArtifactDir,
      inputArtifacts,
      outputArtifacts: finalRecovered.outputArtifacts,
      rawText: agentResult.rawText,
      artifactPath: path.join(observation.artifactDir, "result.md"),
      agentRuntime,
      agentBackend,
      agentArtifactPath: agentResult.artifactPath,
      piArtifactPath: agentResult.artifactPath,
      observationDir: observation.artifactDir,
      agentObservationDir: agentResult.observationDir,
      piObservationDir: agentResult.observationDir,
      startedAt: agentResult.startedAt,
      finishedAt: agentResult.finishedAt,
      durationMs: agentResult.durationMs,
      outputTransport,
      recoveredArtifactCount: finalRecovered.recoveredArtifactCount,
      artifactDiagnostics: finalRecovered.diagnostics,
      ...(transportRepairApplied ? { transportRepairApplied: true } : {}),
      ...(agentResult.usage ? { usage: agentResult.usage } : {}),
    };

    await observation.writeJson("agent-backend.json", {
      runtime: agentRuntime,
      backend: agentBackend,
      provider: trimmedProvider,
      model: params.model.trim(),
    });

    await observation.writeText("result.md", agentResult.rawText);
    await observation.writeJson("result.json", result);
    const quality = classifySkillBackedQuality(result);
    await observation.finalize({
      executionStatus: "completed",
      qualityStatus: quality.qualityStatus,
      qualityReasons: quality.reasons,
      skillPath: result.skillPath,
      generatedArtifactDir: result.skillArtifactDir,
      expectedOutputCount: result.outputArtifacts.length,
      inputArtifactCount: result.inputArtifacts.length,
      outputTransport: result.outputTransport,
      recoveredArtifactCount: result.recoveredArtifactCount,
      ...(transportRepairApplied ? { transportRepairApplied: true } : {}),
      piArtifactPath: result.piArtifactPath,
      piObservationDir: result.piObservationDir,
      rawTextLength: result.rawText.length,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await observation.writeJson("failure.json", {
      error: errorMessage,
      skillPath,
      cwd,
      inputArtifacts,
      outputArtifacts,
    });
    await observation.finalize({
      executionStatus: "failed",
      qualityStatus: "failed",
      errorMessage,
      skillPath,
    });
    throw error;
  }
}

export type { PiAgentNodeSessionResult };
