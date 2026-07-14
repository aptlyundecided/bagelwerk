import { createPlatformTourPresenterStore, type PlatformTourPresenterMetadata, type PlatformTourPresenterStore } from "./platformTourPresenterStore";
import type { PresenterAction, PresenterStepView } from "./platformTourPresenter";

type InkApp = {
  waitUntilExit(): Promise<void>;
  waitUntilRenderFlush(): Promise<void>;
  rerender(node: unknown): void;
  unmount(): void;
};

type ViewProps = { store: PlatformTourPresenterStore; openFile?: (filePath: string) => void; revision: number };

type PresenterRuntimeModule = {
  renderPlatformTourPresenterView(props: ViewProps): InkApp;
  rerenderPlatformTourPresenterView(app: InkApp, props: ViewProps): void;
};

export type PlatformTourPresenterInk = {
  present: (step: PresenterStepView) => void;
  waitForAction: (step: PresenterStepView) => Promise<PresenterAction>;
  finish: (status: "completed" | "failed" | "quit", svgPath?: string) => void;
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
};

export async function createPlatformTourPresenterInk(args: {
  metadata?: PlatformTourPresenterMetadata;
  openFile?: (filePath: string) => void;
}): Promise<PlatformTourPresenterInk> {
  const store = createPlatformTourPresenterStore(args.metadata);
  const runtimeModulePath = "./PlatformTourPresenterView.mts";
  const runtime = (await import(runtimeModulePath)) as PresenterRuntimeModule;

  let revision = 0;
  const viewProps = (): ViewProps => ({ store, ...(args.openFile ? { openFile: args.openFile } : {}), revision });
  const app = runtime.renderPlatformTourPresenterView(viewProps());

  const flush = createFlushScheduler(app);
  const rerender = () => {
    revision += 1;
    runtime.rerenderPlatformTourPresenterView(app, viewProps());
    flush();
  };
  store.subscribe(rerender);
  const keepAlive = setInterval(rerender, 250);

  await Promise.race([app.waitUntilRenderFlush(), delay(150)]);

  return {
    present: (step) => store.present(step),
    waitForAction: (step) => store.waitForAction(step),
    finish: (status, svgPath) => store.finish(status, svgPath),
    waitUntilExit: async () => {
      try {
        await app.waitUntilExit();
      } finally {
        clearInterval(keepAlive);
      }
    },
    unmount: () => {
      clearInterval(keepAlive);
      app.unmount();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFlushScheduler(app: InkApp): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    void app.waitUntilRenderFlush().finally(() => {
      pending = false;
    });
  };
}
