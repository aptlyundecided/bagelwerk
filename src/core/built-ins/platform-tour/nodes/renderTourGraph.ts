import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import { renderMermaidSvg as defaultRenderMermaidSvg } from "../../../graph-visualization";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, openSvgHint, readAcceptedTextArtifact, writeTextArtifact } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

type RenderMermaidSvg = typeof defaultRenderMermaidSvg;

export type RenderTourGraphDeps = {
  renderMermaidSvg?: RenderMermaidSvg;
};

export const renderTourGraphConfiguredNode = {
  nodeId: "platform-tour.render-tour-graph",
  nodeType: "platform-tour.render-tour-graph",
  name: "render-tour-graph",
  description: "Renders platform-tour-graph.mmd to SVG.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: {},
} as const;

export async function runRenderTourGraphNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
  deps?: RenderTourGraphDeps;
}): Promise<NodeResult<TourArtifactPayload<{ ok: boolean; svgPath?: string }>>> {
  const mermaidSource = await readAcceptedTextArtifact(args.input, "platform-tour-graph.mmd");
  const renderMermaidSvg = args.deps?.renderMermaidSvg ?? defaultRenderMermaidSvg;
  const renderResult = await renderMermaidSvg({
    mermaidSource,
    outputDirectory: args.input.runtime.record.runDir,
    baseName: "platform-tour-graph",
  });

  const artifactFiles = [];
  if (renderResult.ok) {
    artifactFiles.push(
      { key: "platform-tour-graph.mmd", label: "Tour Graph Mermaid", path: renderResult.mermaidPath, relativePath: "platform-tour-graph.mmd" },
      { key: "platform-tour-graph.svg", label: "Tour Graph SVG", path: renderResult.svgPath, relativePath: "platform-tour-graph.svg" },
    );
    const graphTourMd = `# Graph tour

This SVG is the **resolved platform tour** at run time.

## Files

- Mermaid: \`platform-tour-graph.mmd\`
- SVG: \`platform-tour-graph.svg\`

## Open the SVG

From the directory containing the SVG:

\`\`\`
${openSvgHint("platform-tour-graph.svg")}
\`\`\`
`;
    artifactFiles.push(await writeTextArtifact(args.input.runtime.record.runDir, "graph-tour.md", graphTourMd));
  }

  return {
    status: renderResult.ok ? "completed" : "failed",
    note: renderResult.ok ? "Rendered platform tour SVG." : `Render failed: ${renderResult.errorMessage ?? "unknown"}`,
    payload: {
      finalVerdict: renderResult.ok ? "tour_graph_rendered" : "tour_graph_render_failed",
      acceptEligible: renderResult.ok,
      artifact: { ok: renderResult.ok, svgPath: renderResult.ok ? renderResult.svgPath : undefined },
      artifactFiles,
    },
  };
}

export function createRenderTourGraphNodeTypeEntry(
  deps: RenderTourGraphDeps = {},
): NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<{ ok: boolean; svgPath?: string }>
> {
  return {
    nodeType: "platform-tour.render-tour-graph",
    label: "Platform Tour: Render Tour Graph",
    validateParams: (value) => EmptyParamsSchema.parse(value),
    execute: async ({ params, working }) => runRenderTourGraphNode({ params, input: asTourInput(working.input), deps }),
    describeArtifacts: () => ({
      outputs: [
        { key: "platform-tour-graph.svg", label: "Tour Graph SVG", relativePath: "platform-tour-graph.svg", kind: "report" },
        { key: "graph-tour.md", label: "Graph Tour", relativePath: "graph-tour.md", kind: "report" },
      ],
    }),
    collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
  };
}

export const renderTourGraphNodeTypeEntry = createRenderTourGraphNodeTypeEntry();
