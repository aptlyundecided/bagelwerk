import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, defaultTourRunAgent, readAcceptedTextArtifact, writeTextArtifact, type TourRunAgent } from "./shared";
import { HANDOFF_PRODUCER_NODE, type PlatformTourHandoffPacket } from "./createHandoffPacket";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

export type ReadHandoffPacketDeps = { runAgent?: TourRunAgent };

const HandoffPacketSchema = z.object({
  schemaVersion: z.literal(1),
  handoffId: z.string().uuid(),
  createdAt: z.string().min(1),
  producerNode: z.literal(HANDOFF_PRODUCER_NODE),
  funnySentence: z.string().min(1),
  meaning: z.string().min(1),
  facts: z.array(z.string().min(1)).min(1),
});

export const readHandoffPacketConfiguredNode = {
  nodeId: "platform-tour.read-handoff-packet",
  nodeType: "platform-tour.read-handoff-packet",
  name: "read-handoff-packet",
  description: "Asks a real agent to turn the handoff packet into a readable note.",
  createdAt: "2026-05-24",
  updatedAt: "2026-06-03",
  params: {},
} as const;

export async function runReadHandoffPacketNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
  runAgent: TourRunAgent;
}): Promise<NodeResult<TourArtifactPayload<{ markdown: string; packet: PlatformTourHandoffPacket; mode: "agent" | "sample" }>>> {
  const { input } = args;
  const rawPacket = await readAcceptedTextArtifact(input, "handoff-packet.json");
  const packet = HandoffPacketSchema.parse(JSON.parse(rawPacket)) as PlatformTourHandoffPacket;

  const prompt = `A previous step wrote this handoff packet as JSON. In two friendly sentences, explain to a newcomer what it contains and why passing context in a file like this is useful:\n\n${JSON.stringify(packet, null, 2)}`;
  let agentExplanation: string | undefined;
  let mode: "agent" | "sample" = "sample";
  let agentBackend: string | undefined;
  try {
    const result = await args.runAgent({
      prompt,
      cwd: input.runtime.record.runDir,
      runDir: input.runtime.record.runDir,
      nodeId: "platform-tour.read-handoff-packet",
      sessionId: input.runtime.sessionId,
      executionPolicy: input.runtime.launchSnapshot.executionPolicy,
    });
    const text = result.rawText.trim();
    if (text) {
      agentExplanation = text;
      mode = "agent";
      agentBackend = `${result.provider}/${result.model}`;
    }
  } catch {
    mode = "sample";
  }

  const markdown = `# Agent-style handoff note

One Node packed facts into \`handoff-packet.json\`. ${mode === "agent" ? `A real agent (${agentBackend}) opened that packet and explained it:` : "An agent would open that packet and explain it (no live agent was reachable, so the packet details are shown below)."}

${mode === "agent" ? `> ${agentExplanation!.replace(/\n+/g, "\n> ")}\n` : ""}
## Packet details

| Field | Value |
| --- | --- |
| Handoff id | \`${packet.handoffId}\` |
| Created at | \`${packet.createdAt}\` |
| Funny sentence | “${packet.funnySentence}” |

## Why this is useful

${packet.meaning}

${packet.facts.map((fact) => `- ${fact}`).join("\n")}

## What this shows

1. One Node can package up important facts.
2. An agent-style Node can read those facts later.
3. The handoff is visible because it lives in files you can open.
`;
  const artifactFiles = [await writeTextArtifact(input.runtime.record.runDir, "handoff-packet-readable.md", markdown)];
  return {
    status: "completed",
    note: mode === "agent" ? `Agent read handoff packet ${packet.handoffId} (${agentBackend}).` : `Read handoff packet ${packet.handoffId} (no live agent).`,
    payload: {
      finalVerdict: "handoff_packet_read",
      acceptEligible: true,
      artifact: { markdown, packet, mode },
      artifactFiles,
    },
  };
}

export function createReadHandoffPacketNodeTypeEntry(deps: ReadHandoffPacketDeps = {}): NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<{ markdown: string; packet: PlatformTourHandoffPacket; mode: "agent" | "sample" }>
> {
  const runAgent = deps.runAgent ?? defaultTourRunAgent;
  return {
    nodeType: "platform-tour.read-handoff-packet",
    label: "Platform Tour: Read Handoff Packet",
    validateParams: (value) => EmptyParamsSchema.parse(value),
    execute: async ({ params, working }) => runReadHandoffPacketNode({ params, input: asTourInput(working.input), runAgent }),
    describeArtifacts: () => ({
      outputs: [{ key: "handoff-packet-readable.md", label: "Readable Handoff Packet", relativePath: "handoff-packet-readable.md", kind: "report" }],
    }),
    collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
  };
}

export const readHandoffPacketNodeTypeEntry = createReadHandoffPacketNodeTypeEntry();
