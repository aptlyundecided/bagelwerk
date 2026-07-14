import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { NodeFailureResolver, NodeGraphRunResult } from "../nodes/graph";
import { createNodeRunner } from "../nodes/runner";
import type { NodeRegistry } from "../nodes/config";
import { requireNodeTypeEntry } from "../nodes/config";
import {
  compileConfiguredFlowSpec,
  createFlowEnterEventsForNode,
  createFlowExitEventsForNode,
  createFlowTransitionEvents,
  createStaticFlowNodeLibrary,
  formatFlowRuntimeEvent,
  resolveFlowNodePath,
  runConfiguredFlowNode,
  parseExecutionPolicyRunOverlay,
  type ExecutionPolicyRunOverlay,
  type ParallelFlowGroup,
  type CompiledConfiguredFlowSpec,
  type FlowRuntimeEvent,
} from "../flows/config";
import {
  acceptWorkbenchRun,
  beginWorkbenchRun,
  copyCanonicalArtifactToSurface,
  fileExists,
  type FlowWorkbenchAcceptanceRecord,
  type FlowWorkbenchArtifactEvent,
  type FlowWorkbenchArtifactExistenceVerdict,
  type FlowWorkbenchLaunchSnapshot,
  type FlowWorkbenchRunRecord,
  persistWorkbenchSidecars,
  workbenchAcceptedDir,
} from "./runRecords";

export type FlowWorkbenchNodeExecutionInput<TUserInput> = {
  userInput: TUserInput;
  workbench: {
    workspaceRoot: string;
    sessionId: string;
    record: FlowWorkbenchRunRecord;
    launchSnapshot: FlowWorkbenchLaunchSnapshot;
    preflight: {
      dependencies: FlowWorkbenchPreflightDependency[];
    };
  };
};

export type FlowWorkbenchRunParams<TInput> = {
  workspaceRoot: string;
  sessionId: string;
  flow: unknown;
  configuredNodes: unknown[];
  nodeRegistry: NodeRegistry;
  qualifiedNodePath: string;
  input: TInput;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
  /** Optional runtime-line sink. Omit to preserve the historical console output. */
  log?: (line: string) => void;
  /** Optional post-failure resolver hook for advanced/debug Workbench runs. */
  failureResolver?: NodeFailureResolver<FlowWorkbenchNodeExecutionInput<TInput>>;
};

export type FlowWorkbenchPreflightDependency = {
  fromQualifiedPath: string;
  relativePath: string;
  label?: string;
  required: boolean;
  acceptedPath: string;
  exists: boolean;
  /** Present when a stable producer nodeId provided a backwards-compatible accepted-artifact location. */
  resolvedFromQualifiedPath?: string;
  aliasResolved?: boolean;
};

export type FlowWorkbenchRunResult<TInput> = {
  compiled: CompiledConfiguredFlowSpec<FlowWorkbenchNodeExecutionInput<TInput>>;
  record: FlowWorkbenchRunRecord;
  launchSnapshot: FlowWorkbenchLaunchSnapshot;
  preflight: {
    ok: boolean;
    dependencies: FlowWorkbenchPreflightDependency[];
    missing: FlowWorkbenchPreflightDependency[];
  };
  runResult?: NodeGraphRunResult<FlowWorkbenchNodeExecutionInput<TInput>>;
  artifactEvents?: FlowWorkbenchArtifactEvent[];
  artifactExistence?: FlowWorkbenchArtifactExistenceVerdict[];
  flowEvents?: FlowRuntimeEvent[];
};

export type FlowWorkbenchRunTreeNode = {
  qualifiedNodePath: string;
  nodeId: string;
  status: "completed" | "failed" | "timed_out" | "unknown";
  note?: string;
  runDir: string;
  latestDir: string;
  acceptedDir: string;
  accepted: boolean;
};

export type FlowWorkbenchRunTreeBranch = {
  branchFlowPath: string;
  nodes: FlowWorkbenchRunTreeNode[];
};

export type FlowWorkbenchRunTree = {
  schemaVersion: 1;
  flowId: string;
  sessionId: string;
  mode: "sequential" | "parallel-groups";
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed" | "timed_out" | "unknown";
  nodes: FlowWorkbenchRunTreeNode[];
  parallelGroups: Array<{
    after: string;
    join: string;
    branches: FlowWorkbenchRunTreeBranch[];
  }>;
};

export type FlowWorkbenchFlowExecutionMode =
  | { kind?: "sequential" }
  | { kind: "parallel-groups"; parallelGroups: [ParallelFlowGroup, ...ParallelFlowGroup[]] };

export type FlowWorkbenchFlowRunResult<TInput> = {
  compiled: CompiledConfiguredFlowSpec<FlowWorkbenchNodeExecutionInput<TInput>>;
  record: FlowWorkbenchRunRecord;
  runTree: FlowWorkbenchRunTree;
  nodeRuns: FlowWorkbenchRunResult<TInput>[];
};

export type FlowWorkbenchQueueWorkItem<TInput, TItem = unknown> = {
  id: string;
  item: TItem;
  flow: unknown;
  configuredNodes: unknown[];
  nodeRegistry: NodeRegistry;
  input: TInput;
  executionMode?: FlowWorkbenchFlowExecutionMode;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
  log?: (line: string) => void;
  failureResolver?: NodeFailureResolver<FlowWorkbenchNodeExecutionInput<TInput>>;
};

export type FlowWorkbenchQueueWorkItemResult<TInput, TItem = unknown> = {
  id: string;
  item: TItem;
  dynamicWorkItemPath: string;
  status: FlowWorkbenchRunTree["status"];
  run?: FlowWorkbenchFlowRunResult<TInput>;
  errorMessage?: string;
};

export type FlowWorkbenchQueueRunResult<TInput, TItem = unknown> = {
  schemaVersion: 2;
  queueId: string;
  ownerQualifiedNodePath: string;
  sessionId: string;
  status: FlowWorkbenchRunTree["status"];
  total: number;
  completed: number;
  failed: number;
  dynamicQueueRoot: string;
  workItems: FlowWorkbenchQueueWorkItemResult<TInput, TItem>[];
};

function executionPolicyOverlayFromInput<TInput>(input: TInput): ExecutionPolicyRunOverlay | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return parseExecutionPolicyRunOverlay((input as { executionPolicy?: unknown }).executionPolicy);
}

function resolveWorkbenchExecutionPolicyOverlay<TInput>(params: Pick<FlowWorkbenchRunParams<TInput>, "input" | "executionPolicyOverlay">): ExecutionPolicyRunOverlay | undefined {
  return params.executionPolicyOverlay ?? executionPolicyOverlayFromInput(params.input);
}

function inputWithEffectiveExecutionPolicy<TInput>(input: TInput, policy: FlowWorkbenchLaunchSnapshot["executionPolicy"]): TInput {
  if (!policy?.agent || !input || typeof input !== "object" || Array.isArray(input)) return input;
  const original = input as Record<string, unknown>;
  return {
    ...original,
    ...(policy.agent.provider ? { provider: policy.agent.provider } : {}),
    ...(policy.agent.model ? { modelOverride: policy.agent.model } : {}),
    ...(policy.agent.runtime ? { agentRuntime: policy.agent.runtime } : {}),
  } as TInput;
}

export async function preflightWorkbenchRun<TInput>(params: FlowWorkbenchRunParams<TInput>): Promise<FlowWorkbenchRunResult<TInput>> {
  const nodeLibrary = createStaticFlowNodeLibrary(params.configuredNodes);
  const executionPolicyOverlay = resolveWorkbenchExecutionPolicyOverlay(params);
  const compiled = compileConfiguredFlowSpec<FlowWorkbenchNodeExecutionInput<TInput>>({
    flow: params.flow,
    nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options: { ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}) },
  });
  const target = resolveFlowNodePath(compiled.resolved, params.qualifiedNodePath);
  const entry = requireNodeTypeEntry(params.nodeRegistry, target.node.nodeType);
  const expectedArtifacts = entry.describeArtifacts?.({ nodeId: target.node.nodeId, params: target.node.params })?.outputs ?? [];
  const dependencies = await Promise.all(
    target.acceptedArtifacts.map(async (dependency) => {
      const canonicalAcceptedDir = workbenchAcceptedDir(params.workspaceRoot, params.sessionId, dependency.fromQualifiedPath);
      const canonicalPath = path.join(canonicalAcceptedDir, dependency.relativePath);
      if (await fileExists(canonicalPath)) {
        return {
          fromQualifiedPath: dependency.fromQualifiedPath,
          relativePath: dependency.relativePath,
          label: dependency.label,
          required: dependency.required ?? true,
          acceptedPath: canonicalPath,
          exists: true,
        } satisfies FlowWorkbenchPreflightDependency;
      }

      const sourceNodeId = compiled.resolved.nodesByPath[dependency.fromQualifiedPath]?.node.nodeId;
      const aliasPath = sourceNodeId && sourceNodeId !== dependency.fromQualifiedPath
        ? path.join(workbenchAcceptedDir(params.workspaceRoot, params.sessionId, sourceNodeId), dependency.relativePath)
        : undefined;
      const aliasExists = aliasPath ? await fileExists(aliasPath) : false;
      return {
        fromQualifiedPath: dependency.fromQualifiedPath,
        relativePath: dependency.relativePath,
        label: dependency.label,
        required: dependency.required ?? true,
        acceptedPath: aliasExists && aliasPath ? aliasPath : canonicalPath,
        exists: aliasExists,
        ...(aliasExists && sourceNodeId ? { resolvedFromQualifiedPath: sourceNodeId, aliasResolved: true } : {}),
      } satisfies FlowWorkbenchPreflightDependency;
    }),
  );
  const missing = dependencies.filter((dependency) => dependency.required && !dependency.exists);
  const launchSnapshot: FlowWorkbenchLaunchSnapshot = {
    flowId: compiled.resolved.rootFlowId,
    qualifiedNodePath: target.qualifiedPath,
    nodeId: target.node.nodeId,
    nodeType: target.node.nodeType,
    nodeName: target.node.name,
    nodeDescription: target.node.description,
    flowPath: target.flowPath,
    params: target.node.params,
    ...(target.executionPolicy ? { executionPolicy: target.executionPolicy } : {}),
    ...(target.executionPolicySources ? { executionPolicySources: target.executionPolicySources } : {}),
    acceptedUpstreamArtifacts: dependencies
      .filter((dependency) => dependency.exists)
      .map((dependency) => ({
        fromQualifiedPath: dependency.fromQualifiedPath,
        relativePath: dependency.relativePath,
        label: dependency.label,
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
  const record = await beginWorkbenchRun({
    workspaceRoot: params.workspaceRoot,
    sessionId: params.sessionId,
    qualifiedNodePath: params.qualifiedNodePath,
    flowId: compiled.resolved.rootFlowId,
  });

  return {
    compiled,
    record,
    launchSnapshot,
    preflight: {
      ok: missing.length === 0,
      dependencies,
      missing,
    },
  };
}

function matchingDownstreamNodePath<TInput>(run: FlowWorkbenchRunResult<TInput>): string | undefined {
  const target = resolveFlowNodePath(run.compiled.resolved, run.launchSnapshot.qualifiedNodePath);
  const status = run.runResult?.working.outputsByNodeId[target.node.nodeId]?.status;
  if (!status) return undefined;
  const matches = run.compiled.resolved.edges.filter(
    (edge) => edge.fromQualifiedPath === run.launchSnapshot.qualifiedNodePath && edge.on === status,
  );
  if (matches.length > 1) {
    return undefined;
  }
  return matches[0]?.toQualifiedPath;
}

function emitFlowEvents(runner: { emitLine(line: string): void }, events: FlowRuntimeEvent[]): void {
  for (const event of events) {
    runner.emitLine(formatFlowRuntimeEvent(event));
  }
}

export async function runFlowWorkbenchNode<TInput>(params: FlowWorkbenchRunParams<TInput>): Promise<FlowWorkbenchRunResult<TInput>> {
  const preflight = await preflightWorkbenchRun(params);
  if (!preflight.preflight.ok) {
    await persistWorkbenchSidecars({
      record: preflight.record,
      launchSnapshot: preflight.launchSnapshot,
      artifactEvents: [],
      artifactExistence: [],
      flowEvents: [],
      result: { preflight: preflight.preflight },
    });
    throw new Error(
      `Cannot start node '${params.qualifiedNodePath}' because required upstream accepted artifacts are missing: ${preflight.preflight.missing
        .map((item) => `${item.fromQualifiedPath}:${item.relativePath}`)
        .join(", ")}`,
    );
  }

  const runner = createNodeRunner({
    runId: `flow-workbench-${params.sessionId}-${params.qualifiedNodePath.replace(/[^a-zA-Z0-9._-]+/g, "-")}`,
    ...(params.log ? { log: params.log } : {}),
  });
  const flowEvents: FlowRuntimeEvent[] = createFlowEnterEventsForNode({
    resolved: preflight.compiled.resolved,
    nodePath: preflight.launchSnapshot.qualifiedNodePath,
    at: new Date().toISOString(),
    reason: preflight.launchSnapshot.qualifiedNodePath === preflight.compiled.resolved.initialNodePath ? "run-start" : "resume-start",
  });
  emitFlowEvents(runner, flowEvents);

  const executionPolicyOverlay = resolveWorkbenchExecutionPolicyOverlay(params);
  const effectiveInput = inputWithEffectiveExecutionPolicy(params.input, preflight.launchSnapshot.executionPolicy);
  const runResult = await runConfiguredFlowNode(runner, {
    flow: params.flow,
    nodeLibrary: createStaticFlowNodeLibrary(params.configuredNodes),
    nodeRegistry: params.nodeRegistry,
    qualifiedNodePath: params.qualifiedNodePath,
  }, {
    userInput: effectiveInput,
    workbench: {
      workspaceRoot: params.workspaceRoot,
      sessionId: params.sessionId,
      record: preflight.record,
      launchSnapshot: preflight.launchSnapshot,
      preflight: {
        dependencies: preflight.preflight.dependencies,
      },
    },
  } as FlowWorkbenchNodeExecutionInput<TInput>, {
    ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}),
    ...(params.failureResolver ? { failureResolver: params.failureResolver } : {}),
  });

  const target = resolveFlowNodePath(preflight.compiled.resolved, params.qualifiedNodePath);
  const entry = requireNodeTypeEntry(params.nodeRegistry, target.node.nodeType);
  const outputByNodeId = runResult.working.outputsByNodeId[target.node.nodeId];
  const payload = outputByNodeId?.payload;
  const emitted = entry.collectArtifacts?.({ nodeId: target.node.nodeId, params: target.node.params, payload }) ?? [];
  const artifactEvents: FlowWorkbenchArtifactEvent[] = [];
  for (const artifact of emitted) {
    artifactEvents.push({
      key: artifact.key,
      label: artifact.label,
      canonicalPath: artifact.path,
      relativePath: artifact.relativePath ?? artifact.key ?? artifact.label,
      exists: await fileExists(artifact.path),
      observedAt: new Date().toISOString(),
    });
  }

  const expected = preflight.launchSnapshot.expectedArtifacts;
  const artifactExistence: FlowWorkbenchArtifactExistenceVerdict[] = [];
  for (const declared of expected) {
    const observed = artifactEvents.find((artifact) => artifact.key === declared.key || artifact.relativePath === declared.relativePath);
    artifactExistence.push({
      key: declared.key,
      label: declared.label,
      relativePath: declared.relativePath,
      required: declared.required,
      canonicalPath: observed?.canonicalPath,
      exists: observed?.exists ?? false,
    });
  }

  for (const artifact of artifactEvents) {
    await copyCanonicalArtifactToSurface(artifact.canonicalPath, preflight.record.runDir, artifact.relativePath);
    await copyCanonicalArtifactToSurface(artifact.canonicalPath, preflight.record.latestDir, artifact.relativePath);
  }

  const runWithResult: FlowWorkbenchRunResult<TInput> = { ...preflight, runResult };
  const nextNodePath = matchingDownstreamNodePath(runWithResult);
  const boundaryEvents = nextNodePath
    ? createFlowTransitionEvents({
        resolved: preflight.compiled.resolved,
        fromNodePath: preflight.launchSnapshot.qualifiedNodePath,
        toNodePath: nextNodePath,
        at: new Date().toISOString(),
      })
    : createFlowExitEventsForNode({
        resolved: preflight.compiled.resolved,
        nodePath: preflight.launchSnapshot.qualifiedNodePath,
        at: new Date().toISOString(),
        reason: "run-end",
      });
  flowEvents.push(...boundaryEvents);
  emitFlowEvents(runner, boundaryEvents);

  await persistWorkbenchSidecars({
    record: preflight.record,
    launchSnapshot: preflight.launchSnapshot,
    artifactEvents,
    artifactExistence,
    flowEvents,
    result: runResult,
  });

  return {
    ...preflight,
    runResult,
    artifactEvents,
    artifactExistence,
    flowEvents,
  };
}

export async function acceptFlowWorkbenchRun<TInput>(params: {
  run: FlowWorkbenchRunResult<TInput>;
  acceptedByKind: FlowWorkbenchAcceptanceRecord["acceptedByKind"];
  acceptedById?: string;
  note?: string;
}): Promise<void> {
  await acceptWorkbenchRun({
    record: params.run.record,
    emittedArtifacts: (params.run.artifactEvents ?? []).filter((artifact) => artifact.exists).map((artifact) => ({
      canonicalPath: artifact.canonicalPath,
      relativePath: artifact.relativePath,
    })),
    acceptance: {
      acceptedAt: new Date().toISOString(),
      acceptedByKind: params.acceptedByKind,
      ...(params.acceptedById ? { acceptedById: params.acceptedById } : {}),
      ...(params.note ? { note: params.note } : {}),
      runDir: params.run.record.runDir,
    },
  });
}

function nodeStatusForRun<TInput>(run: FlowWorkbenchRunResult<TInput>): "completed" | "failed" | "timed_out" | "unknown" {
  return run.runResult?.working.outputsByNodeId[run.launchSnapshot.nodeId]?.status ?? "unknown";
}

function nodeTreeRecord<TInput>(run: FlowWorkbenchRunResult<TInput>, accepted: boolean): FlowWorkbenchRunTreeNode {
  const output = run.runResult?.working.outputsByNodeId[run.launchSnapshot.nodeId];
  return {
    qualifiedNodePath: run.launchSnapshot.qualifiedNodePath,
    nodeId: run.launchSnapshot.nodeId,
    status: output?.status ?? "unknown",
    ...(output?.note ? { note: output.note } : {}),
    runDir: run.record.runDir,
    latestDir: run.record.latestDir,
    acceptedDir: run.record.acceptedDir,
    accepted,
  };
}

function nextResolvedNodePath(args: {
  compiled: CompiledConfiguredFlowSpec<unknown>;
  fromQualifiedPath: string;
  status: string;
  allowedNodePaths?: Set<string>;
}): string | undefined {
  const matches = args.compiled.resolved.edges.filter(
    (edge) => edge.fromQualifiedPath === args.fromQualifiedPath && edge.on === args.status && (!args.allowedNodePaths || args.allowedNodePaths.has(edge.toQualifiedPath)),
  );
  if (matches.length > 1) {
    throw new Error(`Node '${args.fromQualifiedPath}' has ${matches.length} matching ${args.status} downstream edges.`);
  }
  return matches[0]?.toQualifiedPath;
}

function sanitizeDynamicPathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

export function workbenchDynamicQueueRoot(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
}): string {
  return path.join(
    params.workspaceRoot,
    params.sessionId,
    "__dynamic__",
    sanitizeDynamicPathPart(params.ownerQualifiedNodePath),
    "queues",
    sanitizeDynamicPathPart(params.queueId),
  );
}

export function workbenchDynamicWorkItemRoot(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
  workItemId: string;
}): string {
  return path.join(workbenchDynamicQueueRoot(params), "work-items", sanitizeDynamicPathPart(params.workItemId));
}

async function persistRunTree(record: FlowWorkbenchRunRecord, runTree: FlowWorkbenchRunTree): Promise<void> {
  const runTreePath = path.join(record.runDir, "run-tree.json");
  await writeFile(runTreePath, `${JSON.stringify(runTree, null, 2)}\n`, "utf8");
  await mkdir(record.latestDir, { recursive: true });
  await cp(runTreePath, path.join(record.latestDir, "run-tree.json"), { recursive: false });
}

export async function runFlowWorkbenchFlow<TInput>(params: Omit<FlowWorkbenchRunParams<TInput>, "qualifiedNodePath"> & {
  executionMode?: FlowWorkbenchFlowExecutionMode;
  acceptedByKind?: FlowWorkbenchAcceptanceRecord["acceptedByKind"];
  acceptedById?: string;
}): Promise<FlowWorkbenchFlowRunResult<TInput>> {
  const nodeLibrary = createStaticFlowNodeLibrary(params.configuredNodes);
  const executionPolicyOverlay = resolveWorkbenchExecutionPolicyOverlay(params);
  const compiled = compileConfiguredFlowSpec<FlowWorkbenchNodeExecutionInput<TInput>>({
    flow: params.flow,
    nodeLibrary,
    nodeRegistry: params.nodeRegistry,
    options: { ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}) },
  });
  const mode = params.executionMode?.kind === "parallel-groups" ? "parallel-groups" : "sequential";
  const record = await beginWorkbenchRun({
    workspaceRoot: params.workspaceRoot,
    sessionId: params.sessionId,
    qualifiedNodePath: `__flow__.${compiled.resolved.rootFlowId}`,
    flowId: compiled.resolved.rootFlowId,
  });
  const startedAt = new Date().toISOString();
  const nodeRuns: FlowWorkbenchRunResult<TInput>[] = [];
  const treeNodes: FlowWorkbenchRunTreeNode[] = [];
  const parallelGroups: FlowWorkbenchRunTree["parallelGroups"] = [];

  async function runAndAccept(qualifiedNodePath: string): Promise<FlowWorkbenchRunTreeNode> {
    const run = await runFlowWorkbenchNode({
      workspaceRoot: params.workspaceRoot,
      sessionId: params.sessionId,
      flow: params.flow,
      configuredNodes: params.configuredNodes,
      nodeRegistry: params.nodeRegistry,
      input: params.input,
      qualifiedNodePath,
      ...(executionPolicyOverlay ? { executionPolicyOverlay } : {}),
      ...(params.log ? { log: params.log } : {}),
      ...(params.failureResolver ? { failureResolver: params.failureResolver } : {}),
    });
    nodeRuns.push(run);
    const nodeResult = run.runResult?.working.outputsByNodeId[run.launchSnapshot.nodeId];
    const accepted = nodeResult?.status === "completed";
    if (accepted) {
      await acceptFlowWorkbenchRun({
        run,
        acceptedByKind: params.acceptedByKind ?? "agent",
        acceptedById: params.acceptedById ?? "flow-workbench-flow-runner",
        note: "Accepted by Flow Workbench full-flow runner.",
      });
    }
    const treeNode = nodeTreeRecord(run, accepted);
    treeNodes.push(treeNode);
    return treeNode;
  }

  async function runLinear(startNodePath: string, options: { stopAfter?: string; allowedNodePaths?: Set<string> } = {}): Promise<FlowWorkbenchRunTreeNode[]> {
    const localNodes: FlowWorkbenchRunTreeNode[] = [];
    let current: string | undefined = startNodePath;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) throw new Error(`Flow Workbench full-flow runner detected a loop at '${current}'.`);
      visited.add(current);
      const treeNode = await runAndAccept(current);
      localNodes.push(treeNode);
      if (current === options.stopAfter) break;
      const next = nextResolvedNodePath({
        compiled: compiled as CompiledConfiguredFlowSpec<unknown>,
        fromQualifiedPath: current,
        status: treeNode.status,
        allowedNodePaths: options.allowedNodePaths,
      });
      current = next;
    }
    return localNodes;
  }

  const executionMode = params.executionMode;
  if (executionMode?.kind === "parallel-groups") {
    if (executionMode.parallelGroups.length !== 1) {
      throw new Error("runFlowWorkbenchFlow currently supports exactly one parallel group.");
    }
    const group = executionMode.parallelGroups[0]!;
    const prefixNodes = await runLinear(compiled.resolved.initialNodePath, { stopAfter: group.after });
    const lastPrefixNode = prefixNodes[prefixNodes.length - 1];
    if (lastPrefixNode?.qualifiedNodePath === group.after && lastPrefixNode.status === "completed") {
      const branchTrees = await Promise.all(group.branches.map(async (branchFlowPath): Promise<FlowWorkbenchRunTreeBranch> => {
        const boundary = compiled.resolved.flowsByPath[branchFlowPath];
        if (!boundary) throw new Error(`Unknown parallel branch Flow '${branchFlowPath}'.`);
        const allowed = new Set(boundary.nodePaths);
        const branchNodes = await runLinear(boundary.initialNodePath, { allowedNodePaths: allowed });
        return { branchFlowPath, nodes: branchNodes };
      }));
      parallelGroups.push({ after: group.after, join: group.join, branches: branchTrees });
      await runLinear(group.join);
    }
  } else {
    await runLinear(compiled.resolved.initialNodePath);
  }

  const finishedAt = new Date().toISOString();
  const failedNode = treeNodes.find((node) => node.status === "failed" || node.status === "timed_out" || node.status === "unknown");
  const runTree: FlowWorkbenchRunTree = {
    schemaVersion: 1,
    flowId: compiled.resolved.rootFlowId,
    sessionId: params.sessionId,
    mode,
    startedAt,
    finishedAt,
    status: failedNode?.status ?? "completed",
    nodes: treeNodes,
    parallelGroups,
  };
  await persistRunTree(record, runTree);
  return { compiled, record, runTree, nodeRuns };
}

export async function acceptFlowWorkbenchRunTree<TInput>(params: {
  run: FlowWorkbenchFlowRunResult<TInput>;
  acceptedByKind: FlowWorkbenchAcceptanceRecord["acceptedByKind"];
  acceptedById?: string;
  note?: string;
}): Promise<void> {
  for (const nodeRun of params.run.nodeRuns) {
    await acceptFlowWorkbenchRun({
      run: nodeRun,
      acceptedByKind: params.acceptedByKind,
      acceptedById: params.acceptedById,
      note: params.note ?? "Accepted by Flow Workbench run-tree acceptance.",
    });
  }
}

export async function runFlowWorkbenchQueue<TInput, TItem = unknown>(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
  workItems: FlowWorkbenchQueueWorkItem<TInput, TItem>[];
  concurrency: number;
  acceptedByKind?: FlowWorkbenchAcceptanceRecord["acceptedByKind"];
  acceptedById?: string;
  log?: (line: string) => void;
  failureResolver?: NodeFailureResolver<FlowWorkbenchNodeExecutionInput<TInput>>;
}): Promise<FlowWorkbenchQueueRunResult<TInput, TItem>> {
  const concurrency = Math.max(1, Math.floor(params.concurrency));
  const dynamicQueueRoot = workbenchDynamicQueueRoot(params);
  await mkdir(dynamicQueueRoot, { recursive: true });
  const workItems = new Array<FlowWorkbenchQueueWorkItemResult<TInput, TItem>>(params.workItems.length);
  let nextIndex = 0;

  async function runWorkItem(index: number): Promise<void> {
    const workItem = params.workItems[index]!;
    const dynamicWorkItemPath = workbenchDynamicWorkItemRoot({ ...params, workItemId: workItem.id });
    try {
      const run = await runFlowWorkbenchFlow({
        workspaceRoot: dynamicWorkItemPath,
        sessionId: "workbench",
        flow: workItem.flow,
        configuredNodes: workItem.configuredNodes,
        nodeRegistry: workItem.nodeRegistry,
        input: workItem.input,
        ...(workItem.executionMode ? { executionMode: workItem.executionMode } : {}),
        ...(workItem.executionPolicyOverlay ? { executionPolicyOverlay: workItem.executionPolicyOverlay } : {}),
        ...(workItem.log ?? params.log ? { log: workItem.log ?? params.log } : {}),
        ...(workItem.failureResolver ?? params.failureResolver ? { failureResolver: workItem.failureResolver ?? params.failureResolver } : {}),
        acceptedByKind: params.acceptedByKind ?? "agent",
        acceptedById: params.acceptedById ?? "flow-workbench-queue",
      });
      workItems[index] = {
        id: workItem.id,
        item: workItem.item,
        dynamicWorkItemPath,
        status: run.runTree.status,
        run,
      };
    } catch (error) {
      workItems[index] = {
        id: workItem.id,
        item: workItem.item,
        dynamicWorkItemPath,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= params.workItems.length) return;
      await runWorkItem(index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, params.workItems.length) }, () => worker()));
  const completed = workItems.filter((workItem) => workItem.status === "completed").length;
  const failed = workItems.length - completed;
  const status: FlowWorkbenchRunTree["status"] = failed > 0 ? "failed" : "completed";
  const result: FlowWorkbenchQueueRunResult<TInput, TItem> = {
    schemaVersion: 2,
    queueId: params.queueId,
    ownerQualifiedNodePath: params.ownerQualifiedNodePath,
    sessionId: params.sessionId,
    status,
    total: workItems.length,
    completed,
    failed,
    dynamicQueueRoot,
    workItems,
  };
  await writeFile(path.join(dynamicQueueRoot, "queue-run.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function readFlowWorkbenchQueueRun<TInput, TItem = unknown>(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
}): Promise<FlowWorkbenchQueueRunResult<TInput, TItem>> {
  return JSON.parse(await readFile(path.join(workbenchDynamicQueueRoot(params), "queue-run.json"), "utf8")) as FlowWorkbenchQueueRunResult<TInput, TItem>;
}

export async function rerunFlowWorkbenchQueueWorkItem<TInput, TItem = unknown>(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
  workItem: FlowWorkbenchQueueWorkItem<TInput, TItem>;
  acceptedByKind?: FlowWorkbenchAcceptanceRecord["acceptedByKind"];
  acceptedById?: string;
}): Promise<FlowWorkbenchQueueWorkItemResult<TInput, TItem>> {
  const dynamicWorkItemPath = workbenchDynamicWorkItemRoot({ ...params, workItemId: params.workItem.id });
  try {
    const run = await runFlowWorkbenchFlow({
      workspaceRoot: dynamicWorkItemPath,
      sessionId: "workbench",
      flow: params.workItem.flow,
      configuredNodes: params.workItem.configuredNodes,
      nodeRegistry: params.workItem.nodeRegistry,
      input: params.workItem.input,
      ...(params.workItem.executionMode ? { executionMode: params.workItem.executionMode } : {}),
      acceptedByKind: params.acceptedByKind ?? "agent",
      acceptedById: params.acceptedById ?? "flow-workbench-queue-rerun",
    });
    return { id: params.workItem.id, item: params.workItem.item, dynamicWorkItemPath, status: run.runTree.status, run };
  } catch (error) {
    return {
      id: params.workItem.id,
      item: params.workItem.item,
      dynamicWorkItemPath,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function recompileFlowWorkbenchQueueRun<TInput, TItem = unknown>(params: {
  workspaceRoot: string;
  sessionId: string;
  ownerQualifiedNodePath: string;
  queueId: string;
}): Promise<FlowWorkbenchQueueRunResult<TInput, TItem>> {
  const previous = await readFlowWorkbenchQueueRun<TInput, TItem>(params);
  const workItems = await Promise.all(previous.workItems.map(async (workItem) => {
    const latestTreePath = workItem.run?.record.latestDir ? path.join(workItem.run.record.latestDir, "run-tree.json") : undefined;
    if (!latestTreePath || !(await fileExists(latestTreePath))) return workItem;
    const runTree = JSON.parse(await readFile(latestTreePath, "utf8")) as FlowWorkbenchRunTree;
    return { ...workItem, status: runTree.status };
  }));
  const completed = workItems.filter((workItem) => workItem.status === "completed").length;
  const failed = workItems.length - completed;
  const result: FlowWorkbenchQueueRunResult<TInput, TItem> = {
    ...previous,
    status: failed > 0 ? "failed" : "completed",
    completed,
    failed,
    workItems,
  };
  await writeFile(path.join(previous.dynamicQueueRoot, "queue-run.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
