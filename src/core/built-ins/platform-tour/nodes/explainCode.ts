import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, defaultTourRunAgent, readAcceptedTextArtifact, writeTextArtifact, type TourRunAgent } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

const SAMPLE_RESPONSE = "An agent would turn the raw run details into a short human note: the tour started, a plain timer ran, and Bagelwerk saved files so later steps can build on them.";

type AgentPreviewArtifact = {
  mode: "agent" | "provided" | "sample";
  agentBackend?: string;
  prompt: string;
  response: string;
  sourceSnippet: string;
};

export type ExplainCodeDeps = { runAgent?: TourRunAgent };

export const explainCodeConfiguredNode = {
  nodeId: "platform-tour.explain-code-node",
  nodeType: "platform-tour.explain-code-node",
  name: "explain-code-node",
  description: "Calls a real agent to explain what happened so far in the tour.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: {},
} as const;

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function runExplainCodeNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
  runAgent: TourRunAgent;
}): Promise<NodeResult<TourArtifactPayload<AgentPreviewArtifact>>> {
  const { input } = args;
  const welcome = await readAcceptedTextArtifact(input, "toy-welcome.md");
  const sourceSnippet = welcome.split(/\r?\n/).slice(0, 8).join("\n");
  const prompt = `You are narrating a short onboarding tour. In one friendly paragraph, explain what just happened in the first couple of steps. Here is the welcome note the tour wrote:\n\n${welcome}`;

  // Priority: an explicit test/override response, then a real agent call, then a safe sample.
  const provided = asOptionalString((input.userInput as Record<string, unknown>).agentPreviewResponse);
  let response = SAMPLE_RESPONSE;
  let mode: AgentPreviewArtifact["mode"] = "sample";
  let agentBackend: string | undefined;
  if (provided) {
    response = provided;
    mode = "provided";
  } else {
    try {
      const result = await args.runAgent({
        prompt,
        cwd: input.runtime.record.runDir,
        runDir: input.runtime.record.runDir,
        nodeId: "platform-tour.explain-code-node",
        sessionId: input.runtime.sessionId,
        executionPolicy: input.runtime.launchSnapshot.executionPolicy,
      });
      const text = result.rawText.trim();
      if (text) {
        response = text;
        mode = "agent";
        agentBackend = `${result.provider}/${result.model}`;
      }
    } catch {
      // No agent reachable (e.g. CI / no runtime installed) — fall back to the sample note.
      mode = "sample";
    }
  }

  const markdown = `# Agent note

This step asked a real agent to explain the run so far${mode === "agent" ? ` (via ${agentBackend}).` : mode === "provided" ? " (response supplied by the caller)." : " — no live agent was reachable, so this is a sample note."}

## Prompt

${prompt}

## Agent output

${response}

## Why this is useful

Plain code can do reliable work. An agent can add judgment, explanation, or synthesis when that helps a human understand the result.
`;
  const artifactFiles = [await writeTextArtifact(input.runtime.record.runDir, "agent-note.md", markdown)];
  return {
    status: "completed",
    note: mode === "agent" ? `Agent explained the run (${agentBackend}).` : mode === "provided" ? "Used supplied agent response." : "No live agent — wrote a sample note.",
    payload: {
      finalVerdict: mode === "sample" ? "sample_agent_preview_written" : "agent_preview_written",
      acceptEligible: true,
      artifact: { mode, ...(agentBackend ? { agentBackend } : {}), prompt, response, sourceSnippet },
      artifactFiles,
    },
  };
}

export function createExplainCodeNodeTypeEntry(deps: ExplainCodeDeps = {}): NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<AgentPreviewArtifact>
> {
  const runAgent = deps.runAgent ?? defaultTourRunAgent;
  return {
    nodeType: "platform-tour.explain-code-node",
    label: "Platform Tour: Agent Note",
    validateParams: (value) => EmptyParamsSchema.parse(value),
    execute: async ({ params, working }) => runExplainCodeNode({ params, input: asTourInput(working.input), runAgent }),
    describeArtifacts: () => ({ outputs: [{ key: "agent-note.md", label: "Agent Note", relativePath: "agent-note.md", kind: "report" }] }),
    collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
  };
}

export const explainCodeNodeTypeEntry = createExplainCodeNodeTypeEntry();
