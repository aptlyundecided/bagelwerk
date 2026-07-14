import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { FlowRunnerNodeExecutionInput } from "../../../flow-runner";
import type { NodeTypeEntry } from "../../../nodes/config";
import type { NodeResult } from "../../../nodes/graph";
import type { PlatformTourInput, TourArtifactPayload } from "../platformTourTypes";
import { asTourInput, writeTextArtifact } from "./shared";

const EmptyParamsSchema = z.object({}).passthrough();
type EmptyParams = z.infer<typeof EmptyParamsSchema>;

export const HANDOFF_PRODUCER_NODE = "platform-tour.context-handoff-demo.create-handoff-packet";

const funnySentences = [
  "The raccoon has notarized the waffle contract.",
  "A goose in a tiny hard hat approved this context transfer.",
  "The moon snail filed the handoff paperwork in triplicate.",
  "A polite toaster stamped this packet as extremely official.",
  "The cardigan committee has declared this context fresh.",
];

export type PlatformTourHandoffPacket = {
  schemaVersion: 1;
  handoffId: string;
  createdAt: string;
  producerNode: typeof HANDOFF_PRODUCER_NODE;
  funnySentence: string;
  meaning: string;
  facts: string[];
};

export const createHandoffPacketConfiguredNode = {
  nodeId: "platform-tour.create-handoff-packet",
  nodeType: "platform-tour.create-handoff-packet",
  name: "create-handoff-packet",
  description: "Creates a small JSON handoff packet for the next Node.",
  createdAt: "2026-05-24",
  updatedAt: "2026-06-03",
  params: {},
} as const;

export async function runCreateHandoffPacketNode(args: {
  params: EmptyParams;
  input: FlowRunnerNodeExecutionInput<PlatformTourInput>;
}): Promise<NodeResult<TourArtifactPayload<PlatformTourHandoffPacket>>> {
  const packet: PlatformTourHandoffPacket = {
    schemaVersion: 1,
    handoffId: randomUUID(),
    createdAt: new Date().toISOString(),
    producerNode: HANDOFF_PRODUCER_NODE,
    funnySentence: funnySentences[Math.floor(Math.random() * funnySentences.length)] ?? funnySentences[0]!,
    meaning: "This file is a small packet of facts for the next Node.",
    facts: [
      "The next Node can read this file instead of relying on memory.",
      "The handoffId is different on every run.",
      "This is how important context moves forward.",
    ],
  };
  const artifactFiles = [
    await writeTextArtifact(args.input.runtime.record.runDir, "handoff-packet.json", JSON.stringify(packet, null, 2)),
  ];

  return {
    status: "completed",
    note: `Created handoff packet ${packet.handoffId}.`,
    payload: {
      finalVerdict: "handoff_packet_created",
      acceptEligible: true,
      artifact: packet,
      artifactFiles,
    },
  };
}

export const createHandoffPacketNodeTypeEntry: NodeTypeEntry<
  EmptyParams,
  FlowRunnerNodeExecutionInput<PlatformTourInput>,
  TourArtifactPayload<PlatformTourHandoffPacket>
> = {
  nodeType: "platform-tour.create-handoff-packet",
  label: "Platform Tour: Create Handoff Packet",
  validateParams: (value) => EmptyParamsSchema.parse(value),
  execute: async ({ params, working }) => runCreateHandoffPacketNode({ params, input: asTourInput(working.input) }),
  describeArtifacts: () => ({
    outputs: [{ key: "handoff-packet.json", label: "Handoff Packet", relativePath: "handoff-packet.json", kind: "handoff" }],
  }),
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
