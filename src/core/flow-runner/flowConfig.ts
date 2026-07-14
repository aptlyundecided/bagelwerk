import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import type { ExternalFlowBinding, ExternalFlowCatalogEntry } from "./types";

export const FLOW_CONFIG_FILENAME = "flow.config.json";

const ExternalFlowRequirementMetadataSchema = z.object({
  network: z.boolean().optional(),
  agentRuntime: z.string().trim().min(1).optional(),
  secrets: z.array(z.string().trim().min(1)).optional(),
  writesDurableState: z.boolean().optional(),
  estimatedDurationMinutes: z.number().positive().optional(),
});

const ExternalFlowInputPromptSchema = z.object({
  key: z.string().trim().min(1),
  kind: z.enum(["text", "number", "confirm", "path", "select"]),
  label: z.string().trim().min(1),
  default: z.unknown().optional(),
  required: z.boolean().optional(),
  choices: z.array(z.object({ label: z.string().trim().min(1), value: z.unknown() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const ExternalFlowSupervisorDefaultsSchema = z.object({
  runMode: z.enum(["advanced", "local", "managed-worktree", "sandbox"]).optional(),
  targetWorkspace: z.string().trim().min(1).optional(),
  allowDirtyWorktree: z.boolean().optional(),
  sessionPrefix: z.string().trim().min(1).optional(),
});

const ExternalFlowRunProfileSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  inputDefaults: z.record(z.unknown()).optional(),
  executionPlan: z.unknown().optional(),
});

const ExternalFlowConfigEntrySchema = z.object({
  id: z.string().trim().min(1, "External flow id is required.").refine((value) => !value.includes(":"), "External flow id must not include ':'. Namespace is assigned by the runner."),
  module: z.string().trim().min(1, "External flow module path is required."),
  exportName: z.string().trim().min(1).default("default"),
  label: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  workspaceName: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1)).default([]),
  requirements: ExternalFlowRequirementMetadataSchema.optional(),
  prompts: z.array(ExternalFlowInputPromptSchema).default([]),
  supervisor: ExternalFlowSupervisorDefaultsSchema.optional(),
  profiles: z.array(ExternalFlowRunProfileSchema).default([]),
});

export const ExternalFlowConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  flows: z.array(ExternalFlowConfigEntrySchema).default([]),
});

export type ExternalFlowConfigEntry = z.infer<typeof ExternalFlowConfigEntrySchema>;
export type ExternalFlowConfig = z.infer<typeof ExternalFlowConfigSchema>;

export type ResolvedExternalFlowConfigEntry = ExternalFlowConfigEntry & {
  namespace: string;
  qualifiedId: string;
  configRoot: string;
  absoluteModulePath: string;
  resolvedWorkspaceName: string;
};

export function sanitizeFlowRunnerPathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "external-flow";
}

export function namespaceForConfigRoot(configRoot: string): string {
  return sanitizeFlowRunnerPathPart(path.basename(path.resolve(configRoot)));
}

export async function readExternalFlowConfig(cwd: string = process.cwd()): Promise<ExternalFlowConfig> {
  const configRoot = path.resolve(cwd);
  const configPath = path.join(configRoot, FLOW_CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf8");
  return ExternalFlowConfigSchema.parse(JSON.parse(raw));
}

async function assertReadableFile(filePath: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    throw new Error(`External flow module is not accessible: ${filePath} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`External flow module is not a file: ${filePath}`);
  }
}

export async function resolveExternalFlowConfig(cwd: string = process.cwd()): Promise<ResolvedExternalFlowConfigEntry[]> {
  const configRoot = path.resolve(cwd);
  const config = await readExternalFlowConfig(configRoot);
  const namespace = namespaceForConfigRoot(configRoot);
  const seen = new Set<string>();
  const resolved: ResolvedExternalFlowConfigEntry[] = [];

  for (const entry of config.flows) {
    const absoluteModulePath = path.resolve(configRoot, entry.module);
    await assertReadableFile(absoluteModulePath);
    const qualifiedId = `${namespace}:${entry.id}`;
    if (seen.has(qualifiedId)) {
      throw new Error(`Duplicate external flow id after namespace resolution: ${qualifiedId}`);
    }
    seen.add(qualifiedId);
    resolved.push({
      ...entry,
      namespace,
      qualifiedId,
      configRoot,
      absoluteModulePath,
      resolvedWorkspaceName: sanitizeFlowRunnerPathPart(entry.workspaceName ?? `${namespace}-${entry.id}`),
    });
  }

  return resolved;
}

export async function listExternalFlows(cwd: string = process.cwd()): Promise<ExternalFlowCatalogEntry[]> {
  const entries = await resolveExternalFlowConfig(cwd);
  return entries.map((entry) => externalFlowCatalogEntryFromResolved(entry, "cwd"));
}

export function externalFlowCatalogEntryFromResolved(entry: ResolvedExternalFlowConfigEntry, sourceKind: ExternalFlowCatalogEntry["source"]["kind"]): ExternalFlowCatalogEntry {
  return {
    id: entry.qualifiedId,
    localId: entry.id,
    namespace: entry.namespace,
    aliases: normalizedAliases(entry.aliases),
    label: entry.label ?? entry.id,
    ...(entry.description ? { description: entry.description } : {}),
    cwd: entry.configRoot,
    modulePath: entry.absoluteModulePath,
    exportName: entry.exportName,
    workspaceName: entry.resolvedWorkspaceName,
    source: { kind: sourceKind, root: entry.configRoot, configPath: path.join(entry.configRoot, FLOW_CONFIG_FILENAME) },
    ...(entry.requirements ? { requirements: entry.requirements } : {}),
    ...(entry.prompts.length > 0 ? { prompts: entry.prompts } : {}),
    ...(entry.supervisor ? { supervisor: entry.supervisor } : {}),
    ...(entry.profiles.length > 0 ? { profiles: entry.profiles as ExternalFlowCatalogEntry["profiles"] } : {}),
  };
}

function normalizedAliases(aliases: string[]): string[] {
  return Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)));
}

export async function resolveExternalFlowById(args: { cwd?: string; flowId: string }): Promise<ResolvedExternalFlowConfigEntry> {
  const entries = await resolveExternalFlowConfig(args.cwd ?? process.cwd());
  const match = entries.find((entry) => entry.qualifiedId === args.flowId || entry.id === args.flowId);
  if (!match) {
    const known = entries.map((entry) => entry.qualifiedId).join(", ") || "<none>";
    throw new Error(`Unknown external flow '${args.flowId}'. Known flows: ${known}`);
  }
  return match;
}

function assertExternalFlowBinding(value: unknown, modulePath: string, exportName: string): ExternalFlowBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`External flow export '${exportName}' from ${modulePath} must be an object.`);
  }
  const binding = value as Partial<ExternalFlowBinding>;
  if (!binding.flow) {
    throw new Error(`External flow export '${exportName}' from ${modulePath} must include flow.`);
  }
  if (!Array.isArray(binding.configuredNodes)) {
    throw new Error(`External flow export '${exportName}' from ${modulePath} must include configuredNodes array.`);
  }
  if (!binding.nodeRegistry || typeof binding.nodeRegistry.get !== "function" || typeof binding.nodeRegistry.list !== "function") {
    throw new Error(`External flow export '${exportName}' from ${modulePath} must include nodeRegistry with get/list functions.`);
  }
  return binding as ExternalFlowBinding;
}

export async function importExternalFlowBinding(entry: ResolvedExternalFlowConfigEntry): Promise<ExternalFlowBinding> {
  const imported = await import(pathToFileURL(entry.absoluteModulePath).href);
  const candidate = entry.exportName === "default"
    ? imported.default ?? imported.flowBinding ?? imported.externalFlowBinding
    : imported[entry.exportName];
  return assertExternalFlowBinding(candidate, entry.absoluteModulePath, entry.exportName);
}
