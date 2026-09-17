import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * The `resume_uploads` table (renamed from `resumes` in migration 0020 — see that migration's
 * own comment for why) — an uploaded résumé *file*, extracted for review by the Resume Import
 * pipeline (migration 0034, Phase B of the onboarding-path hardening pass). This is a distinct
 * concept from `@career-os/shared`'s `Resume`/`ResumeVersion` (Phase 7A's logical résumé
 * identity + immutable version history) — this table only ever tracks the uploaded file itself,
 * never structured candidate content (that's extracted fresh into client state for review, then
 * written straight into the existing Candidate Profile tables on confirmation — never a second
 * "resume facts" data model).
 */
export const resumeExtractionStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETE',
  'FAILED',
]);
export type ResumeExtractionStatus = z.infer<typeof resumeExtractionStatusSchema>;

export const resumeUploadSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  label: z.string().nullable(),
  isPrimary: z.boolean().default(false),
  extractionStatus: resumeExtractionStatusSchema.default('PENDING'),
  extractedAt: isoDateTimeSchema.nullable(),
  /** Added in migration 0034 (Phase B) — same missing-key-on-an-unmigrated-database reasoning
   * the rest of this codebase's later-added columns already use (see applicationSchema's
   * jobCatalogId for the canonical example). Null for the handful of rows created before this
   * column existed (none in any real environment — this table had zero writers until now). */
  contentHash: z.string().nullable().default(null),
  contentType: z.string().nullable().default(null),
  fileSizeBytes: z.number().int().positive().nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ResumeUpload = z.infer<typeof resumeUploadSchema>;
