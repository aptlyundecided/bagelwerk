import path from "node:path";

import { requireNodeTypeEntry } from "../../../nodes/config";
import type { NodeGraphRunResult, NodeResult, NodeRunnerWorkingContext } from "../../../nodes/graph";
import { createNodeRunner } from "../../../nodes/runner";
import type { FlowRunnerEvent } from "../../events";
import {
  acceptFlowRunnerNodeRun,
  beginFlowRunnerNodeRun,
  copyFlowRunnerArtifactToSurface,
  defaultFlowRunnerArtifactRoot,
  flowRunnerFileExists,
  persistFlowRunnerNodeSidecars,
  type FlowRunnerArtifactEvent,
  type FlowRunnerArtifactExistenceVerdict,
  type FlowRunnerLaunchSnapshot,
} from "../../runRecords";
import { createFlowRunnerNodeExecutionInput, type FlowRunnerNodeExecutionInput } from "../../runtimeContext";
import { resolveFlowRunnerBinding } from "../resolution/resolveFlowRunnerBinding";
import type { FlowRunnerNodeRunResult, RunFlowRunnerNodeParams } from "../api/contracts";
import { emitFlowRunnerEvent } from "../events/eventSink";
import { runFlowRunnerMiddlewareHook, type FlowRunnerNodeMiddlewareContext } from "../middleware/middleware";
import { resolveExecutionPolicyOverlay } from "../policy/executionPolicy";
import { buildPreflightDependencies } from "../preflight/preflight";
import { createSyntheticRunResult, isFlowRunnerNodeResult } from "../results/resultValidation";

export async function runFlowRunnerNode<TInput>(params: RunFlowRunnerNodeParams<TInput>): Promise<FlowRunnerNodeRunResult<TInput>> {
  const executionPolicyOverlay = resolveExecutionPolicyOverlay(params);
  const resolvedFlow = params.resolvedFlow ?? resolveFlowRunnerBinding<TInput>({
    flow: params.flow,
    configuredNodes: params.configuredNodes,
    nodeRegistry: params.nodeRegistry,
    ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}),
  });
  const artifactRoot = params.artifactRoot ?? defaultFlowRunnerArtifactRoot({ flowId: resolvedFlow.resolved.rootFlowId });
  const target = resolvedFlow.resolved.nodesByPath[params.qualifiedNodePath];
  if (!target) throw new Error(`Unknown Flow Runner Node path: ${params.qualifiedNodePath}`);
  const entry = requireNodeTypeEntry(params.nodeRegistry, target.node.nodeType);
  const parsedParams = entry.validateParams(target.node.params);
  const expectedArtifacts = entry.describeArtifacts?.({ nodeId: target.node.nodeId, params: parsedParams })?.outputs ?? [];
  const dependencies = await buildPreflightDependencies({ artifactRoot, sessionId: params.sessionId, resolvedFlow, qualifiedNodePath: params.qualifiedNodePath });
  const missing = dependencies.filter((dependency) => dependency.required && !dependency.exists);
  const record = await beginFlowRunnerNodeRun({ artifactRoot, sessionId: params.sessionId, qualifiedNodePath: params.qualifiedNodePath, flowId: target.flowId });
  const launchSnapshot: FlowRunnerLaunchSnapshot = {
    flowId: target.flowId,
    qualifiedNodePath: target.qualifiedPath,
    nodeId: target.node.nodeId,
    nodeType: target.node.nodeType,
    nodeName: target.node.name,
    nodeDescription: target.node.description,
    flowPath: target.flowPath,
    params: target.node.params,
    ...(target.node.status ? { nodeStatus: target.node.status } : {}),
    ...(target.executionPolicy ? { executionPolicy: target.executionPolicy } : {}),
    ...(target.executionPolicySources ? { executionPolicySources: target.executionPolicySources } : {}),
    acceptedUpstreamArtifacts: dependencies.filter((dependency) => dependency.exists).map((dependency) => ({
      fromQualifiedPath: dependency.fromQualifiedPath,
      relativePath: dependency.relativePath,
      ...(dependency.label ? { label: dependency.label } : {}),
      required: dependency.required,
      acceptedPath: dependency.acceptedPath,
      ...(dependency.resolvedFromQualifiedPath ? { resolvedFromQualifiedPath: dependency.resolvedFromQualifiedPath } : {}),
      ...(dependency.aliasResolved ? { aliasResolved: true } : {}),
    })),
    expectedArtifacts: expectedArtifacts.map((artifact) => ({
      key: artifact.key,
      label: artifact.label,
      relativePath: artifact.relativePath,
      required: artifact.required !== false,
      ...(artifact.kind ? { kind: artifact.kind } : {}),
    })),
    launchedAt: new Date().toISOString(),
  };
  const events: FlowRunnerEvent[] = [];
  emitFlowRunnerEvent({
    events,
    onEvent: params.onEvent,
    log: params.log,
    event: {
      type: "node-start",
      flowId: target.flowId,
      sessionId: params.sessionId,
      qualifiedNodePath: target.qualifiedPath,
      nodeId: target.node.nodeId,
      label: target.node.name,
      runDir: record.runDir,
      at: launchSnapshot.launchedAt,
    },
  });

  const runtimeInput = createFlowRunnerNodeExecutionInput({
    userInput: params.input,
    runtime: {
      workspaceRoot: artifactRoot,
      sessionId: params.sessionId,
      record,
      launchSnapshot,
      preflight: { dependencies },
      emitEvent: (event) => emitFlowRunnerEvent({ events, onEvent: params.onEvent, log: params.log, event }),
      forwardChildEvent: (source, event) => emitFlowRunnerEvent({
        events,
        onEvent: params.onEvent,
        log: params.log,
        event: { type: "child-event", flowId: target.flowId, sessionId: params.sessionId, source, event, at: new Date().toISOString() },
      }),
    },
  });

  const middlewareContext: FlowRunnerNodeMiddlewareContext<TInput> = {
    flowId: target.flowId,
    sessionId: params.sessionId,
    qualifiedNodePath: target.qualifiedPath,
    nodeId: target.node.nodeId,
    nodeName: target.node.name,
    input: params.input,
    record,
    launchSnapshot,
    runtime: runtimeInput.runtime,
    emitEvent: params.onEvent,
  };
  await runFlowRunnerMiddlewareHook(params.middlewares, "beforeNode", middlewareContext);

  let runResult: NodeGraphRunResult<FlowRunnerNodeExecutionInput<TInput>>;
  if (missing.length > 0) {
    runResult = createSyntheticRunResult({
      input: runtimeInput,
      nodeId: target.node.nodeId,
      launchedAt: launchSnapshot.launchedAt,
      nodeResult: {
        status: "failed",
        note: `Missing required accepted artifact(s): ${missing.map((item) => `${item.fromQualifiedPath}/${item.relativePath}`).join(", ")}`,
      },
    });
  } else {
    runResult = await executeNode({ params, target, entry, parsedParams, runtimeInput, middlewareContext });
  }

  const artifactEvents = await observeNodeArtifacts({
    entry,
    parsedParams,
    runResult,
    target,
    record,
    events,
    onEvent: params.onEvent,
    log: params.log,
  });
  const artifactExistence = artifactExistenceFromExpected(expectedArtifacts, artifactEvents);

  const nodeResult = runResult.working.outputsByNodeId[target.node.nodeId];
  const shouldAccept = (params.acceptance?.mode ?? "auto") === "auto" && nodeResult?.status === "completed";
  if (shouldAccept) {
    await acceptFlowRunnerNodeRun({
      artifactRoot,
      sessionId: params.sessionId,
      record,
      nodeId: target.node.nodeId,
      emittedArtifacts: artifactEvents.filter((artifact) => artifact.exists).map((artifact) => ({ canonicalPath: artifact.canonicalPath, relativePath: artifact.relativePath })),
      acceptance: {
        acceptedAt: new Date().toISOString(),
        acceptedByKind: params.acceptance?.acceptedByKind ?? "agent",
        acceptedById: params.acceptance?.acceptedById ?? "flow-runner",
        note: "Accepted by Flow Runner.",
        runDir: record.runDir,
      },
    });
    emitFlowRunnerEvent({
      events,
      onEvent: params.onEvent,
      log: params.log,
      event: { type: "accepted", flowId: target.flowId, sessionId: params.sessionId, qualifiedNodePath: target.qualifiedPath, nodeId: target.node.nodeId, acceptedDir: record.acceptedDir, at: new Date().toISOString() },
    });
  }

  await runFlowRunnerMiddlewareHook(params.middlewares, "afterNode", {
    ...middlewareContext,
    result: nodeResult,
    artifactEvents,
    accepted: shouldAccept,
  });

  emitFlowRunnerEvent({
    events,
    onEvent: params.onEvent,
    log: params.log,
    event: {
      type: "node-complete",
      flowId: target.flowId,
      sessionId: params.sessionId,
      qualifiedNodePath: target.qualifiedPath,
      nodeId: target.node.nodeId,
      status: nodeResult?.status ?? "unknown",
      ...(nodeResult?.note ? { note: nodeResult.note } : {}),
      runDir: record.runDir,
      latestDir: record.latestDir,
      acceptedDir: record.acceptedDir,
      accepted: shouldAccept,
      at: new Date().toISOString(),
    },
  });

  await persistFlowRunnerNodeSidecars({ record, launchSnapshot, artifactEvents, artifactExistence, events, result: runResult });

  return { resolvedFlow, record, launchSnapshot, preflight: { ok: missing.length === 0, dependencies, missing }, runResult, artifactEvents, artifactExistence, accepted: shouldAccept, events };
}

async function executeNode<TInput>(args: {
  params: RunFlowRunnerNodeParams<TInput>;
  target: any;
  entry: { execute: Function };
  parsedParams: unknown;
  runtimeInput: FlowRunnerNodeExecutionInput<TInput>;
  middlewareContext: FlowRunnerNodeMiddlewareContext<TInput>;
}): Promise<NodeGraphRunResult<FlowRunnerNodeExecutionInput<TInput>>> {
  const { params, target, entry, parsedParams, runtimeInput, middlewareContext } = args;
  const runner = createNodeRunner({ ...(params.log ? { log: params.log } : {}), emitNodeLines: false });
  const startedAt = new Date().toISOString();
  let nodeResult: NodeResult<unknown>;
  try {
    const rawResult: unknown = await runner.run({ nodeId: target.node.nodeId, label: target.node.name }, () => entry.execute({
      nodeId: target.node.nodeId,
      instanceId: target.qualifiedPath,
      params: parsedParams,
      working: { input: runtimeInput, outputsByNodeId: {}, attemptsByNodeId: {}, lastNodeId: undefined } as Readonly<NodeRunnerWorkingContext<FlowRunnerNodeExecutionInput<TInput>>>,
      ...(target.executionPolicy ? { executionPolicy: target.executionPolicy } : {}),
    }));
    if (!isFlowRunnerNodeResult(rawResult)) throw new Error(`Node ${target.qualifiedPath} returned malformed NodeResult.`);
    nodeResult = rawResult;
  } catch (error) {
    const replacements = await runFlowRunnerMiddlewareHook(params.middlewares, "onNodeCrash", { ...middlewareContext, error });
    const replacement = replacements.find((item): item is NodeResult<unknown> => Boolean(item));
    nodeResult = replacement ?? { status: "failed", note: error instanceof Error ? error.message : String(error) };
  }
  return {
    finalNodeId: target.node.nodeId,
    working: {
      input: runtimeInput,
      outputsByNodeId: { [target.node.nodeId]: nodeResult },
      attemptsByNodeId: { [target.node.nodeId]: 1 },
      lastNodeId: target.node.nodeId,
    },
    history: [{ nodeId: target.node.nodeId, nodeStatus: nodeResult.status, attemptCount: 1, ...(nodeResult.note ? { note: nodeResult.note } : {}), startedAt, finishedAt: new Date().toISOString() }],
  };
}

async function observeNodeArtifacts<TInput>(args: {
  entry: { collectArtifacts?: Function };
  parsedParams: unknown;
  runResult: NodeGraphRunResult<FlowRunnerNodeExecutionInput<TInput>>;
  target: any;
  record: { runDir: string; latestDir: string };
  events: FlowRunnerEvent[];
  onEvent?: (event: FlowRunnerEvent) => void;
  log?: (line: string) => void;
}): Promise<FlowRunnerArtifactEvent[]> {
  const payload = args.runResult.working.outputsByNodeId[args.target.node.nodeId]?.payload;
  const emitted = args.entry.collectArtifacts?.({ nodeId: args.target.node.nodeId, params: args.parsedParams, payload }) ?? [];
  const artifactEvents: FlowRunnerArtifactEvent[] = [];
  for (const artifact of emitted) {
    const relativePath = artifact.relativePath ?? artifact.key ?? path.basename(artifact.path);
    const exists = await flowRunnerFileExists(artifact.path);
    const artifactEvent: FlowRunnerArtifactEvent = {
      key: artifact.key,
      label: artifact.label,
      canonicalPath: artifact.path,
      relativePath,
      exists,
      observedAt: new Date().toISOString(),
    };
    artifactEvents.push(artifactEvent);
    emitFlowRunnerEvent({
      events: args.events,
      onEvent: args.onEvent,
      log: args.log,
      event: {
        type: "artifact-observed",
        flowId: args.target.flowId,
        sessionId: args.runResult.working.input.runtime.sessionId,
        qualifiedNodePath: args.target.qualifiedPath,
        nodeId: args.target.node.nodeId,
        ...(artifactEvent.key ? { key: artifactEvent.key } : {}),
        label: artifactEvent.label,
        relativePath: artifactEvent.relativePath,
        canonicalPath: artifactEvent.canonicalPath,
        exists: artifactEvent.exists,
        at: artifactEvent.observedAt,
      },
    });
    if (exists) {
      await copyFlowRunnerArtifactToSurface(artifact.path, args.record.runDir, relativePath);
      await copyFlowRunnerArtifactToSurface(artifact.path, args.record.latestDir, relativePath);
    }
  }
  return artifactEvents;
}

export function artifactExistenceFromExpected(expectedArtifacts: Array<{ key: string; label: string; relativePath: string; required?: boolean }>, artifactEvents: FlowRunnerArtifactEvent[]): FlowRunnerArtifactExistenceVerdict[] {
  return expectedArtifacts.map((artifact) => {
    const found = artifactEvents.find((event) => event.key === artifact.key || event.relativePath === artifact.relativePath);
    return {
      key: artifact.key,
      label: artifact.label,
      relativePath: artifact.relativePath,
      required: artifact.required !== false,
      ...(found?.canonicalPath ? { canonicalPath: found.canonicalPath } : {}),
      exists: Boolean(found?.exists),
    };
  });
}
