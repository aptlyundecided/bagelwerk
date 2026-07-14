import type { FlowRunnerEvent, FlowRunnerEventSink } from "../../../core/flow-runner/events";
import { createFlowProgressStore, type FlowProgressStore } from "./flowProgressStore";
import type { FlowProgressGraphInit } from "./flowProgressGraph";
import type { FlowProgressMetadata } from "./flowProgressState";

type InkApp = {
  waitUntilExit(): Promise<void>;
  waitUntilRenderFlush(): Promise<void>;
  unmount(): void;
};

type FlowRunnerInkViewProps = { store: FlowProgressStore; autoExit?: boolean; revision: number };

type FlowRunnerInkRuntimeModule = {
  renderFlowRunnerInkView(props: FlowRunnerInkViewProps): InkApp;
  rerenderFlowRunnerInkView(app: InkApp, props: FlowRunnerInkViewProps): void;
};

export type RunFlowRunnerInkParams<TResult> = {
  metadata?: FlowProgressMetadata;
  graph?: FlowProgressGraphInit;
  autoExit?: boolean;
  run: (args: { onEvent: FlowRunnerEventSink; store: FlowProgressStore }) => Promise<TResult>;
};

export type RunFlowRunnerInkResult<TResult> = {
  result: TResult;
  store: FlowProgressStore;
};

export async function runFlowRunnerInk<TResult>(params: RunFlowRunnerInkParams<TResult>): Promise<RunFlowRunnerInkResult<TResult>> {
  const store = createFlowProgressStore(params.metadata);
  if (params.graph) store.initializeGraph(params.graph);
  const runtimeModulePath = "./FlowRunnerInkView.mts";
  const runtime = await import(runtimeModulePath) as FlowRunnerInkRuntimeModule;
  let revision = 0;
  const viewProps = (): FlowRunnerInkViewProps => ({ store, autoExit: params.autoExit, revision });
  const app = runtime.renderFlowRunnerInkView(viewProps());
  const rerenderInk = () => {
    revision += 1;
    runtime.rerenderFlowRunnerInkView(app, viewProps());
  };
  const flushInk = createInkFlushScheduler(app);
  const keepAlive = setInterval(() => {
    rerenderInk();
    flushInk();
  }, 250);
  try {
    await waitForInitialInkFlush(app, 150);
    const result = await params.run({
      store,
      onEvent: (event: FlowRunnerEvent) => {
        store.appendFlowRunnerEvent(event);
        rerenderInk();
        flushInk();
      },
    });
    store.close();
    rerenderInk();
    flushInk();
    await app.waitUntilExit();
    return { result, store };
  } catch (error) {
    store.close();
    rerenderInk();
    app.unmount();
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
}

async function waitForInitialInkFlush(app: InkApp, timeoutMs: number): Promise<void> {
  await Promise.race([
    app.waitUntilRenderFlush(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function createInkFlushScheduler(app: InkApp): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    void app.waitUntilRenderFlush().finally(() => {
      pending = false;
    });
  };
}
