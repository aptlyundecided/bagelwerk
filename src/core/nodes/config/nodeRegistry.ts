import type { ExecutionPolicy } from "../../flows/config/executionPolicy";
import type { NodeResult, NodeRunnerWorkingContext } from "../graph";

export type NodeTypeId = string;

export type DeclaredNodeArtifactSlot = {
  key: string;
  label: string;
  relativePath: string;
  required?: boolean;
  kind?: "contract" | "report" | "note" | "handoff" | "observability" | "other";
};

export type DeclaredNodeArtifactShape = {
  outputs: DeclaredNodeArtifactSlot[];
};

export type EmittedNodeArtifactRecord = {
  key?: string;
  label: string;
  path: string;
  relativePath?: string;
  required?: boolean;
};

export type NodeContractVisibility = "strict_contract" | "declared" | "opaque";

export type NodeTypeEntry<TParams = unknown, TInput = unknown, TPayload = unknown> = {
  nodeType: NodeTypeId;
  label?: string;
  validateParams: (value: unknown) => TParams;
  execute: (args: {
    nodeId: string;
    instanceId: string;
    params: TParams;
    working: Readonly<NodeRunnerWorkingContext<TInput>>;
    executionPolicy?: ExecutionPolicy;
  }) => Promise<NodeResult<TPayload>>;
  describeArtifacts?: (args: { nodeId: string; params: TParams }) => DeclaredNodeArtifactShape;
  contractVisibility?: NodeContractVisibility;
  collectArtifacts?: (args: { nodeId: string; params: TParams; payload: TPayload | undefined }) => EmittedNodeArtifactRecord[];
};

export type AnyNodeTypeEntry = NodeTypeEntry<any, any, any>;

export type NodeRegistry = {
  get(nodeType: NodeTypeId): AnyNodeTypeEntry | undefined;
  list(): AnyNodeTypeEntry[];
};

export function createStaticNodeRegistry(entries: AnyNodeTypeEntry[]): NodeRegistry {
  const byType = new Map<NodeTypeId, AnyNodeTypeEntry>();
  for (const entry of entries) {
    if (byType.has(entry.nodeType)) {
      throw new Error(`Duplicate nodeType registration: ${entry.nodeType}`);
    }
    byType.set(entry.nodeType, entry);
  }

  return {
    get(nodeType) {
      return byType.get(nodeType);
    },
    list() {
      return [...byType.values()];
    },
  };
}

export function requireNodeTypeEntry(registry: NodeRegistry, nodeType: NodeTypeId): AnyNodeTypeEntry {
  const entry = registry.get(nodeType);
  if (!entry) {
    throw new Error(`Unknown configured nodeType: ${nodeType}`);
  }
  return entry;
}
