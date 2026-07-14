import type { FlowRunnerMiddleware } from "./middleware";

export type FlowRunnerProgressMiddlewareOptions = {
  log?: (line: string) => void;
};

export function createFlowRunnerConsoleProgressMiddleware<TInput = unknown>(options: FlowRunnerProgressMiddlewareOptions = {}): FlowRunnerMiddleware<TInput> {
  const log = options.log ?? console.error;
  return {
    name: "console-progress",
    beforeFlow(context) {
      log(`⬢ FLOW start ${context.flowId} mode=${context.mode}`);
    },
    afterFlow(context) {
      log(`⬢ FLOW complete ${context.flowId} status=${context.runTree.status}`);
    },
    beforeNode(context) {
      log(`◉ NODE enter ${context.qualifiedNodePath}`);
    },
    afterNode(context) {
      const status = context.result?.status ?? "unknown";
      log(`◉ NODE exit ${context.qualifiedNodePath} status=${status}${context.accepted ? " accepted=true" : ""}`);
      if (context.result?.note) log(`  note: ${context.result.note}`);
    },
    onNodeCrash(context) {
      log(`✖ NODE crash ${context.qualifiedNodePath}: ${context.error instanceof Error ? context.error.message : String(context.error)}`);
    },
    afterTransition(context) {
      log(`↳ TRANSITION ${context.fromQualifiedNodePath} -> ${context.toQualifiedNodePath ?? "<end>"} status=${context.status}`);
    },
  };
}
