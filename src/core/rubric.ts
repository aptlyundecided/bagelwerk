import { z } from 'zod';

/** Criteria are data. The evaluator is chosen when grading, not when running. */
export const RubricSchema = z.object({
  criteria: z.array(z.string().trim().min(1)).min(1),
});
export type Rubric = z.infer<typeof RubricSchema>;
