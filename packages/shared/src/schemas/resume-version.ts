import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * What a résumé version's content actually is, right now — a real, narrow enum, not a
 * speculative one. `METADATA_ONLY` is this phase's only truthful value: this codebase has no
 * structured résumé content, no LaTeX, and no wired uploaded-file/extraction pipeline yet, so a
 * version's identity (name/number/timestamp) is real and permanent, but there is no actual
 * document content to snapshot. A later phase adds real content formats (e.g. `STRUCTURED_V1`,
 * `LATEX_V1`) — this union only grows to describe formats that actually exist, never in advance
 * of them (docs/IMPLEMENTATION_PLAN.md "Phase 7A").
 */
export const resumeSnapshotFormatSchema = z.enum(['METADATA_ONLY']);
export type ResumeSnapshotFormat = z.infer<typeof resumeSnapshotFormatSchema>;

/**
 * `public.resume_versions` (migration 0020) — an immutable snapshot of one `Resume`'s state.
 * Editing a résumé always creates a new version; nothing ever updates a version's own row in
 * place (database-enforced, not just convention — see that migration's block-update trigger).
 */
export const resumeVersionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  resumeId: uuidSchema,
  versionNumber: z.number().int().positive(),
  displayName: z.string().min(1),
  snapshotFormat: resumeSnapshotFormatSchema,
  /** Always null while `snapshotFormat` is `METADATA_ONLY` (database-enforced) — never a
   * fabricated placeholder standing in for content that doesn't exist yet. */
  snapshotPayload: z.unknown().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ResumeVersion = z.infer<typeof resumeVersionSchema>;

export const createResumeVersionInputSchema = z.object({
  resumeId: uuidSchema,
  displayName: z.string().min(1, 'Display name is required'),
});
export type CreateResumeVersionInput = z.infer<typeof createResumeVersionInputSchema>;
