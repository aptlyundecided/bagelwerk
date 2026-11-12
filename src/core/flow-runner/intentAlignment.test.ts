import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStaticNodeRegistry } from "../nodes/config";
import { coreHumanAckNodeTypeEntry } from "../nodes/generic";
import { runFlowRunnerFlow, runFlowRunnerNode, type FlowRunnerEvent } from ".";

const base = { createdAt: "2026-11-12", updatedAt: "2026-11-12" };
function binding(execute: any) {
  return {
    flow: { ...base, flowId: "intent", name: "intent", initial: "work", nodes: { work: { nodeId: "work" } }, edges: [] },
    configuredNodes: [{ ...base, nodeId: "work", nodeType: "fixture", name: "work", description: "fixture", params: {} }],
    nodeRegistry: createStaticNodeRegistry([{ nodeType: "fixture", validateParams: value => value, execute }]),
  };
}

test("recovery keeps original output in persisted records while allowing continuation", async t => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "intent-recovery-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  const events: FlowRunnerEvent[] = [];
  const result = await runFlowRunnerFlow({ ...binding(async () => ({ status: "failed", note: "source unavailable", payload: { available: ["A", "B"] } })), artifactRoot, sessionId: "recover", input: {}, onEvent: event => events.push(event),
    unhandledFailureResolver: async () => ({ disposition: "recovered", replacementResult: { status: "completed", note: "two sources accepted", payload: { available: ["A", "B"] } }, note: "Comparison can proceed with two sources" }),
  });
  assert.equal(result.runTree.status, "completed");
  const persisted = JSON.parse(await readFile(result.nodeRuns[0].record.resultPath, "utf8"));
  assert.deepEqual(persisted.history[0].originalResult, { status: "failed", note: "source unavailable", payload: { available: ["A", "B"] } });
  assert.equal(persisted.history[0].recovery.disposition, "recovered");
  assert.equal(persisted.history[0].recovery.rationale, "Comparison can proceed with two sources");
  assert.equal(persisted.working.outputsByNodeId.work.status, "completed");
  assert.ok(events.some(event => event.type === "unhandled-failure-resolution-complete" && event.disposition === "recovered"));
  assert.ok(!events.some(event => event.type === "execution-state" && event.state === "ended_unresolved"));
});

test("a configured failure transition continues and leaves evidence of unresolved work", async t => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "intent-partial-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  const setup = binding(async ({ nodeId }: any) => ({ status: nodeId === "work" ? "failed" : "completed", note: nodeId, payload: { output: nodeId } }));
  const events: FlowRunnerEvent[] = [];
  const result = await runFlowRunnerFlow({ ...setup, flow: { ...setup.flow, nodes: { ...setup.flow.nodes, finish: { nodeId: "finish" } }, edges: [{ from: "work", to: "finish", on: "failed" }] }, configuredNodes: [...setup.configuredNodes, { ...setup.configuredNodes[0], nodeId: "finish" }], artifactRoot, sessionId: "partial", input: {}, onEvent: event => events.push(event) });
  assert.equal(result.runTree.nodes.length, 2);
  assert.equal(result.runTree.nodes[1].status, "completed");
  assert.equal(result.runTree.status, "failed");
  assert.ok(events.some(event => event.type === "execution-state" && event.state === "continuing_partial" && event.nextAction.includes("intent.finish")));
  const persisted = JSON.parse(await readFile(result.record.eventsPath, "utf8"));
  assert.ok(persisted.events.some((event: any) => event.state === "ended_unresolved" && event.scope === "flow"));
});

test("missing input blocks handler execution and records how to unblock it", async t => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "intent-blocked-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  let called = false;
  const setup = binding(async () => { called = true; return { status: "completed" }; });
  const result = await runFlowRunnerNode({ ...setup, flow: { ...setup.flow, nodes: { source: { nodeId: "source" }, work: { nodeId: "work", acceptedArtifacts: [{ from: "source", relativePath: "missing.json" }] } } }, configuredNodes: [...setup.configuredNodes, { ...setup.configuredNodes[0], nodeId: "source" }], qualifiedNodePath: "intent.work", artifactRoot, sessionId: "blocked", input: {} });
  assert.equal(called, false);
  assert.equal(result.preflight.ok, false);
  const persisted = JSON.parse(await readFile(result.record.eventsPath, "utf8"));
  const blocked = persisted.events.find((event: any) => event.state === "start_blocked");
  assert.ok(blocked.reason.includes("missing.json"));
  assert.ok(blocked.nextAction.includes("retry"));
  assert.equal(blocked.scope, "node");
});

test("human input wait is visible before response and is retained after completion", async t => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "intent-wait-"));
  t.after(() => rm(artifactRoot, { recursive: true, force: true }));
  let release!: (value: { answer: string }) => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const answer = new Promise<{ answer: string }>(resolve => { release = resolve; });
  const events: FlowRunnerEvent[] = [];
  const run = runFlowRunnerFlow({
    flow: { ...base, flowId: "wait", name: "wait", initial: "ack", nodes: { ack: { nodeId: "ack" } }, edges: [] },
    configuredNodes: [{ ...base, nodeId: "ack", nodeType: "core.human-ack", name: "ack", description: "ack", params: { title: "Review", message: "Review result", prompt: "Approve it?", notifyOnWait: false } }],
    nodeRegistry: createStaticNodeRegistry([coreHumanAckNodeTypeEntry]), artifactRoot, sessionId: "wait", input: { interaction: { ask: async () => { entered(); return answer; } } }, onEvent: event => events.push(event),
  });
  try {
    await Promise.race([waiting, run.then(() => { throw new Error("Run ended without waiting"); })]);
    const event = events.find(event => event.type === "execution-state" && event.state === "waiting_for_input");
    assert.ok(event && event.type === "execution-state");
    assert.match(event.reason, /Approve it/);
    assert.match(event.nextAction, /acknowledgement/);
  } finally { release({ answer: "approved" }); }
  const result = await run;
  assert.equal(result.runTree.status, "completed");
  const persisted = JSON.parse(await readFile(result.nodeRuns[0].record.eventsPath, "utf8"));
  assert.ok(persisted.events.some((event: any) => event.state === "waiting_for_input"));
});


for (const initialStatus of ["failed", "completed"] as const) {
  test(`graph revisit after ${initialStatus} only reports retry when the previous result was unsuccessful`, async t => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "intent-revisit-"));
    t.after(() => rm(artifactRoot, { recursive: true, force: true }));
    let attempts = 0;
    const setup = binding(async () => ({ status: ++attempts === 1 ? initialStatus : "completed" }));
    const events: FlowRunnerEvent[] = [];
    // A success loop reaches its explicit visit limit; a failure loop recovers on the second visit.
    const run = runFlowRunnerFlow({ ...setup, flow: { ...setup.flow, edges: [{ from: "work", to: "work", on: initialStatus }] }, artifactRoot, sessionId: "revisit", input: {}, iteration: { allowCycles: true, maxVisitsPerNode: 2 }, onEvent: event => events.push(event) });
    if (initialStatus === "completed") await assert.rejects(run, /maxVisitsPerNode/);
    else assert.equal((await run).runTree.nodes.at(-1)?.status, "completed");
    assert.equal(events.filter(event => event.type === "execution-state" && event.state === "retry_in_progress").length, initialStatus === "failed" ? 1 : 0);
  });
}
