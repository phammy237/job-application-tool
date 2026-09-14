import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * The `resume_uploads` table (renamed from `resumes` in migration 0020 — see that migration's
 * own comment for why) — an uploaded résumé *file* awaiting a future Claude extraction pipeline
 * into `candidate_facts` (docs/USER_FLOWS.md §1). This is a distinct concept from
 * `@career-os/shared`'s `Resume`/`ResumeVersion` (Phase 7A's logical résumé identity + immutable
 * version history) — this table has no writer anywhere in this codebase yet; upload UI and
 * extraction still land in a later phase.
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
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ResumeUpload = z.infer<typeof resumeUploadSchema>;
