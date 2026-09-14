import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { structuredResumeV1Schema } from './resume-content';

/**
 * What a résumé version's content actually is — a real, narrow enum, widened additively as real
 * formats come into existence (migration 0022 added `STRUCTURED_V1`; docs/IMPLEMENTATION_PLAN.md
 * "Phase 7A" originally shipped only `METADATA_ONLY`). `METADATA_ONLY` means "this version's
 * identity (name/number/timestamp) is real and permanent; its document content does not exist" —
 * still true for every version created before Phase 7C. `STRUCTURED_V1` means the payload is a
 * real `StructuredResumeV1` document. Never add a value here in advance of the format it
 * describes actually existing.
 */
export const resumeSnapshotFormatSchema = z.enum(['METADATA_ONLY', 'STRUCTURED_V1']);
export type ResumeSnapshotFormat = z.infer<typeof resumeSnapshotFormatSchema>;

const resumeVersionCommonFieldsSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  resumeId: uuidSchema,
  versionNumber: z.number().int().positive(),
  displayName: z.string().min(1),
  createdAt: isoDateTimeSchema,
});

/**
 * `public.resume_versions` (migration 0020) — an immutable snapshot of one `Resume`'s state.
 * Editing a résumé always creates a new version; nothing ever updates a version's own row in
 * place (database-enforced, not just convention — see that migration's block-update trigger).
 *
 * A discriminated union on `snapshotFormat`, not a flat `snapshotPayload: unknown` — this is what
 * makes "a version's content is self-describing, never silently reinterpreted" (migration 0022's
 * own design goal) hold at the type level too: every call site that narrows on `snapshotFormat`
 * gets `snapshotPayload` typed exactly (`null`, or a real `StructuredResumeV1`), never a manual
 * cast.
 */
export const resumeVersionSchema = z.discriminatedUnion('snapshotFormat', [
  resumeVersionCommonFieldsSchema.extend({
    snapshotFormat: z.literal('METADATA_ONLY'),
    snapshotPayload: z.null(),
  }),
  resumeVersionCommonFieldsSchema.extend({
    snapshotFormat: z.literal('STRUCTURED_V1'),
    snapshotPayload: structuredResumeV1Schema,
  }),
]);
export type ResumeVersion = z.infer<typeof resumeVersionSchema>;

export const createResumeVersionInputSchema = z.object({
  resumeId: uuidSchema,
  displayName: z.string().min(1, 'Display name is required'),
});
export type CreateResumeVersionInput = z.infer<typeof createResumeVersionInputSchema>;
