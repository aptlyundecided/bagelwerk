export const platformTourFlow = {
  flowId: "platform-tour",
  name: "Bagelwerk Platform Tour",
  description: "Welcome tour: small jobs that create files, hand facts forward, draw a graph, and summarize the run.",
  createdAt: "2026-05-23",
  updatedAt: "2026-06-03",
  initial: "intro",
  nodes: {
    intro: { nodeId: "platform-tour.intro" },
    "demo-code-node": { nodeId: "platform-tour.demo-code-node" },
    "agent-thinking": { nodeId: "platform-tour.agent-thinking" },
    "explain-code-node": {
      nodeId: "platform-tour.explain-code-node",
      acceptedArtifacts: [{ from: "intro", relativePath: "toy-welcome.md" }],
    },
    "draft-tour-graph": {
      nodeId: "platform-tour.draft-tour-graph",
      acceptedArtifacts: [{ from: "platform-tour.context-handoff-demo.read-handoff-packet", relativePath: "handoff-packet-readable.md" }],
    },
    "render-tour-graph": {
      nodeId: "platform-tour.render-tour-graph",
      acceptedArtifacts: [{ from: "draft-tour-graph", relativePath: "platform-tour-graph.mmd" }],
    },
    summarize: {
      nodeId: "platform-tour.summarize",
      acceptedArtifacts: [{ from: "render-tour-graph", relativePath: "graph-tour.md" }],
    },
  },
  flows: {
    "context-handoff-demo": {
      flowId: "platform-tour.context-handoff-demo",
      name: "Context Handoff Demo",
      description: "Small handoff demo: one Node writes a packet of facts, and the next Node turns it into a readable note.",
      createdAt: "2026-05-24",
      updatedAt: "2026-06-03",
      initial: "create-handoff-packet",
      nodes: {
        "create-handoff-packet": { nodeId: "platform-tour.create-handoff-packet" },
        "handoff-agent-thinking": { nodeId: "platform-tour.handoff-agent-thinking" },
        "read-handoff-packet": {
          nodeId: "platform-tour.read-handoff-packet",
          acceptedArtifacts: [{ from: "create-handoff-packet", relativePath: "handoff-packet.json" }],
        },
      },
      edges: [
        { from: "create-handoff-packet", to: "handoff-agent-thinking", on: "completed" },
        { from: "handoff-agent-thinking", to: "read-handoff-packet", on: "completed" },
      ],
    },
  },
  edges: [
    { from: "intro", to: "demo-code-node", on: "completed" },
    { from: "demo-code-node", to: "agent-thinking", on: "completed" },
    { from: "agent-thinking", to: "explain-code-node", on: "completed" },
    { from: "explain-code-node", to: "context-handoff-demo", on: "completed" },
    { from: "context-handoff-demo", to: "draft-tour-graph", on: "completed" },
    { from: "draft-tour-graph", to: "render-tour-graph", on: "completed" },
    { from: "render-tour-graph", to: "summarize", on: "completed" },
  ],
} as const;
