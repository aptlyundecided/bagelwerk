export const DEFAULT_MAX_CONCURRENT_AGENT_JOBS = 2;
export const DEFAULT_AGENT_START_SPACING_MS = 500;

export type AgentConcurrencyGateOptions = {
  maxConcurrent?: number;
  minStartSpacingMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type QueuedAgentJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) return fallback;
  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback;
  return Math.floor(value);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AgentConcurrencyGate = {
  run<T>(task: () => Promise<T>): Promise<T>;
  snapshot(): { active: number; queued: number; maxConcurrent: number; minStartSpacingMs: number };
};

export function createAgentConcurrencyGate(options: AgentConcurrencyGateOptions = {}): AgentConcurrencyGate {
  const maxConcurrent = normalizePositiveInteger(options.maxConcurrent, DEFAULT_MAX_CONCURRENT_AGENT_JOBS);
  const minStartSpacingMs = normalizeNonNegativeInteger(options.minStartSpacingMs, DEFAULT_AGENT_START_SPACING_MS);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const queue: Array<QueuedAgentJob<unknown>> = [];
  let active = 0;
  let draining = false;
  let nextStartAt = 0;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && active < maxConcurrent) {
        const waitMs = Math.max(0, nextStartAt - now());
        if (waitMs > 0) {
          await sleep(waitMs);
          continue;
        }

        const entry = queue.shift();
        if (!entry) continue;
        active += 1;
        nextStartAt = now() + minStartSpacingMs;
        void entry.run()
          .then(entry.resolve, entry.reject)
          .finally(() => {
            active -= 1;
            void drain();
          });
      }
    } finally {
      draining = false;
      if (queue.length > 0 && active < maxConcurrent) void drain();
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({ run: task, resolve: resolve as (value: unknown) => void, reject });
        void drain();
      });
    },
    snapshot() {
      return { active, queued: queue.length, maxConcurrent, minStartSpacingMs };
    },
  };
}

export const skillBackedAgentGate = createAgentConcurrencyGate();

export function runWithSkillBackedAgentSlot<T>(task: () => Promise<T>): Promise<T> {
  return skillBackedAgentGate.run(task);
}
