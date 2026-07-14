import { z } from "zod";

import { ExecutionPolicySchema, type ExecutionPolicy } from "./executionPolicy";

const FlowNodeAcceptedArtifactRefSchema = z.object({
  from: z.string().trim().min(1, "Flow node accepted-artifact source must not be empty."),
  relativePath: z.string().trim().min(1, "Flow node accepted-artifact relativePath must not be empty."),
  label: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
});

const FlowNodeRefSchema = z.object({
  nodeId: z.string().trim().min(1, "Flow node reference must declare nodeId."),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  acceptedArtifacts: z.array(FlowNodeAcceptedArtifactRefSchema).default([]),
});

const FlowEdgeSchema = z.object({
  from: z.string().trim().min(1, "Flow edge source must not be empty."),
  to: z.string().trim().min(1, "Flow edge target must not be empty."),
  on: z.enum(["completed", "failed", "timed_out"]).default("completed"),
  label: z.string().trim().min(1).optional(),
});

export type ConfiguredFlowNodeAcceptedArtifactRef = {
  from: string;
  relativePath: string;
  label?: string;
  required?: boolean;
};

export type ConfiguredFlowNodeRef = {
  nodeId: string;
  name?: string;
  description?: string;
  acceptedArtifacts?: ConfiguredFlowNodeAcceptedArtifactRef[];
};

export type ConfiguredFlowEdge = {
  from: string;
  to: string;
  on?: "completed" | "failed" | "timed_out";
  label?: string;
};

export type ConfiguredFlowSpec = {
  flowId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  initial: string;
  nodes?: Record<string, ConfiguredFlowNodeRef>;
  flows?: Record<string, ConfiguredFlowSpec>;
  edges?: ConfiguredFlowEdge[];
  executionPolicy?: ExecutionPolicy;
};

export const ConfiguredFlowSpecSchema: z.ZodType<ConfiguredFlowSpec> = z.lazy(() =>
  z
    .object({
      flowId: z.string().trim().min(1, "Configured flow flowId must not be empty."),
      name: z.string().trim().min(1, "Configured flow name must not be empty."),
      description: z.string().trim().min(1).optional(),
      createdAt: z.string().trim().min(1, "Configured flow createdAt must not be empty."),
      updatedAt: z.string().trim().min(1, "Configured flow updatedAt must not be empty."),
      initial: z.string().trim().min(1, "Configured flow initial must not be empty."),
      nodes: z.record(FlowNodeRefSchema).default({}),
      flows: z.record(ConfiguredFlowSpecSchema).default({}),
      edges: z.array(FlowEdgeSchema).default([]),
      executionPolicy: ExecutionPolicySchema.optional(),
    })
    .superRefine((value, ctx) => {
      const localRefs = new Set<string>([
        ...Object.keys(value.nodes ?? {}),
        ...Object.keys(value.flows ?? {}),
      ]);
      if (!localRefs.has(value.initial) && !value.initial.includes(".")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Configured flow initial ref is missing: ${value.initial}`,
          path: ["initial"],
        });
      }
      for (const edge of value.edges) {
        for (const [field, ref] of [
          ["from", edge.from] as const,
          ["to", edge.to] as const,
        ]) {
          if (ref.includes(".")) continue;
          if (!localRefs.has(ref)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Configured flow edge ${field} ref is missing: ${ref}`,
              path: ["edges"],
            });
          }
        }
      }
      for (const [nodeKey, node] of Object.entries(value.nodes ?? {})) {
        for (const accepted of node.acceptedArtifacts) {
          if (accepted.from.includes(".")) continue;
          if (!localRefs.has(accepted.from)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Configured flow node '${nodeKey}' references missing accepted-artifact source '${accepted.from}'.`,
              path: ["nodes", nodeKey, "acceptedArtifacts"],
            });
          }
        }
      }
    }),
);

export const ConfiguredFlowWorkspaceSpecSchema = z.object({
  nodes: z.array(z.unknown()).default([]),
  flow: ConfiguredFlowSpecSchema,
});

export type ConfiguredFlowWorkspaceSpec = z.infer<typeof ConfiguredFlowWorkspaceSpecSchema>;

export function parseConfiguredFlowSpec(value: unknown): ConfiguredFlowSpec {
  return ConfiguredFlowSpecSchema.parse(value);
}
