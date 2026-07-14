import { formatCoreRuntimeLine } from "../../terminal";

export type NodeRunMeta = {
  nodeId: string;
  label?: string;
};

export type NodeRunEvent = {
  phase: "start" | "ok" | "fail";
  nodeId: string;
  label: string;
  runId?: string;
  durationMs?: number;
  errorMessage?: string;
};

export type NodeRunnerOptions = {
  log?: (line: string) => void;
  onNodeRunEvent?: (event: NodeRunEvent) => void;
  runId?: string;
  emitNodeLines?: boolean;
};

export class NodeRunner {
  constructor(private readonly options: NodeRunnerOptions = {}) {}

  getRunId(): string | undefined {
    return this.options.runId;
  }

  private emit(line: string): void {
    const alreadyPrefixed = line.startsWith("[runId=");
    const rid = this.options.runId && !alreadyPrefixed ? `[runId=${this.options.runId}] ` : "";
    (this.options.log ?? console.log)(`${rid}${line}`);
  }

  private resolveLabel(meta: NodeRunMeta): string {
    return meta.label ?? meta.nodeId;
  }

  private eventPartial(meta: NodeRunMeta): Pick<NodeRunEvent, "nodeId" | "label" | "runId"> {
    return {
      nodeId: meta.nodeId,
      label: this.resolveLabel(meta),
      ...(this.options.runId ? { runId: this.options.runId } : {}),
    };
  }

  emitLine(line: string): void {
    this.emit(line);
  }

  async run<T>(meta: NodeRunMeta, fn: () => Promise<T>): Promise<T> {
    const label = this.resolveLabel(meta);
    if (this.options.emitNodeLines) {
      this.emit(formatCoreRuntimeLine("node", `start id=${meta.nodeId} label=${JSON.stringify(label)}`));
    }
    this.options.onNodeRunEvent?.({ phase: "start", ...this.eventPartial(meta) });

    const t0 = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - t0;
      if (this.options.emitNodeLines) {
        this.emit(formatCoreRuntimeLine("node", `ok id=${meta.nodeId} ${durationMs}ms`));
      }
      this.options.onNodeRunEvent?.({ phase: "ok", ...this.eventPartial(meta), durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this.options.emitNodeLines) {
        this.emit(formatCoreRuntimeLine("node", `fail id=${meta.nodeId} ${durationMs}ms`));
      }
      this.options.onNodeRunEvent?.({ phase: "fail", ...this.eventPartial(meta), durationMs, errorMessage });
      throw err;
    }
  }

  runSync<T>(meta: NodeRunMeta, fn: () => T): T {
    const label = this.resolveLabel(meta);
    if (this.options.emitNodeLines) {
      this.emit(formatCoreRuntimeLine("node", `start id=${meta.nodeId} label=${JSON.stringify(label)}`));
    }
    this.options.onNodeRunEvent?.({ phase: "start", ...this.eventPartial(meta) });

    const t0 = Date.now();
    try {
      const result = fn();
      const durationMs = Date.now() - t0;
      if (this.options.emitNodeLines) {
        this.emit(formatCoreRuntimeLine("node", `ok id=${meta.nodeId} ${durationMs}ms`));
      }
      this.options.onNodeRunEvent?.({ phase: "ok", ...this.eventPartial(meta), durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this.options.emitNodeLines) {
        this.emit(formatCoreRuntimeLine("node", `fail id=${meta.nodeId} ${durationMs}ms`));
      }
      this.options.onNodeRunEvent?.({ phase: "fail", ...this.eventPartial(meta), durationMs, errorMessage });
      throw err;
    }
  }
}

export function createNodeRunner(options?: NodeRunnerOptions): NodeRunner {
  return new NodeRunner(options);
}
