import type { PresenterAction, PresenterStepView } from "./platformTourPresenter";

export type PlatformTourPresenterMetadata = { sessionId?: string; artifactRoot?: string; title?: string };

export type PlatformTourPresenterSnapshot = {
  metadata: PlatformTourPresenterMetadata;
  step?: PresenterStepView;
  /** True while the driver is blocked at a gate waiting for the user's action. */
  awaiting: boolean;
  closed: boolean;
  finished?: "completed" | "failed" | "quit";
  svgPath?: string;
  /** Epoch ms when the current "running" phase began; drives the timer countdown. */
  runStartedAt?: number;
};

export type PlatformTourPresenterStore = {
  getSnapshot(): PlatformTourPresenterSnapshot;
  subscribe(listener: () => void): () => void;
  /** Push the current visual state (non-blocking). */
  present(step: PresenterStepView): void;
  /** Block at a gate until the user resolves an action. */
  waitForAction(step: PresenterStepView): Promise<PresenterAction>;
  resolveAction(action: PresenterAction): void;
  finish(status: "completed" | "failed" | "quit", svgPath?: string): void;
};

export function createPlatformTourPresenterStore(metadata: PlatformTourPresenterMetadata = {}): PlatformTourPresenterStore {
  let snapshot: PlatformTourPresenterSnapshot = { metadata, awaiting: false, closed: false };
  const listeners = new Set<() => void>();
  let resolver: ((action: PresenterAction) => void) | undefined;

  const notify = () => listeners.forEach((listener) => listener());
  const set = (patch: Partial<PlatformTourPresenterSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    present(step) {
      set({ step, awaiting: false, runStartedAt: step.phase === "running" ? Date.now() : undefined });
    },
    waitForAction(step) {
      set({ step, awaiting: true });
      return new Promise<PresenterAction>((resolve) => {
        resolver = resolve;
      });
    },
    resolveAction(action) {
      if (!resolver) return;
      const resolve = resolver;
      resolver = undefined;
      set({ awaiting: false });
      resolve(action);
    },
    finish(status, svgPath) {
      set({ closed: true, finished: status, awaiting: false, ...(svgPath ? { svgPath } : {}) });
    },
  };
}
