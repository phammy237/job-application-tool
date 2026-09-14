import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * `public.resumes` (migration 0020, Phase 7A) — logical résumé *identity*: a name, a kind, and
 * optional lineage back to the user's master résumé. Carries no document content of its own —
 * every actual snapshot of a résumé's content lives in `ResumeVersion` (`resume-version.ts`),
 * immutable, one-to-many under this row. Not to be confused with `ResumeUpload`
 * (`resume-upload.ts`), the unrelated uploaded-file-awaiting-extraction concept this table's name
 * was freed from by the same migration.
 */
export const resumeKindSchema = z.enum(['MASTER', 'TAILORED']);
export type ResumeKind = z.infer<typeof resumeKindSchema>;
export const RESUME_KINDS = resumeKindSchema.options;

export const resumeSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1),
  kind: resumeKindSchema,
  /** Null for a MASTER resume (database-enforced, migration 0020's
   * `resumes_master_has_no_parent` check) and for a TAILORED resume with no recorded lineage.
   * When set, always points at a MASTER resume owned by the same user — enforced by a trigger,
   * not just application code (migration 0020's `enforce_resume_parent_is_master`). */
  parentResumeId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Resume = z.infer<typeof resumeSchema>;

export const createResumeInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: resumeKindSchema,
  parentResumeId: uuidSchema.nullable().optional(),
});
export type CreateResumeInput = z.infer<typeof createResumeInputSchema>;

export const updateResumeInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});
export type UpdateResumeInput = z.infer<typeof updateResumeInputSchema>;
