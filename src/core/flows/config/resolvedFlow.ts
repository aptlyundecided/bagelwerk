import type { NodeRunnerSpec } from "../../nodes/graph";
import type { ConfiguredNodeSpec } from "../../nodes/config";
import type { ConfiguredFlowEdge, ConfiguredFlowNodeAcceptedArtifactRef } from "./configuredFlow";
import type { ExecutionPolicy, ExecutionPolicySource } from "./executionPolicy";

export type ResolvedFlowAcceptedArtifactRef = ConfiguredFlowNodeAcceptedArtifactRef & {
  fromQualifiedPath: string;
};

export type ResolvedFlowNode = {
  qualifiedPath: string;
  localNodeKey: string;
  flowPath: string[];
  flowId: string;
  node: ConfiguredNodeSpec;
  acceptedArtifacts: ResolvedFlowAcceptedArtifactRef[];
  outgoing: ConfiguredFlowEdge[];
  executionPolicy?: ExecutionPolicy;
  executionPolicySources?: ExecutionPolicySource[];
};

export type ResolvedFlowBoundary = {
  qualifiedPath: string;
  flowPath: string[];
  flowId: string;
  initialNodePath: string;
  nodePaths: string[];
  exitNodePaths: string[];
  executionPolicy?: ExecutionPolicy;
  executionPolicySources?: ExecutionPolicySource[];
};

export type ResolvedFlowGraph = {
  rootFlowId: string;
  rootFlowPath: string[];
  initialNodePath: string;
  nodesByPath: Record<string, ResolvedFlowNode>;
  flowsByPath: Record<string, ResolvedFlowBoundary>;
  edges: Array<ConfiguredFlowEdge & { fromQualifiedPath: string; toQualifiedPath: string }>;
};

export type ResolvedFlowNodeTarget = {
  qualifiedPath: string;
  flowPath: string[];
  flowId: string;
  localNodeKey: string;
  nodeId: string;
  nodeName: string;
  nodeDescription?: string;
};

export type CompiledConfiguredFlowSpec<TInput = unknown> = {
  resolved: ResolvedFlowGraph;
  runnerSpec: NodeRunnerSpec<TInput>;
};
