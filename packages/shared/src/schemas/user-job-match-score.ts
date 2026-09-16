import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { eligibilityCheckSchema, eligibilityStatusSchema } from './eligibility-check';
import { scoringCriterionSchema } from './discovery-scoring-profile';

/** Per-criterion detail preserved so a score can be reproduced/explained exactly (docs/
 * JOB_DISCOVERY.md "Match-score math") — enough for D5's "See details" without recomputation. */
export const scoreComponentSchema = z.object({
  criterion: scoringCriterionSchema,
  weight: z.number().int().min(0).max(10),
  known: z.boolean(),
  fit: z.number().min(0).max(1).nullable(),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

/**
 * The persisted `user_job_match_scores` row (docs/JOB_DISCOVERY.md "Persistence"). `matchScore`
 * (0-100) and `coverage` (0-100, data coverage — NOT statistical confidence) are separate numbers
 * by design; `eligibilityStatus` is separate again. `rankingVersion`/`featureVersion` are stamped
 * from the values active at compute time so a stale row is always identifiable and recomputable.
 */
export const userJobMatchScoreSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  jobCatalogId: uuidSchema,
  matchScore: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100),
  eligibilityStatus: eligibilityStatusSchema,
  scoreComponents: z.array(scoreComponentSchema),
  eligibilityChecks: z.array(eligibilityCheckSchema),
  rankingVersion: z.string().min(1),
  featureVersion: z.string().min(1),
  eligibilityVersion: z.string().min(1),
  computedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type UserJobMatchScore = z.infer<typeof userJobMatchScoreSchema>;
