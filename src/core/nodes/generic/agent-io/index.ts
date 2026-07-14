import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { buildAcceptedArtifactContext, defaultGenericAgentText, extractJsonText, resolveRunDir, writeArtifactFile, type GenericAgentText } from "../runtimeAccess";

const ThinkingLevelSchema = z.enum(["off", "low", "medium", "high"]);

// ---- agent-markdown -------------------------------------------------------

export const AgentMarkdownNodeParamsSchema = z.object({
  prompt: z.string().trim().min(1),
  artifactPath: z.string().trim().min(1).default("agent-output.md"),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
}).strict();
export type AgentMarkdownNodeParams = z.infer<typeof AgentMarkdownNodeParamsSchema>;
export type AgentMarkdownNodePayload = { provider: string; model: string; rawText: string; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runAgentMarkdownNode(args: {
  nodeId: string;
  params: AgentMarkdownNodeParams;
  input: unknown;
  runAgent?: GenericAgentText;
}): Promise<NodeResult<AgentMarkdownNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const runAgent = args.runAgent ?? defaultGenericAgentText;
  // Fold every accepted upstream artifact into the prompt (single source of truth = acceptedArtifacts).
  const context = await buildAcceptedArtifactContext(args.input);
  const result = await runAgent({
    prompt: `${args.params.prompt}${context}`,
    input: args.input,
    nodeId: args.nodeId,
    ...(args.params.provider ? { provider: args.params.provider } : {}),
    ...(args.params.model ? { model: args.params.model } : {}),
    ...(args.params.thinkingLevel ? { thinkingLevel: args.params.thinkingLevel } : {}),
  });
  const file = await writeArtifactFile(runDir, args.params.artifactPath, result.rawText, args.params.artifactPath);
  return {
    status: "completed",
    note: `Agent (${result.provider}/${result.model}) wrote ${result.rawText.length} character(s) to ${file.relativePath}.`,
    payload: { provider: result.provider, model: result.model, rawText: result.rawText, artifactFiles: [file] },
  };
}

export const coreAgentMarkdownNodeTypeEntry: NodeTypeEntry<AgentMarkdownNodeParams, unknown, AgentMarkdownNodePayload> = {
  nodeType: "core.agent-markdown",
  label: "Core Agent Markdown",
  validateParams: (value) => AgentMarkdownNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runAgentMarkdownNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = AgentMarkdownNodeParamsSchema.parse(params);
    return { outputs: [{ key: parsed.artifactPath, label: parsed.artifactPath, relativePath: parsed.artifactPath, kind: "report" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};

// ---- agent-json -----------------------------------------------------------

export const AgentJsonNodeParamsSchema = z.object({
  prompt: z.string().trim().min(1),
  artifactPath: z.string().trim().min(1).default("agent-output.json"),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
}).strict();
export type AgentJsonNodeParams = z.infer<typeof AgentJsonNodeParamsSchema>;
export type AgentJsonNodePayload = { provider: string; model: string; value: unknown; rawText: string; artifactFiles: EmittedNodeArtifactRecord[] };

export async function runAgentJsonNode(args: {
  nodeId: string;
  params: AgentJsonNodeParams;
  input: unknown;
  runAgent?: GenericAgentText;
}): Promise<NodeResult<AgentJsonNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const runAgent = args.runAgent ?? defaultGenericAgentText;
  // Fold every accepted upstream artifact into the prompt (single source of truth = acceptedArtifacts).
  const context = await buildAcceptedArtifactContext(args.input);
  const result = await runAgent({
    prompt: `${args.params.prompt}${context}\n\nRespond with valid JSON only — no prose, no code fences.`,
    input: args.input,
    nodeId: args.nodeId,
    ...(args.params.provider ? { provider: args.params.provider } : {}),
    ...(args.params.model ? { model: args.params.model } : {}),
    ...(args.params.thinkingLevel ? { thinkingLevel: args.params.thinkingLevel } : {}),
  });
  let value: unknown;
  try {
    value = JSON.parse(extractJsonText(result.rawText));
  } catch (error) {
    return {
      status: "failed",
      note: `Agent did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      payload: { provider: result.provider, model: result.model, value: null, rawText: result.rawText, artifactFiles: [] },
    };
  }
  const file = await writeArtifactFile(runDir, args.params.artifactPath, JSON.stringify(value, null, 2), args.params.artifactPath);
  return {
    status: "completed",
    note: `Agent (${result.provider}/${result.model}) returned JSON to ${file.relativePath}.`,
    payload: { provider: result.provider, model: result.model, value, rawText: result.rawText, artifactFiles: [file] },
  };
}

export const coreAgentJsonNodeTypeEntry: NodeTypeEntry<AgentJsonNodeParams, unknown, AgentJsonNodePayload> = {
  nodeType: "core.agent-json",
  label: "Core Agent JSON",
  validateParams: (value) => AgentJsonNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runAgentJsonNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = AgentJsonNodeParamsSchema.parse(params);
    return { outputs: [{ key: parsed.artifactPath, label: parsed.artifactPath, relativePath: parsed.artifactPath, kind: "contract" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
