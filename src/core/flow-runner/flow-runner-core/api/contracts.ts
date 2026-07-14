import type { ExecutionPolicyRunOverlay, ResolvedFlowGraph } from "../../../flows/config";
import type { NodeRegistry } from "../../../nodes/config";
import type { NodeGraphRunResult, NodeResult } from "../../../nodes/graph";
import type { FlowRunnerEvent, FlowRunnerEventSink } from "../../events";
import type {
  FlowRunnerArtifactEvent,
  FlowRunnerArtifactExistenceVerdict,
  FlowRunnerFlowRunRecord,
  FlowRunnerLaunchSnapshot,
  FlowRunnerNodeRunRecord,
  FlowRunnerRunTree,
  FlowRunnerRunTreeNode,
} from "../../runRecords";
import type { FlowRunnerNodeExecutionInput, FlowRunnerPreflightDependency } from "../../runtimeContext";
import type { FlowRunnerMiddleware } from "../middleware/middleware";

export type FlowRunnerResolvedFlow<TInput> = {
  resolved: ResolvedFlowGraph;
  /** Anchors the user input type carried by Flow Runner execution results. */
  readonly inputType?: TInput;
};

export type FlowRunnerAcceptancePolicy = {
  mode?: "auto" | "manual";
  acceptedByKind?: "user" | "agent";
  acceptedById?: string;
};

export type FlowRunnerResumePolicy = "off" | "accepted-only";

export type FlowRunnerIterationPolicy = {
  allowCycles?: boolean;
  maxNodeVisits?: number;
  maxVisitsPerNode?: number;
};

export type FlowRunnerUnhandledFailureResolution = {
  disposition: "recovered" | "hard_fail";
  replacementResult?: NodeResult<unknown>;
  repairedArtifacts?: Array<{ canonicalPath: string; relativePath: string; key?: string; label: string }>;
  note?: string;
};

export type FlowRunnerUnhandledFailureResolver<TInput> = (args: {
  run: FlowRunnerNodeRunResult<TInput>;
  treeNode: FlowRunnerRunTreeNode;
}) => Promise<FlowRunnerUnhandledFailureResolution | undefined>;

export type FlowRunnerExecutionPlan =
  | { kind?: "whole-flow" }
  | { kind: "prefix"; stopAfter: string }
  | {
      kind: "lanes";
      prefix?: { stopAfter: string; run?: boolean };
      lanes: Array<{ id: string; flowPath: string }>;
      laneConcurrency?: number | "unbounded";
      join?: string;
    };

export type FlowRunnerBinding = {
  flow: unknown;
  configuredNodes: unknown[];
  nodeRegistry: NodeRegistry;
};

type FlowRunnerRunOptions<TInput> = {
  input: TInput;
  sessionId: string;
  artifactRoot?: string;
  acceptance?: FlowRunnerAcceptancePolicy;
  resume?: FlowRunnerResumePolicy;
  iteration?: FlowRunnerIterationPolicy;
  unhandledFailureResolver?: FlowRunnerUnhandledFailureResolver<TInput>;
  log?: (line: string) => void;
  onEvent?: FlowRunnerEventSink;
  middlewares?: FlowRunnerMiddleware<TInput>[];
};

export type RunFlowRunnerParams<TInput> = FlowRunnerBinding & FlowRunnerRunOptions<TInput> & {
  executionPlan?: FlowRunnerExecutionPlan;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
};

export type RunResolvedFlowRunnerParams<TInput> = FlowRunnerRunOptions<TInput> & {
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  nodeRegistry: NodeRegistry;
  executionPlan?: FlowRunnerExecutionPlan;
};

export type RunFlowRunnerNodeParams<TInput> = FlowRunnerRunOptions<TInput> & {
  qualifiedNodePath: string;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
} & (
  | (FlowRunnerBinding & { resolvedFlow?: undefined })
  | {
      resolvedFlow: FlowRunnerResolvedFlow<TInput>;
      nodeRegistry: NodeRegistry;
    }
);

export type FlowRunnerNodeRunResult<TInput> = {
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  record: FlowRunnerNodeRunRecord;
  launchSnapshot: FlowRunnerLaunchSnapshot;
  preflight: {
    ok: boolean;
    dependencies: FlowRunnerPreflightDependency[];
    missing: FlowRunnerPreflightDependency[];
  };
  runResult: NodeGraphRunResult<FlowRunnerNodeExecutionInput<TInput>>;
  artifactEvents: FlowRunnerArtifactEvent[];
  artifactExistence: FlowRunnerArtifactExistenceVerdict[];
  accepted: boolean;
  events: FlowRunnerEvent[];
  skipped?: boolean;
};

export type FlowRunnerFlowRunResult<TInput> = {
  resolvedFlow: FlowRunnerResolvedFlow<TInput>;
  record: FlowRunnerFlowRunRecord;
  runTree: FlowRunnerRunTree;
  nodeRuns: FlowRunnerNodeRunResult<TInput>[];
};
