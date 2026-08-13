import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const requirementMappingRunStatusSchema = z.enum([
  'PENDING',
  'CURRENT',
  'SUPERSEDED',
  'FAILED',
]);
export type RequirementMappingRunStatus = z.infer<typeof requirementMappingRunStatusSchema>;

export const requirementMappingRunFailureCategorySchema = z.enum([
  'provider_error',
  'validation_failed',
  'refusal',
  'rate_limited',
]);
export type RequirementMappingRunFailureCategory = z.infer<
  typeof requirementMappingRunFailureCategorySchema
>;

/**
 * The persisted `requirement_mapping_runs` row (docs/DATA_MODEL.md). One row per generation
 * attempt — provider/model/promptVersion live here, not duplicated onto every mapping row (see
 * docs/IMPLEMENTATION_PLAN.md's round-4 addendum §3).
 */
export const requirementMappingRunSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  jobSnapshotId: uuidSchema,
  status: requirementMappingRunStatusSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  retrievalFactCount: z.number().int().min(0),
  failureCategory: requirementMappingRunFailureCategorySchema.nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  failedAt: isoDateTimeSchema.nullable(),
});
export type RequirementMappingRun = z.infer<typeof requirementMappingRunSchema>;
