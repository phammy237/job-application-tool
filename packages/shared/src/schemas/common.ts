import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Nullable ISO date (no time component), e.g. "2026-05-01". */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date (YYYY-MM-DD)');

export const tagsSchema = z.array(z.string().min(1)).default([]);

/**
 * Every approvable record (candidate_facts and the structured experience/education/
 * project/skill tables) carries these three flags independently. See docs/DATA_MODEL.md
 * "Two-layer fact model" and docs/AI_GROUNDING.md — packages/ai and any autofill path must
 * filter on userApproved && approvedForApplications before using a record.
 */
export const approvalFieldsSchema = z.object({
  userApproved: z.boolean().default(false),
  approvedForApplications: z.boolean().default(false),
  visibleOnPublicProfile: z.boolean().default(false),
});
export type ApprovalFields = z.infer<typeof approvalFieldsSchema>;

export const timestampFieldsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TimestampFields = z.infer<typeof timestampFieldsSchema>;
