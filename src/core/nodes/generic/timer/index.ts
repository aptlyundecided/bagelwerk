import { z } from "zod";

import type { NodeResult } from "../../graph";
import type { NodeTypeEntry } from "../../config";

export type TimerNodeParams = {
  delayMs: number;
  message: string;
};

export type TimerNodePayload = {
  message: string;
  delayMs: number;
  startedAt: string;
  finishedAt: string;
};

export const TimerNodeParamsSchema = z.object({
  delayMs: z.number().int().min(0).max(60_000),
  message: z.string().trim().min(1),
});

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runTimerNode(params: TimerNodeParams): Promise<NodeResult<TimerNodePayload>> {
  const startedAt = new Date().toISOString();
  await sleep(params.delayMs);
  const finishedAt = new Date().toISOString();
  return {
    status: "completed",
    payload: {
      message: params.message,
      delayMs: params.delayMs,
      startedAt,
      finishedAt,
    },
    note: params.message,
  };
}

export const coreTimerNodeTypeEntry: NodeTypeEntry<TimerNodeParams, unknown, TimerNodePayload> = {
  nodeType: "core.timer",
  label: "Core Timer",
  validateParams: (value: unknown) => TimerNodeParamsSchema.parse(value),
  execute: async ({ params }) => runTimerNode(params),
};
