import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/** Matches docs/DATA_MODEL.md `applications.status` and docs/PRODUCT_SPEC.md §7. */
export const applicationStatusSchema = z.enum([
  'SAVED',
  'IN_PROGRESS',
  'APPLIED',
  'APPLICATION_RECEIVED',
  'ASSESSMENT',
  'INTERVIEW',
  'ACTION_REQUIRED',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'UNKNOWN',
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const APPLICATION_STATUSES = applicationStatusSchema.options;

export const applicationSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  jobId: uuidSchema.nullable(),
  resumeId: uuidSchema.nullable(),
  company: z.string().min(1),
  title: z.string().min(1),
  status: applicationStatusSchema.default('SAVED'),
  notes: z.string().nullable(),
  appliedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Application = z.infer<typeof applicationSchema>;

/** Manual creation from the dashboard — Phase 1 has no extension, so jobId/resumeId are optional. */
export const applicationInputSchema = z.object({
  company: z.string().min(1, 'Company is required'),
  title: z.string().min(1, 'Title is required'),
  status: applicationStatusSchema.default('SAVED'),
  notes: z.string().nullable().optional(),
  resumeId: uuidSchema.nullable().optional(),
  appliedAt: isoDateTimeSchema.nullable().optional(),
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;

export const applicationUpdateSchema = applicationInputSchema.partial();
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
