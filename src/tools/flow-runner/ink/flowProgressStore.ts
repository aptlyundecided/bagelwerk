import type { FlowRunnerEvent } from "../../../core/flow-runner/events";
import {
  closeFlowProgressSnapshot,
  createInitialFlowProgressSnapshot,
  initializeFlowProgressGraph,
  reduceFlowProgressEvent,
  type FlowProgressEvent,
  type FlowProgressMetadata,
  type FlowProgressSnapshot,
} from "./flowProgressState";
import type { FlowProgressGraphInit } from "./flowProgressGraph";

export type FlowProgressStoreSnapshot = {
  state: FlowProgressSnapshot;
  events: readonly FlowProgressEvent[];
};

export type FlowProgressStoreListener = (snapshot: FlowProgressStoreSnapshot, event: FlowProgressEvent | undefined) => void;

export type FlowProgressStore = {
  initializeGraph(graph: FlowProgressGraphInit): void;
  append(event: FlowProgressEvent): void;
  appendFlowRunnerEvent(event: FlowRunnerEvent): void;
  getSnapshot(): FlowProgressStoreSnapshot;
  subscribe(listener: FlowProgressStoreListener, options?: { replay?: boolean }): () => void;
  close(): void;
};

export function createFlowProgressStore(metadata: FlowProgressMetadata = {}): FlowProgressStore {
  let state = createInitialFlowProgressSnapshot(metadata);
  const events: FlowProgressEvent[] = [];
  const listeners = new Set<FlowProgressStoreListener>();

  const snapshot = (): FlowProgressStoreSnapshot => ({ state, events: [...events] });
  const notify = (event: FlowProgressEvent | undefined) => {
    const current = snapshot();
    for (const listener of listeners) listener(current, event);
  };

  return {
    initializeGraph(graph) {
      if (state.closed) return;
      state = initializeFlowProgressGraph(state, graph);
      notify(undefined);
    },
    append(event) {
      if (state.closed) return;
      events.push(event);
      state = reduceFlowProgressEvent(state, event);
      notify(event);
    },
    appendFlowRunnerEvent(event) {
      this.append(event);
    },
    getSnapshot: snapshot,
    subscribe(listener, options = {}) {
      listeners.add(listener);
      if (options.replay === true) listener(snapshot(), undefined);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (state.closed) return;
      state = closeFlowProgressSnapshot(state);
      notify(undefined);
      listeners.clear();
    },
  };
}
