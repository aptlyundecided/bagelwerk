import { z } from "zod";

export const ConfiguredNodeSpecSchema = z.object({
  nodeId: z.string().trim().min(1, "Configured node nodeId must not be empty."),
  nodeType: z.string().trim().min(1, "Configured node nodeType must not be empty."),
  name: z.string().trim().min(1, "Configured node name must not be empty."),
  description: z.string().trim().min(1, "Configured node description must not be empty."),
  createdAt: z.string().trim().min(1, "Configured node createdAt must not be empty."),
  updatedAt: z.string().trim().min(1, "Configured node updatedAt must not be empty."),
  params: z.unknown(),
  tags: z.array(z.string().trim().min(1)).optional(),
  status: z.enum(["draft", "active", "deprecated"]).optional(),
});

export type ConfiguredNodeSpec = z.infer<typeof ConfiguredNodeSpecSchema>;

export function parseConfiguredNodeSpec(value: unknown): ConfiguredNodeSpec {
  return ConfiguredNodeSpecSchema.parse(value);
}
