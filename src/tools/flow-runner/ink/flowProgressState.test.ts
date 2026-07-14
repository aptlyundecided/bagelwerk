import assert from "node:assert/strict";
import test from "node:test";

import { createFlowProgressStore } from "./flowProgressStore";
import { createInitialFlowProgressSnapshot, initializeFlowProgressGraph, reduceFlowProgressEvent, type FlowProgressEvent } from "./flowProgressState";

const at = "2026-05-28T00:00:00.000Z";

test("Flow progress reducer projects flow, lane, node, artifact, and completion events", () => {
  const events: FlowProgressEvent[] = [
    { type: "flow-start", flowId: "demo", sessionId: "s1", mode: "lanes", runDir: ".artifacts/demo/s1", at },
    { type: "lane-start", flowId: "demo", sessionId: "s1", laneId: "review", flowPath: "demo.review", at },
    { type: "node-start", flowId: "demo.review", sessionId: "s1", qualifiedNodePath: "demo.review.scan", nodeId: "scan", label: "Scan", runDir: ".artifacts/demo/s1/nodes/scan", at },
    { type: "node-progress", flowId: "demo.review", sessionId: "s1", qualifiedNodePath: "demo.review.scan", nodeId: "scan", progress: { kind: "queue", total: 3, completed: 1, failed: 0, running: 1 }, at },
    { type: "artifact-observed", flowId: "demo.review", sessionId: "s1", qualifiedNodePath: "demo.review.scan", nodeId: "scan", label: "Report", relativePath: "report.md", canonicalPath: ".artifacts/demo/s1/nodes/scan/report.md", exists: true, at },
    { type: "accepted", flowId: "demo.review", sessionId: "s1", qualifiedNodePath: "demo.review.scan", nodeId: "scan", acceptedDir: ".artifacts/demo/s1/nodes/scan/accepted", at },
    { type: "node-complete", flowId: "demo.review", sessionId: "s1", qualifiedNodePath: "demo.review.scan", nodeId: "scan", status: "completed", runDir: ".artifacts/demo/s1/nodes/scan", latestDir: ".artifacts/demo/s1/nodes/scan/latest", acceptedDir: ".artifacts/demo/s1/nodes/scan/accepted", accepted: true, at },
    { type: "lane-complete", flowId: "demo", sessionId: "s1", laneId: "review", flowPath: "demo.review", status: "completed", at },
    { type: "flow-complete", flowId: "demo", sessionId: "s1", status: "completed", runDir: ".artifacts/demo/s1", latestDir: ".artifacts/demo/s1/latest", at },
  ];

  const state = events.reduce(reduceFlowProgressEvent, createInitialFlowProgressSnapshot({ title: "Demo" }));

  assert.equal(state.title, "Demo");
  assert.equal(state.flowId, "demo");
  assert.equal(state.sessionId, "s1");
  assert.equal(state.mode, "lanes");
  assert.equal(state.status, "completed");
  assert.deepEqual(state.laneOrder, ["review"]);
  assert.equal(state.lanes.review?.status, "completed");
  assert.deepEqual(state.nodeOrder, ["demo.review.scan"]);
  assert.equal(state.nodes["demo.review.scan"]?.status, "completed");
  assert.equal(state.nodes["demo.review.scan"]?.progress?.total, 3);
  assert.equal(state.artifacts[0]?.relativePath, "report.md");
  assert.equal(state.accepted["demo.review.scan"], ".artifacts/demo/s1/nodes/scan/accepted");
  assert.equal(state.eventCount, events.length);
  assert.equal(state.recent[0]?.type, "flow-complete");
});

test("Flow progress graph init seeds pending nodes and lanes before events arrive", () => {
  const state = initializeFlowProgressGraph(createInitialFlowProgressSnapshot(), {
    lanes: [{ laneId: "review", flowPath: "demo.review", nodePaths: ["demo.review.scan"] }],
    nodes: [
      { qualifiedNodePath: "demo.setup", nodeId: "setup", label: "Setup", flowPath: "demo", group: "prefix" },
      { qualifiedNodePath: "demo.review.scan", nodeId: "scan", label: "Scan", flowPath: "demo.review", group: "lane", laneId: "review" },
      { qualifiedNodePath: "demo.report", nodeId: "report", label: "Report", flowPath: "demo", group: "join" },
    ],
  });

  assert.deepEqual(state.nodeOrder, ["demo.setup", "demo.review.scan", "demo.report"]);
  assert.equal(state.nodes["demo.setup"]?.status, "pending");
  assert.equal(state.nodes["demo.review.scan"]?.label, "Scan");
  assert.equal(state.nodes["demo.review.scan"]?.group, "lane");
  assert.equal(state.nodes["demo.review.scan"]?.laneId, "review");
  assert.deepEqual(state.laneOrder, ["review"]);
  assert.equal(state.lanes.review?.status, "pending");
});

test("Flow progress store supports replay, unsubscribe, and close", () => {
  const store = createFlowProgressStore({ title: "Store demo" });
  const observed: Array<{ eventType: string | undefined; eventCount: number; closed: boolean }> = [];
  const unsubscribe = store.subscribe((snapshot, event) => {
    observed.push({ eventType: event?.type, eventCount: snapshot.state.eventCount, closed: snapshot.state.closed });
  }, { replay: true });

  store.append({ type: "flow-start", flowId: "demo", sessionId: "s1", mode: "whole-flow", runDir: ".artifacts/demo/s1", at });
  unsubscribe();
  store.append({ type: "flow-complete", flowId: "demo", sessionId: "s1", status: "completed", runDir: ".artifacts/demo/s1", latestDir: ".artifacts/demo/s1/latest", at });
  store.close();
  store.append({ type: "flow-start", flowId: "ignored", sessionId: "s2", mode: "whole-flow", runDir: ".artifacts/ignored/s2", at });

  assert.deepEqual(observed, [
    { eventType: undefined, eventCount: 0, closed: false },
    { eventType: "flow-start", eventCount: 1, closed: false },
  ]);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.state.status, "completed");
  assert.equal(snapshot.state.closed, true);
  assert.equal(snapshot.events.length, 2);
});
