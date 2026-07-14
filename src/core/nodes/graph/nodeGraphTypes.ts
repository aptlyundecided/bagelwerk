export type NodeStatus = "completed" | "failed" | "timed_out";

export type NodeResult<TPayload = unknown> = {
  status: NodeStatus;
  payload?: TPayload;
  note?: string;
};

export type NodeRunnerWorkingContext<TInput = unknown> = {
  input: TInput;
  outputsByNodeId: Record<string, NodeResult<unknown>>;
  attemptsByNodeId: Record<string, number>;
  lastNodeId?: string;
};

export type NodeTransitionInput<TPayload = unknown> = {
  nodeId: string;
  attemptCount: number;
  retryBudget?: number;
  nodeStatus: NodeStatus;
  nodePayload?: TPayload;
  note?: string;
  threw?: boolean;
  errorMessage?: string;
};

export type NodeGraphEdge<TPayload = unknown> = {
  to: string;
  label?: string;
  when: (input: NodeTransitionInput<TPayload>) => boolean;
};

export type NodeGraphNode<TPayload = unknown> = {
  nodeKey?: string;
  label?: string;
  retryBudget?: number;
  final?: boolean;
  edges?: NodeGraphEdge<TPayload>[];
};

export type NodeGraph = {
  initial: string;
  nodes: Record<string, NodeGraphNode<any>>;
};

export type NodeHandler<TInput = unknown, TPayload = unknown> = (params: {
  nodeId: string;
  working: Readonly<NodeRunnerWorkingContext<TInput>>;
}) => Promise<NodeResult<TPayload>>;

export type NodeRunnerSpec<TInput = unknown> = {
  graph: NodeGraph;
  handlers: Record<string, NodeHandler<TInput, any>>;
  timeoutMs?: number;
};

export type NodeRunHistoryEntry = {
  nodeId: string;
  nodeStatus: NodeStatus;
  attemptCount: number;
  nextNodeId?: string;
  note?: string;
  startedAt: string;
  finishedAt: string;
};

export type NodeGraphRunResult<TInput = unknown> = {
  finalNodeId: string;
  working: NodeRunnerWorkingContext<TInput>;
  history: NodeRunHistoryEntry[];
};

export type NodeFailurePacket<TInput = unknown> = {
  nodeId: string;
  nodeKey: string;
  label?: string;
  attemptCount: number;
  retryBudget?: number;
  status: Exclude<NodeStatus, "completed">;
  note?: string;
  payload?: unknown;
  threw: boolean;
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
  input: TInput;
};

export type NodeFailureResolverInput<TInput = unknown> = {
  nodeId: string;
  nodeKey: string;
  label?: string;
  attemptCount: number;
  retryBudget?: number;
  input: TInput;
  working: NodeRunnerWorkingContext<TInput>;
  failedResult: NodeResult<unknown>;
  threw: boolean;
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
  failurePacket: NodeFailurePacket<TInput>;
};

export type NodeFailureResolution =
  | {
      disposition: "doctor_artifacts" | "continue_partial";
      replacementResult: NodeResult<unknown>;
      repairedArtifacts?: unknown[];
      rationale: string;
    }
  | {
      disposition: "retry_node";
      retryInstructions: string;
      rationale: string;
    }
  | {
      disposition: "hard_fail";
      rationale: string;
    };

export type NodeFailureResolver<TInput = unknown> = {
  resolveFailure(input: NodeFailureResolverInput<TInput>): Promise<NodeFailureResolution>;
};
