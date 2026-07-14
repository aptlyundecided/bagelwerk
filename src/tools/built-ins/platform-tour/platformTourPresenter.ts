import { stat } from "node:fs/promises";
import path from "node:path";

import {
  PLATFORM_TOUR_FLOW_RUNNER_ARTIFACT_ROOT,
  platformTourConfiguredNodes,
  platformTourFlow,
  platformTourNodeRegistry,
  type PlatformTourInput,
} from "../../../core/built-ins/platform-tour";
import { flowRunnerAcceptedDir, runFlowRunnerNode, type FlowRunnerEventSink } from "../../../core/flow-runner";
import { platformTourFinalOpenTargets, platformTourPresentationBeats, type PlatformTourBeat } from "./presentationPlan";

export type PresenterAction = "advance" | "auto" | "quit";

export type PresenterArtifactView = {
  label: string;
  relativePath: string;
  exists: boolean;
  path: string;
  whyOpen?: string;
};

export type PresenterBeatResult = {
  status: string;
  note?: string;
  artifacts: PresenterArtifactView[];
};

export type PresenterStepView = {
  phase: "running" | "after" | "done";
  index: number;
  total: number;
  beat?: PlatformTourBeat;
  beatStatuses: Array<{ id: string; title: string; qualifiedNodePath: string; status: "pending" | "running" | "completed" | "failed" }>;
  lastResult?: PresenterBeatResult;
  finalTargets?: Array<{ label: string; path: string; whyOpen?: string }>;
  /** When a timer Node is running, its expected duration so the TUI can count down. */
  runningMs?: number;
};

export type RunSingleNodeResult = { status: string; note?: string };

export type PlatformTourPresenterOptions = {
  sessionId: string;
  artifactRoot?: string;
  input?: PlatformTourInput;
  auto?: boolean;
  /** Pushes the current visual state; non-blocking. Defaults to a no-op (headless). */
  present?: (step: PresenterStepView) => void;
  /** Awaited at each gate; resolve with the user's action. Defaults to immediate "advance". */
  waitForAction?: (step: PresenterStepView) => Promise<PresenterAction>;
  /** Runs (and accepts) a single node by qualified path. Defaults to the real Flow Runner. */
  runNode?: (qualifiedNodePath: string) => Promise<RunSingleNodeResult>;
  nodeRegistry?: typeof platformTourNodeRegistry;
  /** Override the core.timer pauses (tests pass 1 for speed). */
  timerDelayMsOverride?: number;
  acceptedById?: string;
  onEvent?: FlowRunnerEventSink;
};

export type PlatformTourPresenterResult = {
  status: "completed" | "failed" | "quit";
  ranNodePaths: string[];
  svgPath?: string;
  summaryPath?: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function buildConfiguredNodes(timerDelayMsOverride?: number) {
  if (timerDelayMsOverride === undefined) return [...platformTourConfiguredNodes];
  return platformTourConfiguredNodes.map((node) =>
    node.nodeType === "core.timer" ? { ...node, params: { ...node.params, delayMs: timerDelayMsOverride } } : { ...node },
  );
}

export async function runPlatformTourPresenter(options: PlatformTourPresenterOptions): Promise<PlatformTourPresenterResult> {
  const beats = platformTourPresentationBeats;
  const total = beats.length;
  const artifactRoot = options.artifactRoot ?? PLATFORM_TOUR_FLOW_RUNNER_ARTIFACT_ROOT;
  const sessionId = options.sessionId;
  const present = options.present ?? (() => {});
  const waitForAction = options.waitForAction ?? (async () => "advance" as const);
  const nodeRegistry = options.nodeRegistry ?? platformTourNodeRegistry;
  const configuredNodes = buildConfiguredNodes(options.timerDelayMsOverride);
  const acceptedById = options.acceptedById ?? process.env.USERNAME ?? process.env.USER ?? "operator";

  const defaultRunNode = async (qualifiedNodePath: string): Promise<RunSingleNodeResult> => {
    const run = await runFlowRunnerNode<PlatformTourInput>({
      artifactRoot,
      sessionId,
      flow: platformTourFlow,
      configuredNodes,
      nodeRegistry,
      qualifiedNodePath,
      input: options.input ?? {},
      acceptance: { mode: "auto", acceptedByKind: "user", acceptedById },
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    const out = run.runResult?.working.outputsByNodeId[run.launchSnapshot.nodeId];
    return { status: out?.status ?? "unknown", note: out?.note };
  };
  const runNode = options.runNode ?? defaultRunNode;

  const statuses = beats.map((beat) => ({ id: beat.id, title: beat.title, qualifiedNodePath: beat.qualifiedNodePath, status: "pending" as PresenterStepView["beatStatuses"][number]["status"] }));
  const ranNodePaths: string[] = [];
  let auto = options.auto ?? false;

  const view = (phase: PresenterStepView["phase"], index: number, lastResult?: PresenterBeatResult): PresenterStepView => {
    const beat = beats[index];
    return {
      phase,
      index,
      total,
      beat,
      beatStatuses: statuses.map((entry) => ({ ...entry })),
      ...(lastResult ? { lastResult } : {}),
      ...(phase === "running" && beat?.approxMs ? { runningMs: beat.approxMs } : {}),
    };
  };

  // One gate per step: each step runs on arrival (the TUI shows the live timer), then the user
  // presses Enter once — after seeing the result — to advance. Halves the keypresses.
  for (let index = 0; index < total; index += 1) {
    const beat = beats[index]!;

    statuses[index]!.status = "running";
    present(view("running", index));
    const run = await runNode(beat.qualifiedNodePath);
    ranNodePaths.push(beat.qualifiedNodePath);

    const acceptedDir = flowRunnerAcceptedDir(artifactRoot, sessionId, beat.qualifiedNodePath);
    const artifacts: PresenterArtifactView[] = await Promise.all(
      beat.expectedArtifacts.map(async (artifact) => {
        const filePath = path.join(acceptedDir, artifact.relativePath);
        return { label: artifact.label, relativePath: artifact.relativePath, path: filePath, exists: await fileExists(filePath), ...(artifact.whyOpen ? { whyOpen: artifact.whyOpen } : {}) };
      }),
    );
    const completed = run.status === "completed";
    statuses[index]!.status = completed ? "completed" : "failed";
    const result: PresenterBeatResult = { status: run.status, ...(run.note ? { note: run.note } : {}), artifacts };
    present(view("after", index, result));

    if (!completed) return { status: "failed", ranNodePaths };

    if (!auto) {
      const action = await waitForAction(view("after", index, result));
      if (action === "quit") return { status: "quit", ranNodePaths };
      if (action === "auto") auto = true;
    }
  }

  const finalTargets = platformTourFinalOpenTargets
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((target) => ({ label: target.label, path: path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, target.qualifiedNodePath), target.relativePath), ...(target.whyOpen ? { whyOpen: target.whyOpen } : {}) }));
  present({ phase: "done", index: total - 1, total, beatStatuses: statuses.map((entry) => ({ ...entry })), finalTargets });

  const svgTarget = platformTourFinalOpenTargets.find((target) => target.relativePath.endsWith(".svg"));
  const summaryTarget = platformTourFinalOpenTargets.find((target) => target.priority === 1);
  return {
    status: "completed",
    ranNodePaths,
    ...(svgTarget ? { svgPath: path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, svgTarget.qualifiedNodePath), svgTarget.relativePath) } : {}),
    ...(summaryTarget ? { summaryPath: path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, summaryTarget.qualifiedNodePath), summaryTarget.relativePath) } : {}),
  };
}
