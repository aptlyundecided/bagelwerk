import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, normalizeTourInput, writeTextArtifact } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

export const introConfiguredNode = {
  nodeId: "platform-tour.intro",
  nodeType: "platform-tour.intro",
  name: "intro",
  description: "Welcome and tour map for the Bagelwerk platform tour.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: {},
} as const;

export async function runIntroNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
}): Promise<NodeResult<TourArtifactPayload<{ markdown: string }>>> {
  const input = normalizeTourInput(args.input.userInput);
  const who = input.operatorName?.trim() || "operator";
  const markdown = `# Welcome to Bagelwerk

Hello, ${who}. This tour is a quick introduction, not a deep tutorial.

## What you will see

1. A tiny job creates this welcome note.
2. A plain code step runs without an AI model.
3. An agent-style step turns earlier context into a short note.
4. One step packs facts into a handoff packet.
5. Another step opens that packet and makes it readable.
6. The run draws a picture of itself.
7. The final step writes a short summary.

The big idea: split work into small visible jobs, and leave useful files behind.
`;
  const artifactFiles = [await writeTextArtifact(args.input.runtime.record.runDir, "toy-welcome.md", markdown)];
  return {
    status: "completed",
    note: "Platform tour welcome written.",
    payload: {
      finalVerdict: "tour_intro_written",
      acceptEligible: true,
      artifact: { markdown },
      artifactFiles,
    },
  };
}

export const introNodeTypeEntry: NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<{ markdown: string }>
> = {
  nodeType: "platform-tour.intro",
  label: "Platform Tour: Intro",
  validateParams: (value) => EmptyParamsSchema.parse(value),
  execute: async ({ params, working }) => runIntroNode({ params, input: asTourInput(working.input) }),
  describeArtifacts: () => ({ outputs: [{ key: "toy-welcome.md", label: "Welcome", relativePath: "toy-welcome.md", kind: "report" }] }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
