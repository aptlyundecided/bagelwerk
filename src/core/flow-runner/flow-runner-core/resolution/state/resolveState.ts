import type {
  ConfiguredFlowEdge,
  ExecutionPolicy,
  ExecutionPolicySource,
  ResolvedFlowNode,
} from "../../../../flows/config";

export type FlowBoundary = {
  qualifiedPath: string;
  flowPath: string[];
  flowId: string;
  initialRef: string;
  localNodeKeys: Set<string>;
  localFlowKeys: Set<string>;
  immediateNodePaths: string[];
  childFlowPaths: string[];
  nodePaths: string[];
  exitNodePaths: string[];
  initialNodePath?: string;
  exitsComputed: boolean;
  executionPolicy?: ExecutionPolicy;
  executionPolicySources?: ExecutionPolicySource[];
};

export type RawFlowEdge = ConfiguredFlowEdge & {
  ownerFlowPath: string[];
};

export type ResolveState = {
  nodesByPath: Record<string, ResolvedFlowNode>;
  rawEdges: RawFlowEdge[];
  edges: Array<ConfiguredFlowEdge & { fromQualifiedPath: string; toQualifiedPath: string }>;
  flowsByPath: Record<string, FlowBoundary>;
};

export function createResolveState(): ResolveState {
  return { nodesByPath: {}, rawEdges: [], edges: [], flowsByPath: {} };
}
