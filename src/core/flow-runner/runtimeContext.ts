import type { FlowRunnerEvent, FlowRunnerEventSink } from "./events";
import type { FlowRunnerLaunchSnapshot, FlowRunnerNodeRunRecord } from "./runRecords";

export type FlowRunnerPreflightDependency = {
  fromQualifiedPath: string;
  relativePath: string;
  label?: string;
  required: boolean;
  acceptedPath: string;
  exists: boolean;
  resolvedFromQualifiedPath?: string;
  aliasResolved?: boolean;
};

export type FlowRunnerRuntimeEventSink = FlowRunnerEventSink;

export type FlowRunnerRuntimeContext = {
  workspaceRoot: string;
  sessionId: string;
  record: FlowRunnerNodeRunRecord;
  launchSnapshot: FlowRunnerLaunchSnapshot;
  preflight: {
    dependencies: FlowRunnerPreflightDependency[];
  };
  emitEvent?: FlowRunnerRuntimeEventSink;
  forwardChildEvent?: (source: string, event: FlowRunnerEvent | unknown) => void;
};

export type FlowRunnerNodeExecutionInput<TUserInput> = {
  userInput: TUserInput;
  runtime: FlowRunnerRuntimeContext;
};

export function createFlowRunnerNodeExecutionInput<TUserInput>(params: {
  userInput: TUserInput;
  runtime: FlowRunnerRuntimeContext;
}): FlowRunnerNodeExecutionInput<TUserInput> {
  return {
    userInput: params.userInput,
    runtime: params.runtime,
  };
}
