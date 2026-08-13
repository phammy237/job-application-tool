import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { jobPlatformTypeSchema } from './job';

export const jobSnapshotWorkModeSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE']);
export type JobSnapshotWorkMode = z.infer<typeof jobSnapshotWorkModeSchema>;

/**
 * The persisted `job_snapshots` row shape (docs/DATA_MODEL.md). Immutable once written — see
 * packages/database's job-snapshots.ts and the migration 0010 header comment for the database-
 * level enforcement. `location`/`employmentType`/salary/work-mode/etc. are nullable because the
 * current extractor doesn't populate all of them yet (see docs/IMPLEMENTATION_PLAN.md's Phase 5A
 * field-source audit) — not a schema gap, a documented, honest extraction limitation.
 */
export const jobSnapshotSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  sourceJobId: uuidSchema,
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullable(),
  employmentType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  description: z.string().nullable(),
  requiredQualifications: z.array(z.string()),
  preferredQualifications: z.array(z.string()),
  responsibilities: z.array(z.string()),
  skills: z.array(z.string()),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  locations: z.array(z.string()),
  workMode: jobSnapshotWorkModeSchema.nullable(),
  remoteLocationRestrictions: z.string().nullable(),
  workAuthorizationLanguage: z.string().nullable(),
  sourceType: jobPlatformTypeSchema.nullable(),
  contentFingerprint: z.string().min(1),
  contentTruncated: z.boolean(),
  truncatedFields: z.array(z.string()),
  capturedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;
