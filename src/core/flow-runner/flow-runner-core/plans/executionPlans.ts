import { beginFlowRunnerFlowRun, defaultFlowRunnerArtifactRoot, persistFlowRunnerRunTree, type FlowRunnerRunTree, type FlowRunnerRunTreeNode } from "../../runRecords";
import type { FlowRunnerEvent } from "../../events";
import { emitFlowRunnerEvent } from "../events/eventSink";
import { resolveUnhandledFailureIfNeeded } from "../recovery/failureFallback";
import { runFlowRunnerMiddlewareHook } from "../middleware/middleware";
import { runFlowRunnerNode } from "../node-run/nodeRun";
import { acceptedTreeNodeForResume } from "../resume/resume";
import { nextResolvedNodePath, nodeTreeRecord } from "../traversal/runTree";
import type { FlowRunnerFlowRunResult, FlowRunnerNodeRunResult, RunResolvedFlowRunnerParams } from "../api/contracts";

export async function runResolvedFlowRunnerFlow<TInput>(params: RunResolvedFlowRunnerParams<TInput>): Promise<FlowRunnerFlowRunResult<TInput>> {
  const plan = params.executionPlan ?? { kind: "whole-flow" };
  const mode = plan.kind === "prefix" ? "prefix" : plan.kind === "lanes" ? "lanes" : "whole-flow";
  const artifactRoot = params.artifactRoot ?? defaultFlowRunnerArtifactRoot({ flowId: params.resolvedFlow.resolved.rootFlowId });
  const record = await beginFlowRunnerFlowRun({ artifactRoot, sessionId: params.sessionId, flowId: params.resolvedFlow.resolved.rootFlowId });
  const startedAt = new Date().toISOString();
  const events: FlowRunnerEvent[] = [];
  const forwardEvent = (event: FlowRunnerEvent) => emitFlowRunnerEvent({ events, event, onEvent: params.onEvent, log: params.log });
  forwardEvent({ type: "flow-start", flowId: params.resolvedFlow.resolved.rootFlowId, sessionId: params.sessionId, mode, runDir: record.runDir, at: startedAt });
  await runFlowRunnerMiddlewareHook(params.middlewares, "beforeFlow", {
    flowId: params.resolvedFlow.resolved.rootFlowId,
    sessionId: params.sessionId,
    mode,
    input: params.input,
    record,
    executionPlan: plan,
    emitEvent: params.onEvent,
  });
  const nodeRuns: FlowRunnerNodeRunResult<TInput>[] = [];
  const treeNodes: FlowRunnerRunTreeNode[] = [];
  const lanes: FlowRunnerRunTree["lanes"] = [];

  async function runAndRecord(qualifiedNodePath: string): Promise<FlowRunnerRunTreeNode> {
    if (params.resume === "accepted-only") {
      const resumed = await acceptedTreeNodeForResume({ artifactRoot, sessionId: params.sessionId, resolvedFlow: params.resolvedFlow, nodeRegistry: params.nodeRegistry, qualifiedNodePath });
      if (resumed) {
        treeNodes.push(resumed);
        forwardEvent({
          type: "node-skipped",
          flowId: params.resolvedFlow.resolved.rootFlowId,
          sessionId: params.sessionId,
          qualifiedNodePath: resumed.qualifiedNodePath,
          nodeId: resumed.nodeId,
          reason: "resume-accepted",
          acceptedDir: resumed.acceptedDir,
          at: new Date().toISOString(),
        });
        return resumed;
      }
    }

    const run = await runFlowRunnerNode({
      resolvedFlow: params.resolvedFlow,
      nodeRegistry: params.nodeRegistry,
      input: params.input,
      sessionId: params.sessionId,
      artifactRoot,
      qualifiedNodePath,
      acceptance: params.acceptance,
      resume: params.resume,
      onEvent: forwardEvent,
      middlewares: params.middlewares,
    });
    nodeRuns.push(run);
    const treeNode = nodeTreeRecord(run);
    treeNodes.push(treeNode);
    return treeNode;
  }

  async function runLinear(startNodePath: string, options: { stopAfter?: string; allowedNodePaths?: Set<string> } = {}): Promise<FlowRunnerRunTreeNode[]> {
    const localNodes: FlowRunnerRunTreeNode[] = [];
    let current: string | undefined = startNodePath;
    const visitsByNode = new Map<string, number>();
    let totalVisits = 0;
    while (current) {
      const nextVisit = (visitsByNode.get(current) ?? 0) + 1;
      if (nextVisit > 1 && !params.iteration?.allowCycles) throw new Error(`Flow Runner detected a cycle at '${current}'. Enable bounded iteration to allow repeated Node paths.`);
      totalVisits += 1;
      const maxNodeVisits = params.iteration?.maxNodeVisits ?? (params.iteration?.allowCycles ? 100 : undefined);
      const maxVisitsPerNode = params.iteration?.maxVisitsPerNode ?? (params.iteration?.allowCycles ? 25 : undefined);
      if (maxNodeVisits !== undefined && totalVisits > maxNodeVisits) throw new Error(`Flow Runner exceeded maxNodeVisits=${maxNodeVisits}.`);
      if (maxVisitsPerNode !== undefined && nextVisit > maxVisitsPerNode) throw new Error(`Flow Runner exceeded maxVisitsPerNode=${maxVisitsPerNode} for '${current}'.`);
      visitsByNode.set(current, nextVisit);
      if (nextVisit > 1) {
        forwardEvent({
          type: "iteration",
          flowId: params.resolvedFlow.resolved.rootFlowId,
          sessionId: params.sessionId,
          qualifiedNodePath: current,
          visit: nextVisit,
          ...(maxVisitsPerNode ? { maxVisits: maxVisitsPerNode } : {}),
          at: new Date().toISOString(),
        });
      }
      const priorRunCount = nodeRuns.length;
      const treeNode = await runAndRecord(current);
      const nodeRun = nodeRuns.length > priorRunCount ? nodeRuns[nodeRuns.length - 1] : undefined;
      localNodes.push(treeNode);
      if (current === options.stopAfter) break;
      await runFlowRunnerMiddlewareHook(params.middlewares, "beforeTransition", {
        flowId: params.resolvedFlow.resolved.rootFlowId,
        sessionId: params.sessionId,
        fromQualifiedNodePath: current,
        status: treeNode.status,
        input: params.input,
      });
      const next: string | undefined = await resolveUnhandledFailureIfNeeded({
        params,
        artifactRoot,
        current,
        treeNode,
        nodeRun,
        allowedNodePaths: options.allowedNodePaths,
        events,
        forwardEvent,
      });
      forwardEvent({ type: "transition", flowId: params.resolvedFlow.resolved.rootFlowId, sessionId: params.sessionId, fromQualifiedNodePath: current, ...(next ? { toQualifiedNodePath: next } : {}), status: treeNode.status, at: new Date().toISOString() });
      await runFlowRunnerMiddlewareHook(params.middlewares, "afterTransition", {
        flowId: params.resolvedFlow.resolved.rootFlowId,
        sessionId: params.sessionId,
        fromQualifiedNodePath: current,
        ...(next ? { toQualifiedNodePath: next } : {}),
        status: treeNode.status,
        input: params.input,
      });
      current = next;
    }
    return localNodes;
  }

  async function runLane(lane: { id: string; flowPath: string }): Promise<{ laneId: string; flowPath: string; nodes: FlowRunnerRunTreeNode[] }> {
    const boundary = params.resolvedFlow.resolved.flowsByPath[lane.flowPath];
    if (!boundary) throw new Error(`Unknown Flow Runner lane Flow '${lane.flowPath}'.`);
    forwardEvent({ type: "lane-start", flowId: params.resolvedFlow.resolved.rootFlowId, sessionId: params.sessionId, laneId: lane.id, flowPath: lane.flowPath, at: new Date().toISOString() });
    const nodes = await runLinear(boundary.initialNodePath, { allowedNodePaths: new Set(boundary.nodePaths) });
    const failed = nodes.find((node) => node.status !== "completed");
    forwardEvent({ type: "lane-complete", flowId: params.resolvedFlow.resolved.rootFlowId, sessionId: params.sessionId, laneId: lane.id, flowPath: lane.flowPath, status: failed?.status ?? "completed", at: new Date().toISOString() });
    return { laneId: lane.id, flowPath: lane.flowPath, nodes };
  }

  async function runLanesWithConcurrency(planLanes: Array<{ id: string; flowPath: string }>, concurrency: number | "unbounded"): Promise<Array<{ laneId: string; flowPath: string; nodes: FlowRunnerRunTreeNode[] }>> {
    if (concurrency === "unbounded") return Promise.all(planLanes.map((lane) => runLane(lane)));
    const normalized = Math.max(1, Math.floor(concurrency));
    if (normalized === 1) {
      const results: Array<{ laneId: string; flowPath: string; nodes: FlowRunnerRunTreeNode[] }> = [];
      for (const lane of planLanes) results.push(await runLane(lane));
      return results;
    }
    const results = new Array<{ laneId: string; flowPath: string; nodes: FlowRunnerRunTreeNode[] }>(planLanes.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(normalized, planLanes.length) }, async () => {
      while (nextIndex < planLanes.length) {
        const index = nextIndex++;
        results[index] = await runLane(planLanes[index]!);
      }
    }));
    return results;
  }

  if (mode === "whole-flow") {
    await runLinear(params.resolvedFlow.resolved.initialNodePath);
  } else if (plan.kind === "prefix") {
    await runLinear(params.resolvedFlow.resolved.initialNodePath, { stopAfter: plan.stopAfter });
  } else if (plan.kind === "lanes") {
    const prefixNodes = plan.prefix?.run === false
      ? []
      : await runLinear(params.resolvedFlow.resolved.initialNodePath, plan.prefix?.stopAfter ? { stopAfter: plan.prefix.stopAfter } : {});
    const prefixReady = plan.prefix?.run === false || !plan.prefix?.stopAfter || (prefixNodes[prefixNodes.length - 1]?.qualifiedNodePath === plan.prefix.stopAfter && prefixNodes[prefixNodes.length - 1]?.status === "completed");
    if (prefixReady) {
      const laneConcurrency = plan.laneConcurrency ?? 1;
      const laneResults = await runLanesWithConcurrency(plan.lanes, laneConcurrency);
      lanes.push({ ...(plan.prefix?.stopAfter ? { after: plan.prefix.stopAfter } : {}), ...(plan.join ? { join: plan.join } : {}), laneConcurrency, lanes: laneResults });
      if (plan.join && laneResults.every((lane) => lane.nodes.every((node) => node.status === "completed"))) {
        await runLinear(plan.join);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const failedNode = treeNodes.find((node) => node.status !== "completed");
  const runTree: FlowRunnerRunTree = {
    schemaVersion: 1,
    flowId: params.resolvedFlow.resolved.rootFlowId,
    sessionId: params.sessionId,
    mode,
    startedAt,
    finishedAt,
    status: failedNode?.status ?? "completed",
    nodes: treeNodes,
    lanes,
  };
  forwardEvent({ type: "flow-complete", flowId: params.resolvedFlow.resolved.rootFlowId, sessionId: params.sessionId, status: runTree.status, runDir: record.runDir, latestDir: record.latestDir, at: finishedAt });
  await runFlowRunnerMiddlewareHook(params.middlewares, "afterFlow", {
    flowId: params.resolvedFlow.resolved.rootFlowId,
    sessionId: params.sessionId,
    mode,
    input: params.input,
    record,
    executionPlan: plan,
    emitEvent: params.onEvent,
    runTree,
  });
  await persistFlowRunnerRunTree({ record, runTree, events });
  return { resolvedFlow: params.resolvedFlow, record, runTree, nodeRuns };
}
