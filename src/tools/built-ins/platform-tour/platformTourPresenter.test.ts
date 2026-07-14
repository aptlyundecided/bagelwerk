import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPlatformTourNodeRegistry, sampleTourRunAgent } from "../../../core/built-ins/platform-tour";
import { flowRunnerAcceptedDir } from "../../../core/flow-runner";
import type { RenderMermaidSvgInput, RenderMermaidSvgResult } from "../../../core/graph-visualization";
import { runPlatformTourPresenter, type PresenterStepView } from "./platformTourPresenter";
import { platformTourPresentationBeats } from "./presentationPlan";

const fakeRender = async (input: RenderMermaidSvgInput): Promise<RenderMermaidSvgResult> => {
  const mermaidPath = path.join(input.outputDirectory, `${input.baseName}.mmd`);
  const svgPath = path.join(input.outputDirectory, `${input.baseName}.svg`);
  await writeFile(mermaidPath, input.mermaidSource, "utf8");
  await writeFile(svgPath, "<svg><text>tour</text></svg>", "utf8");
  return { ok: true, mermaidPath, svgPath, command: "fake-mmdc", args: [], stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
};

// Deterministic, offline agent stand-in so tests never spawn the real pi CLI.
const fakeAgent = async () => ({ rawText: "A friendly test explanation of the step.", provider: "test", model: "stub" });

const testRegistry = () => createPlatformTourNodeRegistry({ renderMermaidSvg: fakeRender, runAgent: fakeAgent });

test("presenter runs every beat in order and gates on each step", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "tour-presenter-"));
  const steps: PresenterStepView[] = [];
  let gateCalls = 0;
  try {
    const result = await runPlatformTourPresenter({
      sessionId: "present-test",
      artifactRoot,
      input: { operatorName: "tester" },
      nodeRegistry: testRegistry(),
      timerDelayMsOverride: 1,
      present: (step) => steps.push(step),
      waitForAction: async () => {
        gateCalls += 1;
        return "advance";
      },
    });

    // Ran all beats, in flow order.
    assert.deepEqual(result.ranNodePaths, platformTourPresentationBeats.map((beat) => beat.qualifiedNodePath));
    assert.equal(result.status, "completed");
    // One gate per beat now (run-on-arrival, single Enter after the result).
    assert.equal(gateCalls, platformTourPresentationBeats.length);

    // The produced SVG exists at the reported path.
    assert.ok(result.svgPath);
    assert.match(await readFile(result.svgPath!, "utf8"), /<svg/);

    // Narration surfaced through present(): the intro beat's "what happens" text was shown.
    const introRunning = steps.find((step) => step.phase === "running" && step.beat?.id === "welcome");
    assert.ok(introRunning?.beat?.whatHappens.some((line) => /welcome note/i.test(line)));
    // The handoff beat reported a produced artifact that exists.
    const handoffAfter = steps.find((step) => step.phase === "after" && step.beat?.id === "create-handoff-packet");
    assert.ok(handoffAfter?.lastResult?.artifacts.some((artifact) => artifact.relativePath === "handoff-packet.json" && artifact.exists));
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("presenter auto mode runs without gating", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "tour-presenter-auto-"));
  let gateCalls = 0;
  try {
    const result = await runPlatformTourPresenter({
      sessionId: "present-auto",
      artifactRoot,
      auto: true,
      nodeRegistry: testRegistry(),
      timerDelayMsOverride: 1,
      waitForAction: async () => {
        gateCalls += 1;
        return "advance";
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(gateCalls, 0);
    assert.equal(result.ranNodePaths.length, platformTourPresentationBeats.length);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

// The CLI's `--present` narrated playthrough is model-free by default: it wires the
// deterministic sampleTourRunAgent (no pi CLI, no model quota) — this is the GETTING-STARTED
// "fresh clone → run a real Flow, no model cost" first step. Lock that the dry-run registry
// completes end-to-end and labels the agent note as a dry-run sample.
test("presenter dry-run (sampleTourRunAgent) completes with no live model and labels the note dry-run", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "tour-presenter-dryrun-"));
  try {
    const dryRunRegistry = createPlatformTourNodeRegistry({ renderMermaidSvg: fakeRender, runAgent: sampleTourRunAgent });
    const result = await runPlatformTourPresenter({
      sessionId: "present-dryrun",
      artifactRoot,
      auto: true,
      nodeRegistry: dryRunRegistry,
      timerDelayMsOverride: 1,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.ranNodePaths.length, platformTourPresentationBeats.length);
    // The agent-note beat wrote a note that is honestly labelled as a dry-run sample (no model).
    const notePath = path.join(flowRunnerAcceptedDir(artifactRoot, "present-dryrun", "platform-tour.explain-code-node"), "agent-note.md");
    const note = await readFile(notePath, "utf8");
    assert.match(note, /dry-run\/sample/);
    assert.match(note, /no live model was called/i);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
