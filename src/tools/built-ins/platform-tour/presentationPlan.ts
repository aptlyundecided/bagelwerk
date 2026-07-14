// Narration for the interactive platform-tour presenter. Pure data — no runner imports.
// The ordered beats below are the exact node-execution order of platformTourFlow (incl. the
// nested context-handoff-demo.* paths and the core.timer "thinking" beats), so the presenter
// can run them one-by-one via runFlowRunnerNode and each step's accepted artifacts feed the next.

export type PlatformTourBeatArtifact = {
  label: string;
  relativePath: string;
  whyOpen?: string;
};

export type PlatformTourBeat = {
  id: string;
  title: string;
  qualifiedNodePath: string;
  whatHappens: string[];
  whyItMatters: string[];
  postRunTakeaways?: string[];
  expectedArtifacts: PlatformTourBeatArtifact[];
  /** For core.timer beats: the timer duration, so the TUI can show a live countdown. */
  approxMs?: number;
};

export type PlatformTourFinalOpenTarget = PlatformTourBeatArtifact & {
  qualifiedNodePath: string;
  priority: number;
};

export const platformTourPresentationBeats: PlatformTourBeat[] = [
  {
    id: "welcome",
    title: "Start with one tiny job",
    qualifiedNodePath: "platform-tour.intro",
    whatHappens: ["Bagelwerk writes a welcome note.", "That note is saved as a real file you can open later."],
    whyItMatters: ["Big automations are easier to trust when you can see each small step finish."],
    postRunTakeaways: ["One small job ran and left behind a file.", "That is the basic building block of the system."],
    expectedArtifacts: [{ label: "Welcome note", relativePath: "toy-welcome.md", whyOpen: "A tiny receipt that the tour started." }],
  },
  {
    id: "code-node",
    title: "Watch plain code run",
    qualifiedNodePath: "platform-tour.demo-code-node",
    whatHappens: ["Bagelwerk runs a real timer.", "This is the code side of the system: exact, repeatable work with no AI needed."],
    whyItMatters: [
      "A useful workflow can cross the boundary between plain code and agent judgment.",
      "Use code for facts and repeatability; use agents when you need interpretation.",
    ],
    postRunTakeaways: ["Bagelwerk is not only for AI calls.", "It can jump between deterministic code and agent-style inference in one run."],
    expectedArtifacts: [],
    approxMs: 3000,
  },
  {
    id: "agent-thinking",
    title: "A short beat to think",
    qualifiedNodePath: "platform-tour.agent-thinking",
    whatHappens: ["A small pause stands in for an agent gathering its thoughts before the next step."],
    whyItMatters: ["Pauses like this are where a real agent call would happen in your own Flow."],
    expectedArtifacts: [],
    approxMs: 2200,
  },
  {
    id: "explain-code-node",
    title: "Let an agent explain it",
    qualifiedNodePath: "platform-tour.explain-code-node",
    whatHappens: ["An agent-style step reads the earlier note.", "It writes a short human explanation of what happened so far."],
    whyItMatters: ["Code can do reliable work; agents can add explanation, judgment, or synthesis."],
    postRunTakeaways: ["The tour now includes an agent-written style note.", "That note becomes another file later Nodes can point to."],
    expectedArtifacts: [{ label: "Agent note", relativePath: "agent-note.md", whyOpen: "A small example of agent output inside the run." }],
  },
  {
    id: "create-handoff-packet",
    title: "Pack up context",
    qualifiedNodePath: "platform-tour.context-handoff-demo.create-handoff-packet",
    whatHappens: ["Bagelwerk writes a fresh handoff packet for this run.", "Think of it as a little envelope of facts for the next step."],
    whyItMatters: ["Good handoffs beat hidden memory.", "A future step can read the envelope instead of guessing what happened."],
    postRunTakeaways: ["The run now has a fresh packet of context.", "This is the pattern for passing important facts forward."],
    expectedArtifacts: [{ label: "Handoff packet", relativePath: "handoff-packet.json", whyOpen: "The little envelope of facts for the next Node." }],
  },
  {
    id: "handoff-agent-thinking",
    title: "A short beat to think",
    qualifiedNodePath: "platform-tour.context-handoff-demo.handoff-agent-thinking",
    whatHappens: ["Another small pause before the next step opens the packet."],
    whyItMatters: ["This is the seam where a Flow you build would call an agent to interpret the handoff."],
    expectedArtifacts: [],
    approxMs: 2200,
  },
  {
    id: "read-handoff-packet",
    title: "Ask an agent to read the packet",
    qualifiedNodePath: "platform-tour.context-handoff-demo.read-handoff-packet",
    whatHappens: ["An agent-style step looks at the packet from the previous step.", "It turns the packed facts into a readable note."],
    whyItMatters: ["This is the payoff of the handoff: an agent gets clean context without guessing."],
    postRunTakeaways: ["The second step did not rely on vibes or memory.", "It read the packet and made it human-friendly."],
    expectedArtifacts: [{ label: "Readable handoff note", relativePath: "handoff-packet-readable.md", whyOpen: "The easiest way to see the handoff pattern." }],
  },
  {
    id: "draft-tour-graph",
    title: "Sketch the workflow in Mermaid",
    qualifiedNodePath: "platform-tour.draft-tour-graph",
    whatHappens: ["Bagelwerk writes the diagram source in Mermaid graph language."],
    whyItMatters: ["You should be able to see the shape of a workflow, not just trust terminal output."],
    postRunTakeaways: ["The workflow can describe itself as a diagram.", "That makes it easier to review, debug, and share."],
    expectedArtifacts: [{ label: "Diagram source", relativePath: "platform-tour-graph.mmd" }],
  },
  {
    id: "render-tour-graph",
    title: "Generate the SVG picture",
    qualifiedNodePath: "platform-tour.render-tour-graph",
    whatHappens: ["Bagelwerk turns the Mermaid source into an SVG picture."],
    whyItMatters: ["A picture helps a teammate understand the run without reading code first."],
    postRunTakeaways: ["You now have a shareable picture of the run.", "This is useful for explaining or reviewing a workflow with someone else."],
    expectedArtifacts: [
      { label: "Workflow picture", relativePath: "platform-tour-graph.svg", whyOpen: "Open this to see the tour as a diagram." },
      { label: "Diagram note", relativePath: "graph-tour.md" },
    ],
  },
  {
    id: "summary",
    title: "End with a useful summary",
    qualifiedNodePath: "platform-tour.summarize",
    whatHappens: ["The final Node writes a short summary of the run.", "It points you at the files worth opening first."],
    whyItMatters: ["A good workflow should leave a trail someone else can follow."],
    postRunTakeaways: [
      "You ran a tiny workflow that created notes, a handoff, a diagram, and a summary.",
      "That is Bagelwerk in one sentence: small jobs, clear handoffs, durable files.",
    ],
    expectedArtifacts: [{ label: "Tour summary", relativePath: "platform-tour.md", whyOpen: "Open this first after the run completes." }],
  },
];

export const platformTourFinalOpenTargets: PlatformTourFinalOpenTarget[] = [
  { priority: 1, qualifiedNodePath: "platform-tour.summarize", label: "Tour summary", relativePath: "platform-tour.md", whyOpen: "Open this first for the big picture." },
  {
    priority: 2,
    qualifiedNodePath: "platform-tour.context-handoff-demo.read-handoff-packet",
    label: "Readable handoff note",
    relativePath: "handoff-packet-readable.md",
    whyOpen: "This shows the handoff pattern in plain English.",
  },
  { priority: 3, qualifiedNodePath: "platform-tour.render-tour-graph", label: "Workflow picture", relativePath: "platform-tour-graph.svg", whyOpen: "This is the visual map of the tour." },
];
