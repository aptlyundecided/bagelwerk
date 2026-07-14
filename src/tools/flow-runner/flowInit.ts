import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Scaffolds a runnable, chained starter Flow from the generic primitive Nodes — the
// first-class "build your own Flow" on-ramp (OI-0097 T-006). The generated Flow is
// deterministic (no agent/network) so it runs on first try; its README shows how to
// swap in an agent step. CLI wrapper lives in flowInitCli.ts.

const FLOW_NAME_RE = /^[a-z][a-z0-9-]*$/;

export type ScaffoldFlowResult = { targetDir: string; flowId: string; files: string[]; runCommand: string };

function flowConfigJson(name: string): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    flows: [{ id: "starter", module: "./starterFlow.ts", label: `${name} starter`, description: "A two-Node starter Flow: write a data file, then read it back (artifact chaining)." }],
  }, null, 2)}\n`;
}

function starterFlowTs(name: string, date: string): string {
  return `import { createStaticNodeRegistry } from "../../src/core/nodes/config";
import { coreReadJsonNodeTypeEntry, coreWriteJsonNodeTypeEntry } from "../../src/core/nodes/generic";

// Starter Flow for "${name}". Two Nodes wired together by an accepted artifact:
//   seed (core.write-json) ──seed.json──▶ echo (core.read-json, fromArtifact: "seed.json")
// Run it:  npm run flow:runner -- run-flow ${name}:starter demo --cwd flow-library/${name}
// Next:    swap "echo" for a core.agent-markdown Node (see README) to have an agent
//          summarise seed.json — the accepted artifact is folded into the prompt automatically.

export default {
  label: "${name} starter flow",
  workspaceName: "${name}",
  flow: {
    flowId: "starter",
    name: "${name} starter",
    createdAt: "${date}",
    updatedAt: "${date}",
    initial: "seed",
    nodes: {
      seed: { nodeId: "starter.seed" },
      echo: { nodeId: "starter.echo", acceptedArtifacts: [{ from: "seed", relativePath: "seed.json" }] },
    },
    edges: [{ from: "seed", to: "echo", on: "completed" }],
  },
  configuredNodes: [
    {
      nodeId: "starter.seed",
      nodeType: "core.write-json",
      name: "seed",
      description: "Write a starter data file.",
      createdAt: "${date}",
      updatedAt: "${date}",
      params: { value: { project: "${name}", items: ["alpha", "beta", "gamma"] }, artifactPath: "seed.json" },
    },
    {
      nodeId: "starter.echo",
      nodeType: "core.read-json",
      name: "echo",
      description: "Read the upstream artifact (chaining demo).",
      createdAt: "${date}",
      updatedAt: "${date}",
      params: { fromArtifact: "seed.json", artifactPath: "echo.json" },
    },
  ],
  nodeRegistry: createStaticNodeRegistry([coreWriteJsonNodeTypeEntry, coreReadJsonNodeTypeEntry]),
};
`;
}

function readmeMd(name: string): string {
  return `# ${name} (starter Flow)

A minimal, runnable Flow scaffolded from the generic primitive Nodes. It shows the core
idea: small Nodes that leave files behind, wired together by **accepted artifacts**.

\`\`\`
seed (core.write-json) ──seed.json──▶ echo (core.read-json, fromArtifact: "seed.json")
\`\`\`

## Run it

\`\`\`
npm run flow:runner -- run-flow ${name}:starter demo --cwd flow-library/${name}
\`\`\`

It runs with no agent or network. Artifacts land under \`flow-library/${name}/.artifacts/...\`.

## Make it your own

- **Add an agent step.** Replace the \`echo\` Node with \`core.agent-markdown\`:
  - change its \`nodeType\` to \`"core.agent-markdown"\` and \`params\` to \`{ prompt: "Summarise the project data.", artifactPath: "summary.md" }\`,
  - add \`coreAgentMarkdownNodeTypeEntry\` to the \`nodeRegistry\`.
  Because \`seed.json\` is in the Node's \`acceptedArtifacts\`, it is folded into the agent prompt automatically.
- **Fan in from multiple Nodes.** A Node's \`acceptedArtifacts\` can reference *any* earlier Node, not just the previous one — list several and the agent Node receives all of them.
- **Other primitives:** \`core.read-text\`, \`core.write-text\`, \`core.run-command\`, \`core.agent-json\` — see \`src/core/nodes/generic/\` for the full set and their params.
`;
}

export async function scaffoldFlow(args: { name: string; parentDir?: string; force?: boolean; date?: string }): Promise<ScaffoldFlowResult> {
  if (!FLOW_NAME_RE.test(args.name)) {
    throw new Error(`Invalid flow name '${args.name}'. Use lowercase letters, digits and dashes (must start with a letter), e.g. "my-first-flow".`);
  }
  const parentDir = args.parentDir ?? "flow-library";
  const targetDir = path.resolve(parentDir, args.name);
  try {
    const existing = await readdir(targetDir);
    if (existing.length > 0 && !args.force) {
      throw new Error(`Target directory already exists and is not empty: ${targetDir}. Pass --force to scaffold anyway.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(targetDir, { recursive: true });
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  const files: Array<{ name: string; content: string }> = [
    { name: "flow.config.json", content: flowConfigJson(args.name) },
    { name: "starterFlow.ts", content: starterFlowTs(args.name, date) },
    { name: "README.md", content: readmeMd(args.name) },
  ];
  for (const file of files) {
    await writeFile(path.join(targetDir, file.name), file.content, "utf8");
  }
  return {
    targetDir,
    flowId: `${args.name}:starter`,
    files: files.map((file) => file.name),
    runCommand: `npm run flow:runner -- run-flow ${args.name}:starter demo --cwd ${path.join(parentDir, args.name)}`,
  };
}
