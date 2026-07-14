import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { listAcceptedArtifacts, resolveAcceptedArtifact, resolveRunDir, writeArtifactFile } from "../runtimeAccess";

// ---- write-text -----------------------------------------------------------

export const WriteTextNodeParamsSchema = z.object({
  content: z.string(),
  artifactPath: z.string().trim().min(1),
}).strict();
export type WriteTextNodeParams = z.infer<typeof WriteTextNodeParamsSchema>;
export type WriteTextNodePayload = { artifactPath: string; characters: number; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runWriteTextNode(args: { params: WriteTextNodeParams; input: unknown }): Promise<NodeResult<WriteTextNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const file = await writeArtifactFile(runDir, args.params.artifactPath, args.params.content, args.params.artifactPath);
  return {
    status: "completed",
    note: `Wrote ${args.params.content.length} character(s) to ${file.relativePath}.`,
    payload: { artifactPath: file.relativePath!, characters: args.params.content.length, artifactFiles: [file] },
  };
}

export const coreWriteTextNodeTypeEntry: NodeTypeEntry<WriteTextNodeParams, unknown, WriteTextNodePayload> = {
  nodeType: "core.write-text",
  label: "Core Write Text",
  validateParams: (value) => WriteTextNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runWriteTextNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = WriteTextNodeParamsSchema.parse(params);
    return { outputs: [{ key: parsed.artifactPath, label: parsed.artifactPath, relativePath: parsed.artifactPath, kind: "report" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

// ---- write-json -----------------------------------------------------------

export const WriteJsonNodeParamsSchema = z.object({
  value: z.unknown(),
  artifactPath: z.string().trim().min(1).default("output.json"),
}).strict();
export type WriteJsonNodeParams = z.infer<typeof WriteJsonNodeParamsSchema>;
export type WriteJsonNodePayload = { artifactPath: string; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runWriteJsonNode(args: { params: WriteJsonNodeParams; input: unknown }): Promise<NodeResult<WriteJsonNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const file = await writeArtifactFile(runDir, args.params.artifactPath, JSON.stringify(args.params.value ?? null, null, 2), args.params.artifactPath);
  return {
    status: "completed",
    note: `Wrote JSON to ${file.relativePath}.`,
    payload: { artifactPath: file.relativePath!, artifactFiles: [file] },
  };
}

export const coreWriteJsonNodeTypeEntry: NodeTypeEntry<WriteJsonNodeParams, unknown, WriteJsonNodePayload> = {
  nodeType: "core.write-json",
  label: "Core Write JSON",
  validateParams: (value) => WriteJsonNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runWriteJsonNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = WriteJsonNodeParamsSchema.parse(params);
    return { outputs: [{ key: parsed.artifactPath, label: parsed.artifactPath, relativePath: parsed.artifactPath, kind: "contract" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

// ---- read-text / read-json shared source resolution ----------------------
// Source precedence: fromArtifact (an accepted upstream artifact) > sourcePath
// (filesystem) > the sole accepted upstream artifact (when exactly one is declared).

async function resolveReadSource(input: unknown, params: { sourcePath?: string; fromArtifact?: string }): Promise<{ text: string; label: string; origin: string }> {
  if (params.fromArtifact) {
    const ref = resolveAcceptedArtifact(input, params.fromArtifact);
    return { text: await readFile(ref.acceptedPath, "utf8"), label: ref.relativePath, origin: `artifact:${ref.relativePath}` };
  }
  if (params.sourcePath) {
    return { text: await readFile(path.resolve(params.sourcePath), "utf8"), label: path.basename(params.sourcePath), origin: params.sourcePath };
  }
  const accepted = listAcceptedArtifacts(input);
  if (accepted.length === 1) {
    return { text: await readFile(accepted[0]!.acceptedPath, "utf8"), label: accepted[0]!.relativePath, origin: `artifact:${accepted[0]!.relativePath}` };
  }
  throw new Error("read node requires sourcePath, fromArtifact, or exactly one accepted upstream artifact.");
}

// Declared output path from params alone (describeArtifacts has no runtime input).
function declaredReadPath(params: { sourcePath?: string; fromArtifact?: string; artifactPath?: string }, jsonDefault: boolean): string {
  if (params.artifactPath) return params.artifactPath;
  const base = params.fromArtifact ? path.basename(params.fromArtifact) : params.sourcePath ? path.basename(params.sourcePath) : undefined;
  if (base) return jsonDefault && !base.endsWith(".json") ? "output.json" : base;
  return jsonDefault ? "output.json" : "input.txt";
}

// ---- read-text ------------------------------------------------------------

export const ReadTextNodeParamsSchema = z.object({
  sourcePath: z.string().trim().min(1).optional(),
  fromArtifact: z.string().trim().min(1).optional(),
  artifactPath: z.string().trim().min(1).optional(),
}).strict();
export type ReadTextNodeParams = z.infer<typeof ReadTextNodeParamsSchema>;
export type ReadTextNodePayload = { origin: string; artifactPath: string; characters: number; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runReadTextNode(args: { params: ReadTextNodeParams; input: unknown }): Promise<NodeResult<ReadTextNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const { text, label, origin } = await resolveReadSource(args.input, args.params);
  const artifactPath = args.params.artifactPath ?? label;
  const file = await writeArtifactFile(runDir, artifactPath, text, artifactPath);
  return {
    status: "completed",
    note: `Read ${text.length} character(s) from ${origin}.`,
    payload: { origin, artifactPath: file.relativePath!, characters: text.length, artifactFiles: [file] },
  };
}

export const coreReadTextNodeTypeEntry: NodeTypeEntry<ReadTextNodeParams, unknown, ReadTextNodePayload> = {
  nodeType: "core.read-text",
  label: "Core Read Text",
  validateParams: (value) => ReadTextNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runReadTextNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = ReadTextNodeParamsSchema.parse(params);
    const artifactPath = declaredReadPath(parsed, false);
    return { outputs: [{ key: artifactPath, label: artifactPath, relativePath: artifactPath, kind: "report" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

// ---- read-json ------------------------------------------------------------

export const ReadJsonNodeParamsSchema = z.object({
  sourcePath: z.string().trim().min(1).optional(),
  fromArtifact: z.string().trim().min(1).optional(),
  artifactPath: z.string().trim().min(1).optional(),
}).strict();
export type ReadJsonNodeParams = z.infer<typeof ReadJsonNodeParamsSchema>;
export type ReadJsonNodePayload = { origin: string; artifactPath: string; value: unknown; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runReadJsonNode(args: { params: ReadJsonNodeParams; input: unknown }): Promise<NodeResult<ReadJsonNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const { text, label, origin } = await resolveReadSource(args.input, args.params);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      status: "failed",
      note: `Source is not valid JSON (${origin}): ${error instanceof Error ? error.message : String(error)}`,
      payload: { origin, artifactPath: declaredReadPath(args.params, true), value: null, artifactFiles: [] },
    };
  }
  const artifactPath = args.params.artifactPath ?? (label.endsWith(".json") ? label : "output.json");
  const file = await writeArtifactFile(runDir, artifactPath, JSON.stringify(value, null, 2), artifactPath);
  return {
    status: "completed",
    note: `Read and re-emitted JSON from ${origin}.`,
    payload: { origin, artifactPath: file.relativePath!, value, artifactFiles: [file] },
  };
}

export const coreReadJsonNodeTypeEntry: NodeTypeEntry<ReadJsonNodeParams, unknown, ReadJsonNodePayload> = {
  nodeType: "core.read-json",
  label: "Core Read JSON",
  validateParams: (value) => ReadJsonNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runReadJsonNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = ReadJsonNodeParamsSchema.parse(params);
    const artifactPath = declaredReadPath(parsed, true);
    return { outputs: [{ key: artifactPath, label: artifactPath, relativePath: artifactPath, kind: "contract" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
