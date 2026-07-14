import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { flowRunnerAcceptedDir, runFlowRunnerFlow } from "../../flow-runner";
import type { RenderMermaidSvgInput, RenderMermaidSvgResult } from "../../graph-visualization";
import { platformTourFlow } from "./platformTourFlow";
import { createPlatformTourNodeRegistry, platformTourConfiguredNodes } from "./nodes";

// Keep the test fast: the live tour uses multi-second "visible pause" timers; tests don't need them.
const fastConfiguredNodes = platformTourConfiguredNodes.map((node) =>
  node.nodeType === "core.timer" ? { ...node, params: { ...node.params, delayMs: 1 } } : node,
);

const fakeRender = async (input: RenderMermaidSvgInput): Promise<RenderMermaidSvgResult> => {
  const mermaidPath = path.join(input.outputDirectory, `${input.baseName}.mmd`);
  const svgPath = path.join(input.outputDirectory, `${input.baseName}.svg`);
  await writeFile(mermaidPath, input.mermaidSource, "utf8");
  await writeFile(svgPath, "<svg><text>platform tour</text></svg>", "utf8");
  return { ok: true, mermaidPath, svgPath, command: "fake-mmdc", args: [], stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
};

// Deterministic, offline agent stand-in so the flow test never spawns the real pi CLI.
const fakeAgent = async () => ({ rawText: "A friendly test explanation.", provider: "test", model: "stub" });

test("sampleTourRunAgent is offline, deterministic, and labelled dry-run (no model cost)", async () => {
  const { sampleTourRunAgent } = await import("./nodes/shared");
  // explain-code node id → generic dry-run note
  const explain = await sampleTourRunAgent({
    prompt: "ignored",
    cwd: ".",
    runDir: ".",
    nodeId: "platform-tour.explain-code-node",
    sessionId: "s",
  });
  assert.equal(explain.provider, "dry-run");
  assert.equal(explain.model, "sample");
  assert.match(explain.rawText, /no live model was called/i);

  // read-handoff node id → packet-aware dry-run note
  const handoff = await sampleTourRunAgent({
    prompt: "ignored",
    cwd: ".",
    runDir: ".",
    nodeId: "platform-tour.read-handoff-packet",
    sessionId: "s",
  });
  assert.equal(handoff.provider, "dry-run");
  assert.match(handoff.rawText, /handoff packet/i);

  // Deterministic: same node id → identical output across calls.
  const again = await sampleTourRunAgent({
    prompt: "ignored",
    cwd: ".",
    runDir: ".",
    nodeId: "platform-tour.explain-code-node",
    sessionId: "s",
  });
  assert.deepEqual(again, explain);
});

test("platform-tour flow starts at intro and wraps the handoff sub-flow", () => {
  assert.equal(platformTourFlow.initial, "intro");
  assert.ok(platformTourFlow.flows["context-handoff-demo"]);
  assert.deepEqual(platformTourFlow.nodes["draft-tour-graph"].acceptedArtifacts, [
    { from: "platform-tour.context-handoff-demo.read-handoff-packet", relativePath: "handoff-packet-readable.md" },
  ]);
});

test("platform-tour runs end to end through the nested handoff and SVG (fake renderer)", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "platform-tour-"));
  const sessionId = "tour-smoke";
  try {
    const run = await runFlowRunnerFlow({
      artifactRoot,
      sessionId,
      flow: platformTourFlow,
      configuredNodes: fastConfiguredNodes,
      nodeRegistry: createPlatformTourNodeRegistry({ renderMermaidSvg: fakeRender, runAgent: fakeAgent }),
      input: { operatorName: "test" },
      executionPlan: { kind: "whole-flow" },
      acceptance: { mode: "auto", acceptedByKind: "agent", acceptedById: "test" },
    });

    if (run.runTree.status !== "completed") {
      console.error(run.runTree.nodes.map((node) => ({ path: node.qualifiedNodePath, status: node.status, note: node.note })));
    }
    assert.equal(run.runTree.status, "completed");

    const summary = await readFile(path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.summarize"), "platform-tour.md"), "utf8");
    assert.match(summary, /Platform tour complete/);

    const handoff = await readFile(
      path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.context-handoff-demo.create-handoff-packet"), "handoff-packet.json"),
      "utf8",
    );
    assert.match(handoff, /handoffId/);

    const readable = await readFile(
      path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.context-handoff-demo.read-handoff-packet"), "handoff-packet-readable.md"),
      "utf8",
    );
    assert.match(readable, /Agent-style handoff note/);

    const svg = await readFile(path.join(flowRunnerAcceptedDir(artifactRoot, sessionId, "platform-tour.render-tour-graph"), "platform-tour-graph.svg"), "utf8");
    assert.match(svg, /<svg/);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
