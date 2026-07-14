import type { ExecutionPolicyRunOverlay } from "../flows/config";
import type { NodeRegistry } from "../nodes/config";
import type { FlowRunnerEventSink } from "./events";
import type {
  FlowRunnerExecutionPlan,
  FlowRunnerFlowRunResult,
  FlowRunnerMiddleware,
  FlowRunnerNodeRunResult,
  FlowRunnerResumePolicy,
  FlowRunnerUnhandledFailureResolver,
} from "./flowRunnerCore";

export type ExternalFlowRequirementMetadata = {
  network?: boolean;
  agentRuntime?: string;
  secrets?: string[];
  writesDurableState?: boolean;
  estimatedDurationMinutes?: number;
};

export type ExternalFlowPromptKind = "text" | "number" | "confirm" | "path" | "select";

export type ExternalFlowInputPrompt = {
  key: string;
  kind: ExternalFlowPromptKind;
  label: string;
  default?: unknown;
  required?: boolean;
  choices?: Array<{ label: string; value?: unknown }>;
  min?: number;
  max?: number;
};

export type ExternalFlowSupervisorDefaults = {
  runMode?: "advanced" | "local" | "managed-worktree" | "sandbox";
  targetWorkspace?: string;
  allowDirtyWorktree?: boolean;
  sessionPrefix?: string;
};

export type ExternalFlowRunProfile = {
  id: string;
  label: string;
  description?: string;
  inputDefaults?: Record<string, unknown>;
  executionPlan?: FlowRunnerExecutionPlan;
};

export type ExternalFlowCatalogSource = {
  kind: "cwd" | "flow-library" | "configured-root";
  root: string;
  configPath: string;
};

export type ExternalFlowBinding = {
  flow: unknown;
  configuredNodes: unknown[];
  nodeRegistry: NodeRegistry;
  workspaceName?: string;
  label?: string;
  description?: string;
  aliases?: string[];
  requirements?: ExternalFlowRequirementMetadata;
  prompts?: ExternalFlowInputPrompt[];
  supervisor?: ExternalFlowSupervisorDefaults;
  profiles?: ExternalFlowRunProfile[];
};

export type ExternalFlowCatalogEntry = {
  id: string;
  localId: string;
  namespace: string;
  aliases: string[];
  label: string;
  description?: string;
  cwd: string;
  modulePath: string;
  exportName: string;
  workspaceName: string;
  source: ExternalFlowCatalogSource;
  requirements?: ExternalFlowRequirementMetadata;
  prompts?: ExternalFlowInputPrompt[];
  supervisor?: ExternalFlowSupervisorDefaults;
  profiles?: ExternalFlowRunProfile[];
};

export type FlowRunnerInput = Record<string, unknown>;

export type RunExternalFlowParams<TInput = FlowRunnerInput> = {
  cwd?: string;
  flowId: string;
  sessionId: string;
  input?: TInput;
  artifactRoot?: string;
  acceptedByKind?: "user" | "agent";
  acceptedById?: string;
  resume?: FlowRunnerResumePolicy;
  executionPlan?: FlowRunnerExecutionPlan;
  executionPolicyOverlay?: ExecutionPolicyRunOverlay;
  unhandledFailureResolver?: FlowRunnerUnhandledFailureResolver<TInput>;
  log?: (line: string) => void;
  onEvent?: FlowRunnerEventSink;
  middlewares?: FlowRunnerMiddleware<TInput>[];
};

export type RunExternalNodeParams<TInput = FlowRunnerInput> = RunExternalFlowParams<TInput> & {
  qualifiedNodePath: string;
};

export type RunExternalFlowResult<TInput = FlowRunnerInput> = {
  catalogEntry: ExternalFlowCatalogEntry;
  run: FlowRunnerFlowRunResult<TInput>;
};

export type RunExternalNodeResult<TInput = FlowRunnerInput> = {
  catalogEntry: ExternalFlowCatalogEntry;
  run: FlowRunnerNodeRunResult<TInput>;
};
