#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import path from "node:path";
import { config as loadDotEnv } from "dotenv";

import {
  PLATFORM_TOUR_FLOW_RUNNER_ARTIFACT_ROOT,
  createPlatformTourNodeRegistry,
  platformTourConfiguredNodes,
  platformTourFlow,
  platformTourNodeRegistry,
  sampleTourRunAgent,
  type PlatformTourInput,
} from "../../core/built-ins/platform-tour";
import {
  flowRunnerAcceptedDir,
  flowRunnerEventLine,
  runFlowRunnerFlow,
  type FlowRunnerEvent,
} from "../../core/flow-runner";
import { runPlatformTourPresenter, type PresenterStepView } from "./platform-tour/platformTourPresenter";

loadDotEnv({ quiet: true });

type PlatformTourCliArgs = {
  sessionId?: string;
  operatorName?: string;
  artifactRoot?: string;
  present?: boolean;
  auto?: boolean;
  json?: boolean;
  quiet?: boolean;
  live?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): PlatformTourCliArgs {
  const parsed: PlatformTourCliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--session" || arg === "--session-id") parsed.sessionId = argv[++index];
    else if (arg === "--operator" || arg === "--operator-name") parsed.operatorName = argv[++index];
    else if (arg === "--artifact-root") parsed.artifactRoot = argv[++index];
    else if (arg === "--present" || arg === "--demo") parsed.present = true;
    else if (arg === "--auto") parsed.auto = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--quiet" || arg === "--no-progress") parsed.quiet = true;
    else if (arg === "--live" || arg === "--model") parsed.live = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  npm run flow:tour                      # autonomous run (real agent-backed Nodes)",
    "  npm run flow:tour -- --present         # interactive demo: press Enter to run each step (no model)",
    "  npm run flow:tour -- --present --auto   # narrated playthrough (no input; CI-safe; no model)",
    "  npm run flow:tour -- --present --live   # interactive demo, but call a real agent per step",
    "  npm run flow:tour -- --operator \"Alex\" --session tour-demo",
    "",
    "Runs the Bagelwerk platform tour: it creates files, hands context forward through a",
    "nested sub-flow, draws a Mermaid graph of itself (SVG), and writes a summary.",
    "",
    "Options:",
    "  --present, --demo      Step-by-step demo (Ink TUI in a terminal): Enter runs each step,",
    "                         a = auto-run the rest, q = quit, o = open the SVG at the end.",
    "                         The narrated playthrough is model-free by default (deterministic",
    "                         sample notes) so it costs no model quota and is CI-safe.",
    "  --auto                 Non-interactive narrated playthrough (used with --present or alone)",
    "  --live, --model        With --present: call a real agent on the agent-backed steps",
    "                         (spends model quota). Without --present this is the default.",
    "  --operator <name>      Greeting name used in the intro",
    "  --session <id>         Session id; defaults to tour-<date>",
    "  --artifact-root <dir>  Artifact root; defaults to .artifacts/platform-tour",
    "  --json                 Print runtime progress events as JSON lines (autonomous run)",
    "  --quiet                Suppress runtime progress lines (autonomous run)",
    "",
    "Note: the graph step renders SVG via the Mermaid CLI; install it if that step fails.",
  ].join("\n"));
}

function emitProgress(args: PlatformTourCliArgs, event: FlowRunnerEvent): void {
  if (args.quiet) return;
  console.error(args.json ? JSON.stringify(event) : flowRunnerEventLine(event));
}

function openFileDetached(filePath: string): void {
  const opener = process.platform === "win32"
    ? { command: "cmd", args: ["/c", "start", "", filePath] }
    : process.platform === "darwin"
      ? { command: "open", args: [filePath] }
      : { command: "xdg-open", args: [filePath] };
  try {
    const child = spawn(opener.command, opener.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort; opening a file is non-essential.
  }
}

// Plain-text narrated playthrough for --auto / non-TTY (no Ink raw-mode needed).
function printPresenterStep(step: PresenterStepView): void {
  if (step.phase === "running" && step.beat) {
    console.error("");
    console.error(`▶ Step ${step.index + 1}/${step.total} — ${step.beat.title}`);
    for (const line of step.beat.whatHappens) console.error(`    • ${line}`);
  } else if (step.phase === "after" && step.beat) {
    const ok = step.lastResult?.status === "completed";
    console.error(`  ${ok ? "✓" : "✕"} ${step.beat.title}${ok ? "" : ` (${step.lastResult?.status})`}`);
    for (const artifact of step.lastResult?.artifacts ?? []) {
      console.error(`    ${artifact.exists ? "✓" : "!"} ${artifact.label} — ${artifact.relativePath}`);
    }
  } else if (step.phase === "done") {
    console.error("");
    console.error("Tour complete — small jobs, clear handoffs, durable files.");
  }
}

async function runInteractivePresenter(args: PlatformTourCliArgs, sessionId: string, artifactRoot: string, input: PlatformTourInput): Promise<void> {
  // The narrated `--present` playthrough is model-free by default: it wires the deterministic
  // `sampleTourRunAgent` so the GETTING-STARTED "fresh clone → run a real Flow, no model cost"
  // first step spends no model quota and is CI-safe. `--live` opts back into the real pi CLI.
  // The SVG step still uses the real Mermaid CLI (mmdc) in both modes.
  const nodeRegistry = args.live
    ? createPlatformTourNodeRegistry()
    : createPlatformTourNodeRegistry({ runAgent: sampleTourRunAgent });

  // The Ink TUI needs a real terminal (raw-mode keyboard input). Without a TTY (CI / piped),
  // fall back to a narrated console playthrough. `--auto` inside the TUI just auto-advances.
  if (!process.stdin.isTTY) {
    const result = await runPlatformTourPresenter({ sessionId, artifactRoot, input, auto: true, present: printPresenterStep, nodeRegistry });
    console.log(JSON.stringify({ status: result.status, sessionId, artifactRoot, ranNodes: result.ranNodePaths.length, summaryPath: result.summaryPath, svgPath: result.svgPath }, null, 2));
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }

  const { createPlatformTourPresenterInk } = await import("./platform-tour/runPlatformTourPresenterInk");
  const ink = await createPlatformTourPresenterInk({
    metadata: { sessionId, artifactRoot, title: "Bagelwerk Platform Tour" },
    openFile: openFileDetached,
  });
  try {
    const result = await runPlatformTourPresenter({
      sessionId,
      artifactRoot,
      input,
      auto: args.auto === true,
      present: ink.present,
      waitForAction: ink.waitForAction,
      nodeRegistry,
    });
    ink.finish(result.status, result.svgPath);
    await ink.waitUntilExit();
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    ink.unmount();
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const sessionId = args.sessionId?.trim() || `tour-${new Date().toISOString().slice(0, 10)}`;
  const artifactRoot = args.artifactRoot ?? PLATFORM_TOUR_FLOW_RUNNER_ARTIFACT_ROOT;
  const input: PlatformTourInput = args.operatorName ? { operatorName: args.operatorName } : {};

  if (args.present || args.auto) {
    await runInteractivePresenter(args, sessionId, artifactRoot, input);
    return;
  }

  const run = await runFlowRunnerFlow<PlatformTourInput>({
    artifactRoot,
    sessionId,
    flow: platformTourFlow,
    configuredNodes: [...platformTourConfiguredNodes],
    nodeRegistry: platformTourNodeRegistry,
    input,
    executionPlan: { kind: "whole-flow" },
    acceptance: { mode: "auto", acceptedByKind: "user", acceptedById: process.env.USERNAME ?? process.env.USER ?? "operator" },
    onEvent: (event) => emitProgress(args, event),
  });

  console.log(JSON.stringify({
    status: run.runTree.status,
    sessionId: run.record.sessionId,
    artifactRoot,
    nodes: run.runTree.nodes.length,
    summaryPath: run.runTree.status === "completed"
      ? path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.summarize"), "platform-tour.md")
      : undefined,
    svgPath: run.runTree.status === "completed"
      ? path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.render-tour-graph"), "platform-tour-graph.svg")
      : undefined,
  }, null, 2));

  if (run.runTree.status !== "completed") process.exitCode = 1;
  else console.error("\nTip: run `npm run flow:tour -- --present` for the step-by-step interactive demo.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
