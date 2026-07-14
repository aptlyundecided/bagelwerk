import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, writeTextArtifact } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

export const draftTourGraphConfiguredNode = {
  nodeId: "platform-tour.draft-tour-graph",
  nodeType: "platform-tour.draft-tour-graph",
  name: "draft-tour-graph",
  description: "Writes Mermaid source for the platform tour graph.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: {},
} as const;

function buildTourMermaid(): string {
  return `flowchart TD
  intro["intro\\n(platform-tour.intro)"]
  timer["demo-code-node\\n(core.timer)"]
  explain["explain-code-node"]
  subgraph handoff["context-handoff-demo nested Flow"]
    create["create-handoff-packet\n(JSON)"]
    read["read-handoff-packet\n(fresh context)"]
    create --> read
  end
  draft["draft-tour-graph"]
  render["render-tour-graph"]
  summary["summarize"]
  intro --> timer
  timer --> explain
  explain --> create
  read --> draft
  draft --> render
  render --> summary
`;
}

export async function runDraftTourGraphNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
}): Promise<NodeResult<TourArtifactPayload<{ mermaidSource: string }>>> {
  const mermaidSource = buildTourMermaid();
  const artifactFiles = [
    await writeTextArtifact(args.input.runtime.record.runDir, "platform-tour-graph.mmd", mermaidSource),
  ];
  return {
    status: "completed",
    note: "Drafted platform tour Mermaid graph.",
    payload: {
      finalVerdict: "tour_graph_drafted",
      acceptEligible: true,
      artifact: { mermaidSource },
      artifactFiles,
    },
  };
}

export const draftTourGraphNodeTypeEntry: NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<{ mermaidSource: string }>
> = {
  nodeType: "platform-tour.draft-tour-graph",
  label: "Platform Tour: Draft Tour Graph",
  validateParams: (value) => EmptyParamsSchema.parse(value),
  execute: async ({ params, working }) => runDraftTourGraphNode({ params, input: asTourInput(working.input) }),
  describeArtifacts: () => ({
    outputs: [{ key: "platform-tour-graph.mmd", label: "Tour Graph Mermaid", relativePath: "platform-tour-graph.mmd", kind: "report" }],
  }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
