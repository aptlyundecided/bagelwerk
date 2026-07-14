import { z } from "zod";

import type { SkillBackedAgentRuntime } from "../../agent-execution";

export const AgentExecutionPolicySchema = z.object({
  runtime: z.enum(["pi", "cursor", "claude-code", "opencode"]).optional(),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  openCodeAgent: z.string().trim().min(1).optional(),
  openCodeSkipPermissions: z.boolean().optional(),
});

export const ExecutionPolicySchema = z.object({
  agent: AgentExecutionPolicySchema.optional(),
});

export const ExecutionPolicyRunOverlaySchema = ExecutionPolicySchema.extend({
  paths: z.record(ExecutionPolicySchema).optional(),
});

export type AgentExecutionPolicy = {
  runtime?: SkillBackedAgentRuntime;
  provider?: string;
  model?: string;
  openCodeAgent?: string;
  openCodeSkipPermissions?: boolean;
};

export type ExecutionPolicy = {
  agent?: AgentExecutionPolicy;
};

export type ExecutionPolicyRunOverlay = ExecutionPolicy & {
  paths?: Record<string, ExecutionPolicy>;
};

export type ExecutionPolicySource = {
  kind: "flow" | "run-overlay";
  path: string;
};

function hasAgentPolicy(policy: AgentExecutionPolicy | undefined): boolean {
  return Boolean(policy && Object.values(policy).some((value) => value !== undefined));
}

export function hasExecutionPolicy(policy: ExecutionPolicy | undefined): boolean {
  return Boolean(policy && hasAgentPolicy(policy.agent));
}

export function parseExecutionPolicy(value: unknown): ExecutionPolicy {
  return ExecutionPolicySchema.parse(value);
}

export function parseOptionalExecutionPolicy(value: unknown): ExecutionPolicy | undefined {
  if (value === undefined) return undefined;
  const parsed = parseExecutionPolicy(value);
  return hasExecutionPolicy(parsed) ? parsed : undefined;
}

export function parseExecutionPolicyRunOverlay(value: unknown): ExecutionPolicyRunOverlay | undefined {
  if (value === undefined) return undefined;
  const parsed = ExecutionPolicyRunOverlaySchema.parse(value);
  const paths = parsed.paths
    ? Object.fromEntries(Object.entries(parsed.paths).filter(([, policy]) => hasExecutionPolicy(policy)))
    : undefined;
  const overlay: ExecutionPolicyRunOverlay = {
    ...(parsed.agent && hasAgentPolicy(parsed.agent) ? { agent: parsed.agent } : {}),
    ...(paths && Object.keys(paths).length > 0 ? { paths } : {}),
  };
  return hasExecutionPolicy(overlay) || Object.keys(overlay.paths ?? {}).length > 0 ? overlay : undefined;
}

export function mergeExecutionPolicy(base: ExecutionPolicy | undefined, override: ExecutionPolicy | undefined): ExecutionPolicy | undefined {
  if (!base && !override) return undefined;
  const agent = {
    ...(base?.agent ?? {}),
    ...(override?.agent ?? {}),
  };
  const merged: ExecutionPolicy = {
    ...(hasAgentPolicy(agent) ? { agent } : {}),
  };
  return hasExecutionPolicy(merged) ? merged : undefined;
}

export function policyWithoutOverlayPaths(overlay: ExecutionPolicyRunOverlay | undefined): ExecutionPolicy | undefined {
  if (!overlay) return undefined;
  return hasExecutionPolicy(overlay) ? { ...(overlay.agent ? { agent: overlay.agent } : {}) } : undefined;
}

export function withExecutionPolicy<TFlow extends { executionPolicy?: ExecutionPolicy }>(policy: ExecutionPolicy, flow: TFlow): TFlow {
  const parsed = parseExecutionPolicy(policy);
  return {
    ...flow,
    ...(hasExecutionPolicy(parsed) ? { executionPolicy: mergeExecutionPolicy(flow.executionPolicy, parsed) } : {}),
  };
}
