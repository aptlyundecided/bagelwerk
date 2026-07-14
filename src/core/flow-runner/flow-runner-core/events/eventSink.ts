import { flowRunnerEventLine, type FlowRunnerEvent, type FlowRunnerEventSink } from "../../events";

export function emitFlowRunnerEvent(args: {
  events: FlowRunnerEvent[];
  event: FlowRunnerEvent;
  onEvent?: FlowRunnerEventSink;
  log?: (line: string) => void;
}): void {
  args.events.push(args.event);
  args.onEvent?.(args.event);
  args.log?.(flowRunnerEventLine(args.event));
}
