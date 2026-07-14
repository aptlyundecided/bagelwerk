import { z } from "zod";

export const PlatformTourInputSchema = z
  .object({
    operatorName: z.string().trim().optional(),
  })
  .passthrough();

export type PlatformTourInput = z.infer<typeof PlatformTourInputSchema>;

/**
 * Shared payload shape for every tour Node. `finalVerdict`/`acceptEligible` are
 * descriptive metadata carried in the payload; the Flow Runner drives acceptance
 * from each Node's `status` and the run-level acceptance policy.
 */
export type TourArtifactPayload<TArtifact = unknown> = {
  finalVerdict: string;
  acceptEligible: boolean;
  artifact: TArtifact;
  artifactFiles: Array<{ key?: string; label: string; path: string; relativePath?: string; required?: boolean }>;
};
