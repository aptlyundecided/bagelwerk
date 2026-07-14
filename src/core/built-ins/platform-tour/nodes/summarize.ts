import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, writeTextArtifact } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

export const summarizeConfiguredNode = {
  nodeId: "platform-tour.summarize",
  nodeType: "platform-tour.summarize",
  name: "summarize",
  description: "Index of platform tour artifacts.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: {},
} as const;

export async function runSummarizeNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
}): Promise<NodeResult<TourArtifactPayload<{ markdown: string }>>> {
  const markdown = `# Platform tour complete

You ran **platform-tour** in Bagelwerk.

## Files from this run

| What it shows | File |
| --- | --- |
| The tour started | \`toy-welcome.md\` |
| An agent-style note explained the run | \`agent-note.md\` |
| One Node handed facts to the next | \`handoff-packet.json\`, \`handoff-packet-readable.md\` |
| The workflow drew itself | \`platform-tour-graph.svg\`, \`graph-tour.md\` |

## Next steps

- Re-run the tour with a named session: \`npm run flow:tour -- --session <id>\`
- Read how it is built: \`src/core/built-ins/platform-tour/\` — one flow, a nested sub-flow, plain code Nodes, and a graph it draws of itself.
- Author your own Flow: start from \`GETTING-STARTED.md\` step 8.
`;
  const artifactFiles = [await writeTextArtifact(args.input.runtime.record.runDir, "platform-tour.md", markdown)];
  return {
    status: "completed",
    note: "Platform tour summary written.",
    payload: {
      finalVerdict: "tour_summarized",
      acceptEligible: true,
      artifact: { markdown },
      artifactFiles,
    },
  };
}

export const summarizeNodeTypeEntry: NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<{ markdown: string }>
> = {
  nodeType: "platform-tour.summarize",
  label: "Platform Tour: Summary",
  validateParams: (value) => EmptyParamsSchema.parse(value),
  execute: async ({ params, working }) => runSummarizeNode({ params, input: asTourInput(working.input) }),
  describeArtifacts: () => ({ outputs: [{ key: "platform-tour.md", label: "Platform Tour", relativePath: "platform-tour.md", kind: "report" }] }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
