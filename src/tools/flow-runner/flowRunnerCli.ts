#!/usr/bin/env tsx
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { config as loadDotEnv } from "dotenv";

import {
  createFlowRunnerConsoleProgressMiddleware,
  externalFlowRunSummary,
  externalNodeRunSummary,
  listExternalFlows,
  loadExternalFlowForRun,
  parseJsonInput,
  resolveFlowRunnerBinding,
  runExternalFlow,
  runExternalNode,
  type RunExternalFlowParams,
  type RunExternalFlowResult,
  type RunExternalNodeParams,
  type RunExternalNodeResult,
} from "../../core/flow-runner";
import { describeFlowProgressGraph, runFlowRunnerInk } from "./ink";

loadDotEnv({ quiet: true });

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

type FlowRunnerCliProgressMode = "console" | "ink" | "none";

function parseProgressMode(args: string[]): FlowRunnerCliProgressMode {
  const explicit = takeOption(args, "--progress");
  const noProgress = takeFlag(args, "--no-progress");
  if (noProgress) return "none";
  if (!explicit) return "console";
  if (explicit === "console" || explicit === "ink" || explicit === "none") return explicit;
  throw new Error(`Unknown --progress mode: ${explicit}. Expected console, ink, or none.`);
}

function consoleProgressMiddlewares(mode: FlowRunnerCliProgressMode) {
  return mode === "console" ? [createFlowRunnerConsoleProgressMiddleware({ log: console.error })] : [];
}

function printUsage(): void {
  console.error(`Usage:
  npm run flow:runner -- list [--cwd <path>] [--json]
  npm run flow:runner -- run-flow <flow-id> <session-id> [inputJson] [--cwd <path>] [--progress console|ink|none] [--auto-exit] [--resume]
  npm run flow:runner -- run-node <flow-id> <session-id> <qualified-node-path> [inputJson] [--cwd <path>] [--progress console|ink|none] [--auto-exit] [--resume]

This CLI loads external Flow workspaces from flow.config.json in --cwd or the current working directory.
Built-in Flow CLIs may use the same Flow Runner core through package-specific adapters/profiles.
Use --progress ink to render the generic Flow Runner Ink view. Use --no-progress or --progress none to suppress lifecycle progress output.
Use --resume to skip nodes whose accepted artifacts already exist (pick up where a previous run left off).`);
}

function renderFlowsTable(cwd: string, flows: Awaited<ReturnType<typeof listExternalFlows>>): string {
  if (flows.length === 0) {
    return `No external flows declared in flow.config.json under ${cwd}.\nAdd a flow.config.json (see src/core/built-ins/platform-tour/ for an example) or pass --cwd <dir>.`;
  }
  const idHeader = "FLOW ID (use with run-flow)";
  const labelHeader = "LABEL";
  const idWidth = Math.max(idHeader.length, ...flows.map((flow) => flow.id.length));
  const labelWidth = Math.max(labelHeader.length, ...flows.map((flow) => (flow.label ?? "").length));
  const pad = (value: string, width: number) => (value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`);
  const lines = [
    `Flows in ${cwd}:`,
    "",
    `  ${pad(idHeader, idWidth)}  ${pad(labelHeader, labelWidth)}  DESCRIPTION`,
    `  ${"-".repeat(idWidth)}  ${"-".repeat(labelWidth)}  -----------`,
    ...flows.map((flow) => `  ${pad(flow.id, idWidth)}  ${pad(flow.label ?? "", labelWidth)}  ${flow.description ?? ""}`.trimEnd()),
    "",
    `Run one with:  npm run flow:runner -- run-flow <flow-id> <session-id>${cwd === process.cwd() ? "" : ` --cwd ${cwd}`}`,
  ];
  return lines.join("\n");
}

function printFailureFooter(args: {
  flowId: string;
  sessionId: string;
  cwd: string;
  result: Awaited<ReturnType<typeof runExternalFlow>>;
}): void {
  const { run } = args.result;
  const failed = run.runTree.nodes.filter((node) => node.status !== "completed");
  const harnessNode = run.runTree.nodes.find((node) => /harness/i.test(node.qualifiedNodePath));
  const cwdSuffix = args.cwd === process.cwd() ? "" : ` --cwd ${args.cwd}`;
  const lines = [
    "",
    `✖ Flow failed: ${args.flowId}  (session: ${args.sessionId}, status: ${run.runTree.status})`,
    "",
    "Failed node(s):",
    ...(failed.length
      ? failed.map((node) => `  ✕ ${node.qualifiedNodePath} — ${node.status}${node.note ? `: ${node.note}` : ""}\n      look: ${node.latestDir}`)
      : ["  (no specific node reported)"]),
    "",
    `Session artifacts: ${run.record.runDir}`,
    ...(harnessNode ? [`Harness status:    ${harnessNode.latestDir}${harnessNode.latestDir.endsWith("/") ? "" : "/"}harness-status.json`] : []),
    "",
    "Re-run:",
    `  npm run flow:runner -- run-flow ${args.flowId} ${args.sessionId}${cwdSuffix}`,
  ];
  console.error(lines.join("\n"));
}

/** A terminal-backed interaction provider for human-in-the-loop Nodes (one readline per prompt). */
function makeReadlineInteraction(): { ask: (args: { prompt: string }) => Promise<{ answer: string }> } {
  return {
    ask: async ({ prompt }: { prompt: string }) => {
      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(`${prompt}\n> `);
        return { answer };
      } finally {
        rl.close();
      }
    },
  };
}

async function pickFlowId(cwd: string): Promise<string> {
  const flows = await listExternalFlows(cwd);
  if (flows.length === 0) {
    throw new Error("No external flows are declared in flow.config.json.");
  }
  flows.forEach((flow, index) => {
    console.log(`${index + 1}. ${flow.label} (${flow.id})${flow.description ? ` — ${flow.description}` : ""}`);
  });
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Select flow number or id > ");
    const selectedIndex = Number.parseInt(answer, 10);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= flows.length) {
      return flows[selectedIndex - 1]!.id;
    }
    if (flows.some((flow) => flow.id === answer || flow.localId === answer)) return answer;
    throw new Error(`Unknown flow selection: ${answer}`);
  } finally {
    rl.close();
  }
}

export type FlowRunnerCliDeps = {
  runExternalFlow?: (params: RunExternalFlowParams<Record<string, unknown>>) => Promise<RunExternalFlowResult<Record<string, unknown>>>;
  runExternalNode?: (params: RunExternalNodeParams<Record<string, unknown>>) => Promise<RunExternalNodeResult<Record<string, unknown>>>;
  writeOutput?: (line: string) => void;
};

export async function runFlowRunnerCli(rawArgs = process.argv.slice(2), deps: FlowRunnerCliDeps = {}): Promise<void> {
  const args = [...rawArgs];
  const runFlow = deps.runExternalFlow ?? runExternalFlow;
  const runNode = deps.runExternalNode ?? runExternalNode;
  const writeOutput = deps.writeOutput ?? ((line: string) => console.log(line));
  const cwd = takeOption(args, "--cwd") ?? process.cwd();
  const autoExit = takeFlag(args, "--auto-exit");
  const noInteractive = takeFlag(args, "--no-interactive");
  const resume = takeFlag(args, "--resume");
  const progressMode = parseProgressMode(args);
  const command = args.shift() ?? "pick";

  if (command === "-h" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "list") {
    const asJson = takeFlag(args, "--json");
    const flows = await listExternalFlows(cwd);
    if (asJson) {
      writeOutput(JSON.stringify({ cwd, flows }, null, 2));
    } else {
      writeOutput(renderFlowsTable(cwd, flows));
    }
    return;
  }

  if (command === "pick") {
    const flowId = await pickFlowId(cwd);
    writeOutput(`Selected: ${flowId}`);
    return;
  }

  if (command === "run-flow") {
    const [flowId, sessionIdArg, inputJson] = args;
    if (!flowId) {
      printUsage();
      process.exitCode = 2;
      return;
    }
    // Session id is optional: default to a timestamped id so a no-arg `npm run` works and each run
    // gets its own artifact directory.
    const sessionId = sessionIdArg ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const parsedInput = parseJsonInput(inputJson);
    // Provide an interactive human gate (e.g. meal-plan review) when attached to a real terminal,
    // so human-in-the-loop Nodes can prompt. Headless runs leave it absent (Nodes auto-handle).
    const runInput = input.isTTY && !noInteractive ? { ...parsedInput, interaction: makeReadlineInteraction() } : parsedInput;
    const graph = progressMode === "ink" ? await describeExternalFlowInkGraph({ cwd, flowId }) : undefined;
    const result = progressMode === "ink"
      ? (await runFlowRunnerInk({
          metadata: { title: `Flow Runner: ${flowId}`, flowId, sessionId, executionPlan: { kind: "whole-flow" } },
          ...(graph ? { graph } : {}),
          autoExit,
          run: ({ onEvent }) => runFlow({ cwd, flowId, sessionId, input: runInput, onEvent, ...(resume ? { resume: "accepted-only" } : {}) }),
        })).result
      : await runFlow({ cwd, flowId, sessionId, input: runInput, middlewares: consoleProgressMiddlewares(progressMode), ...(resume ? { resume: "accepted-only" } : {}) });
    writeOutput(JSON.stringify(externalFlowRunSummary(result), null, 2));
    if (result.run.runTree.status !== "completed") {
      printFailureFooter({ flowId, sessionId, cwd, result });
      process.exitCode = 1;
    }
    return;
  }

  if (command === "run-node") {
    const [flowId, sessionId, qualifiedNodePath, inputJson] = args;
    if (!flowId || !sessionId || !qualifiedNodePath) {
      printUsage();
      process.exitCode = 2;
      return;
    }
    const parsedInput = parseJsonInput(inputJson);
    const graph = progressMode === "ink" ? await describeExternalFlowInkGraph({ cwd, flowId }) : undefined;
    const result = progressMode === "ink"
      ? (await runFlowRunnerInk({
          metadata: { title: `Flow Runner Node: ${qualifiedNodePath}`, flowId, sessionId },
          ...(graph ? { graph } : {}),
          autoExit,
          run: ({ onEvent }) => runNode({ cwd, flowId, sessionId, qualifiedNodePath, input: parsedInput, onEvent, ...(resume ? { resume: "accepted-only" } : {}) }),
        })).result
      : await runNode({ cwd, flowId, sessionId, qualifiedNodePath, input: parsedInput, middlewares: consoleProgressMiddlewares(progressMode), ...(resume ? { resume: "accepted-only" } : {}) });
    writeOutput(JSON.stringify(externalNodeRunSummary(result), null, 2));
    return;
  }

  printUsage();
  throw new Error(`Unknown command: ${command}`);
}

async function describeExternalFlowInkGraph(args: { cwd: string; flowId: string }) {
  const { binding } = await loadExternalFlowForRun({ cwd: args.cwd, flowId: args.flowId });
  const resolvedFlow = resolveFlowRunnerBinding({
    flow: binding.flow,
    configuredNodes: binding.configuredNodes,
    nodeRegistry: binding.nodeRegistry,
  });
  return describeFlowProgressGraph({ resolvedFlow, executionPlan: { kind: "whole-flow" } });
}

if (require.main === module) {
  runFlowRunnerCli().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
