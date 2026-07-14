import { createStaticNodeRegistry } from "../../../nodes/config";
import { coreTimerNodeTypeEntry } from "../../../nodes/generic/timer";
import { createHandoffPacketConfiguredNode, createHandoffPacketNodeTypeEntry } from "./createHandoffPacket";
import { draftTourGraphConfiguredNode, draftTourGraphNodeTypeEntry } from "./draftTourGraph";
import { createExplainCodeNodeTypeEntry, explainCodeConfiguredNode } from "./explainCode";
import { introConfiguredNode, introNodeTypeEntry } from "./intro";
import { createReadHandoffPacketNodeTypeEntry, readHandoffPacketConfiguredNode } from "./readHandoffPacket";
import {
  createRenderTourGraphNodeTypeEntry,
  renderTourGraphConfiguredNode,
  type RenderTourGraphDeps,
} from "./renderTourGraph";
import type { TourRunAgent } from "./shared";
import { summarizeConfiguredNode, summarizeNodeTypeEntry } from "./summarize";

export { sampleTourRunAgent } from "./shared";

// Three "visible pause" beats reuse the generic core.timer Node type to show that a
// plain, model-free code Node is a first-class citizen of a Flow.
export const demoCodeNodeConfiguredNode = {
  nodeId: "platform-tour.demo-code-node",
  nodeType: "core.timer",
  name: "demo-code-node",
  description: "Visible timer demonstrating a plain code-owned node type.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  params: { delayMs: 3000, message: "Bagelwerk timer finished" },
} as const;

export const agentThinkingConfiguredNode = {
  nodeId: "platform-tour.agent-thinking",
  nodeType: "core.timer",
  name: "agent-thinking",
  description: "Small visible pause before the tour writes its sample agent note.",
  createdAt: "2026-05-25",
  updatedAt: "2026-06-03",
  params: { delayMs: 2200, message: "Agent preview pause finished" },
} as const;

export const handoffAgentThinkingConfiguredNode = {
  nodeId: "platform-tour.handoff-agent-thinking",
  nodeType: "core.timer",
  name: "handoff-agent-thinking",
  description: "Small visible pause before the tour turns a handoff packet into a note.",
  createdAt: "2026-05-25",
  updatedAt: "2026-06-03",
  params: { delayMs: 2200, message: "Handoff agent preview pause finished" },
} as const;

export type PlatformTourNodeDeps = RenderTourGraphDeps & {
  /** Real agent backend for the explain/read-handoff Nodes; defaults to the installed pi CLI. */
  runAgent?: TourRunAgent;
};

export const platformTourConfiguredNodes = [
  introConfiguredNode,
  demoCodeNodeConfiguredNode,
  agentThinkingConfiguredNode,
  explainCodeConfiguredNode,
  createHandoffPacketConfiguredNode,
  handoffAgentThinkingConfiguredNode,
  readHandoffPacketConfiguredNode,
  draftTourGraphConfiguredNode,
  renderTourGraphConfiguredNode,
  summarizeConfiguredNode,
] as const;

export function createPlatformTourNodeTypeEntries(deps: PlatformTourNodeDeps = {}) {
  return [
    introNodeTypeEntry,
    coreTimerNodeTypeEntry,
    createExplainCodeNodeTypeEntry({ ...(deps.runAgent ? { runAgent: deps.runAgent } : {}) }),
    createHandoffPacketNodeTypeEntry,
    createReadHandoffPacketNodeTypeEntry({ ...(deps.runAgent ? { runAgent: deps.runAgent } : {}) }),
    draftTourGraphNodeTypeEntry,
    createRenderTourGraphNodeTypeEntry(deps),
    summarizeNodeTypeEntry,
  ] as const;
}

export function createPlatformTourNodeRegistry(deps: PlatformTourNodeDeps = {}) {
  return createStaticNodeRegistry([...createPlatformTourNodeTypeEntries(deps)]);
}

export const platformTourNodeRegistry = createPlatformTourNodeRegistry();
