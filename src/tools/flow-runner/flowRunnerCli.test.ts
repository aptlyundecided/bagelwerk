import assert from "node:assert/strict";
import test from "node:test";

import type { RunExternalFlowParams, RunExternalFlowResult, RunExternalNodeParams, RunExternalNodeResult } from "../../core/flow-runner";
import { runFlowRunnerCli } from "./flowRunnerCli";

function completedFlowResult(): RunExternalFlowResult<Record<string, unknown>> {
  return {
    catalogEntry: { id: "flow", localId: "flow", aliases: [], label: "Flow", workspaceName: "workspace", source: "cwd" },
    run: {
      resolvedFlow: {},
      record: { sessionId: "session", flowId: "flow", runDir: "/tmp/run", latestDir: "/tmp/latest", runTreePath: "/tmp/tree.json", eventsPath: "/tmp/events.ndjson" },
      runTree: {
        schemaVersion: 1,
        flowId: "flow",
        sessionId: "session",
        mode: "whole-flow",
        startedAt: "2026-07-17T00:00:00.000Z",
        finishedAt: "2026-07-17T00:00:00.000Z",
        status: "completed",
        nodes: [],
        lanes: [],
      },
      nodeRuns: [],
    },
  } as RunExternalFlowResult<Record<string, unknown>>;
}

function completedNodeResult(): RunExternalNodeResult<Record<string, unknown>> {
  return {
    catalogEntry: { id: "flow", localId: "flow", aliases: [], label: "Flow", workspaceName: "workspace", source: "cwd" },
    run: {
      resolvedFlow: {},
      record: {
        sessionId: "session",
        flowId: "flow",
        qualifiedNodePath: "root.node",
        runDir: "/tmp/run",
        latestDir: "/tmp/latest",
        acceptedDir: "/tmp/accepted",
        launchSnapshotPath: "/tmp/launch.json",
        artifactEventsPath: "/tmp/artifacts.json",
        artifactExistencePath: "/tmp/existence.json",
        eventsPath: "/tmp/events.ndjson",
        resultPath: "/tmp/result.json",
      },
      launchSnapshot: {},
      preflight: { ok: true, dependencies: [], missing: [] },
      runResult: { finalNode: "root.node", working: { input: {}, outputsByNodeId: {} } },
      artifactEvents: [],
      artifactExistence: [],
      accepted: false,
      events: [],
    },
  } as RunExternalNodeResult<Record<string, unknown>>;
}

test("flow-runner CLI forwards --resume to run-flow and run-node", async () => {
  let flowParams: RunExternalFlowParams<Record<string, unknown>> | undefined;
  let nodeParams: RunExternalNodeParams<Record<string, unknown>> | undefined;

  await runFlowRunnerCli(
    ["run-flow", "flow", "session", "--cwd", "/tmp/workspace", "--progress", "none", "--resume"],
    {
      runExternalFlow: async (params) => {
        flowParams = params;
        return completedFlowResult();
      },
      writeOutput: () => {},
    },
  );

  await runFlowRunnerCli(
    ["run-node", "flow", "session", "root.node", "--cwd", "/tmp/workspace", "--progress", "none", "--resume"],
    {
      runExternalNode: async (params) => {
        nodeParams = params;
        return completedNodeResult();
      },
      writeOutput: () => {},
    },
  );

  assert.equal(flowParams?.resume, "accepted-only");
  assert.equal(nodeParams?.resume, "accepted-only");
});
