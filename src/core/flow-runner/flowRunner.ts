import path from "node:path";
import { runFlowRunnerFlow, runFlowRunnerNode } from "./flowRunnerCore";
import type { FlowRunnerRunTreeNode } from "./runRecords";
import type { ExternalFlowBinding, RunExternalFlowParams, RunExternalFlowResult, RunExternalNodeParams, RunExternalNodeResult } from "./types";
import { externalFlowCatalogEntryFromResolved, importExternalFlowBinding, listExternalFlows, resolveExternalFlowById, sanitizeFlowRunnerPathPart } from "./flowConfig";

type FailedFlowSummaryNode = Pick<FlowRunnerRunTreeNode, "qualifiedNodePath" | "status" | "note" | "runDir" | "latestDir">;

function failedFlowSummaryNodes(nodes: FlowRunnerRunTreeNode[]): FailedFlowSummaryNode[] {
  return nodes
    .filter((node) => node.status !== "completed")
    .map((node) => ({
      qualifiedNodePath: node.qualifiedNodePath,
      status: node.status,
      ...(node.note ? { note: node.note } : {}),
      runDir: node.runDir,
      latestDir: node.latestDir,
    }));
}

function parseJsonInput(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("inputJson must be a JSON object");
  return parsed as Record<string, unknown>;
}

function defaultOperatorId(): string {
  return process.env.USERNAME ?? process.env.USER ?? "operator";
}

function defaultInput<TInput>(input: TInput | undefined): TInput {
  return {
    env: process.env,
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
  } as TInput;
}

// Rewrite a cross-flow artifact reference when the root flow is re-namespaced. Flow-local short
// keys (e.g. "intro") don't start with the old flowId and are left untouched; fully-qualified
// cross-subflow refs (e.g. "platform-tour.context-handoff-demo.read-handoff-packet") get their
// old root-flowId prefix swapped for the new qualified id so they resolve at runtime.
function renamespaceFromRef(fromRef: unknown, oldFlowId: string, qualifiedFlowId: string): unknown {
  if (typeof fromRef !== "string") return fromRef;
  if (fromRef === oldFlowId) return qualifiedFlowId;
  if (fromRef.startsWith(`${oldFlowId}.`)) return `${qualifiedFlowId}${fromRef.slice(oldFlowId.length)}`;
  return fromRef;
}

function renamespaceAcceptedArtifacts(value: unknown, oldFlowId: string, qualifiedFlowId: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) && "from" in entry
      ? { ...(entry as Record<string, unknown>), from: renamespaceFromRef((entry as { from?: unknown }).from, oldFlowId, qualifiedFlowId) }
      : entry,
  );
}

// Recursively rewrite every node's acceptedArtifacts.from across the root flow and its nested
// sub-flows. The old ROOT flowId is the prefix to swap at every level (qualified refs are rooted there).
function rewriteFlowAcceptedRefs(flowObj: Record<string, unknown>, oldRootFlowId: string, qualifiedRootFlowId: string): Record<string, unknown> {
  const result: Record<string, unknown> = { ...flowObj };
  if (result.nodes && typeof result.nodes === "object" && !Array.isArray(result.nodes)) {
    result.nodes = Object.fromEntries(Object.entries(result.nodes as Record<string, unknown>).map(([key, node]) =>
      node && typeof node === "object" && !Array.isArray(node) && "acceptedArtifacts" in node
        ? [key, { ...(node as Record<string, unknown>), acceptedArtifacts: renamespaceAcceptedArtifacts((node as { acceptedArtifacts?: unknown }).acceptedArtifacts, oldRootFlowId, qualifiedRootFlowId) }]
        : [key, node],
    ));
  }
  if (result.flows && typeof result.flows === "object" && !Array.isArray(result.flows)) {
    result.flows = Object.fromEntries(Object.entries(result.flows as Record<string, unknown>).map(([key, subflow]) =>
      subflow && typeof subflow === "object" && !Array.isArray(subflow)
        ? [key, rewriteFlowAcceptedRefs(subflow as Record<string, unknown>, oldRootFlowId, qualifiedRootFlowId)]
        : [key, subflow],
    ));
  }
  return result;
}

export function flowWithRunnerId(flow: unknown, qualifiedFlowId: string): unknown {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) return flow;
  const source = flow as Record<string, unknown>;
  const oldFlowId = typeof source.flowId === "string" ? source.flowId : undefined;
  const rewritten = oldFlowId && oldFlowId !== qualifiedFlowId
    ? rewriteFlowAcceptedRefs(source, oldFlowId, qualifiedFlowId)
    : { ...source };
  rewritten.flowId = qualifiedFlowId;
  return rewritten;
}

function bindingWithRunnerMetadata(binding: ExternalFlowBinding, qualifiedFlowId: string): ExternalFlowBinding {
  return {
    ...binding,
    flow: flowWithRunnerId(binding.flow, qualifiedFlowId),
  };
}

function defaultArtifactRoot(args: { cwd: string; namespace: string; workspaceName: string; flowId: string }): string {
  return path.join(
    args.cwd,
    ".artifacts",
    "flows",
    "external",
    sanitizeFlowRunnerPathPart(args.namespace),
    sanitizeFlowRunnerPathPart(args.workspaceName),
    sanitizeFlowRunnerPathPart(args.flowId),
  );
}

export { listExternalFlows, parseJsonInput };

export async function loadExternalFlowForRun(args: { cwd?: string; flowId: string }) {
  const entry = await resolveExternalFlowById({ cwd: args.cwd, flowId: args.flowId });
  const importedBinding = await importExternalFlowBinding(entry);
  const binding = bindingWithRunnerMetadata(importedBinding, entry.qualifiedId);
  const configCatalogEntry = externalFlowCatalogEntryFromResolved(entry, "cwd");
  const catalogEntry = {
    ...configCatalogEntry,
    aliases: Array.from(new Set([...configCatalogEntry.aliases, ...(importedBinding.aliases ?? [])])),
    label: importedBinding.label ?? configCatalogEntry.label,
    ...(importedBinding.description ?? configCatalogEntry.description ? { description: importedBinding.description ?? configCatalogEntry.description } : {}),
    workspaceName: sanitizeFlowRunnerPathPart(importedBinding.workspaceName ?? configCatalogEntry.workspaceName),
    ...(importedBinding.requirements ?? configCatalogEntry.requirements ? { requirements: importedBinding.requirements ?? configCatalogEntry.requirements } : {}),
    ...((importedBinding.prompts ?? configCatalogEntry.prompts) ? { prompts: importedBinding.prompts ?? configCatalogEntry.prompts } : {}),
    ...(importedBinding.supervisor ?? configCatalogEntry.supervisor ? { supervisor: importedBinding.supervisor ?? configCatalogEntry.supervisor } : {}),
    ...((importedBinding.profiles ?? configCatalogEntry.profiles) ? { profiles: importedBinding.profiles ?? configCatalogEntry.profiles } : {}),
  };
  return { entry, binding, catalogEntry };
}

export async function runExternalFlow<TInput = Record<string, unknown>>(params: RunExternalFlowParams<TInput>): Promise<RunExternalFlowResult<TInput>> {
  const cwd = path.resolve(params.cwd ?? process.cwd());
  const { entry, binding, catalogEntry } = await loadExternalFlowForRun({ cwd, flowId: params.flowId });
  const run = await runFlowRunnerFlow<TInput>({
    artifactRoot: params.artifactRoot ?? defaultArtifactRoot({ cwd, namespace: entry.namespace, workspaceName: catalogEntry.workspaceName, flowId: entry.qualifiedId }),
    sessionId: params.sessionId,
    flow: binding.flow,
    configuredNodes: binding.configuredNodes,
    nodeRegistry: binding.nodeRegistry,
    input: defaultInput(params.input),
    acceptance: { mode: "auto", acceptedByKind: params.acceptedByKind ?? "user", acceptedById: params.acceptedById ?? defaultOperatorId() },
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.executionPlan ? { executionPlan: params.executionPlan } : {}),
    ...(params.executionPolicyOverlay ? { executionPolicyOverlay: params.executionPolicyOverlay } : {}),
    ...(params.unhandledFailureResolver ? { unhandledFailureResolver: params.unhandledFailureResolver } : {}),
    ...(params.log ? { log: params.log } : {}),
    ...(params.onEvent ? { onEvent: params.onEvent } : {}),
    ...(params.middlewares ? { middlewares: params.middlewares } : {}),
  });
  return { catalogEntry, run };
}

export async function runExternalNode<TInput = Record<string, unknown>>(params: RunExternalNodeParams<TInput>): Promise<RunExternalNodeResult<TInput>> {
  const cwd = path.resolve(params.cwd ?? process.cwd());
  const { entry, binding, catalogEntry } = await loadExternalFlowForRun({ cwd, flowId: params.flowId });
  const run = await runFlowRunnerNode<TInput>({
    artifactRoot: params.artifactRoot ?? defaultArtifactRoot({ cwd, namespace: entry.namespace, workspaceName: catalogEntry.workspaceName, flowId: entry.qualifiedId }),
    sessionId: params.sessionId,
    flow: binding.flow,
    configuredNodes: binding.configuredNodes,
    nodeRegistry: binding.nodeRegistry,
    qualifiedNodePath: params.qualifiedNodePath,
    input: defaultInput(params.input),
    acceptance: { mode: "auto", acceptedByKind: params.acceptedByKind ?? "user", acceptedById: params.acceptedById ?? defaultOperatorId() },
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.executionPolicyOverlay ? { executionPolicyOverlay: params.executionPolicyOverlay } : {}),
    ...(params.unhandledFailureResolver ? { unhandledFailureResolver: params.unhandledFailureResolver } : {}),
    ...(params.log ? { log: params.log } : {}),
    ...(params.onEvent ? { onEvent: params.onEvent } : {}),
    ...(params.middlewares ? { middlewares: params.middlewares } : {}),
  });

  return { catalogEntry, run };
}

export function externalFlowRunSummary(result: RunExternalFlowResult<any>) {
  const failedNodes = failedFlowSummaryNodes(result.run.runTree.nodes);
  return {
    flowId: result.catalogEntry.id,
    label: result.catalogEntry.label,
    sessionId: result.run.record.sessionId,
    mode: result.run.runTree.mode,
    status: result.run.runTree.status,
    nodes: result.run.runTree.nodes.length,
    ...(failedNodes.length > 0 ? { failedNodes } : {}),
    runDir: result.run.record.runDir,
    latestDir: result.run.record.latestDir,
  };
}

export function externalNodeRunSummary(result: RunExternalNodeResult<any>) {
  const nodeResult = result.run.runResult?.working.outputsByNodeId[result.run.launchSnapshot.nodeId];
  return {
    flowId: result.catalogEntry.id,
    label: result.catalogEntry.label,
    sessionId: result.run.record.sessionId,
    qualifiedNodePath: result.run.launchSnapshot.qualifiedNodePath,
    status: nodeResult?.status,
    note: nodeResult?.note,
    runDir: result.run.record.runDir,
    latestDir: result.run.record.latestDir,
  };
}
