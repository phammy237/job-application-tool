import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { fieldClassificationSchema } from './detected-field';
import { jobPlatformTypeSchema } from './job';

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

/**
 * Counts only, no per-field content (docs/IMPLEMENTATION_PLAN.md Phase 4C) — how many approved
 * fields existed, how many the fill engine actually wrote, how many were skipped/failed, and
 * how many still need the user's attention. Computed by the extension from its own
 * ReviewableField[]/FillResult[] state; never a full copy of either.
 */
export const autofillSummarySchema = z.object({
  approved: z.number().int().min(0),
  filled: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.number().int().min(0),
  unresolved: z.number().int().min(0),
  manual: z.number().int().min(0),
});
export type AutofillSummary = z.infer<typeof autofillSummarySchema>;

/**
 * Why a field is listed as unresolved — category-level only. SENSITIVE/UNSUPPORTED mean the
 * field structurally never gets automated (DEMOGRAPHIC/LEGAL/AUTHENTICATION, file uploads,
 * unrecognized controls); NEEDS_INPUT means the suggestion pipeline had nothing to offer;
 * FILL_FAILED means the field was approved but the Phase 4B fill engine couldn't complete it
 * (stale content, page changed, disabled/hidden/readonly, etc.) — see FillResult's status union.
 */
export const unresolvedFieldStatusSchema = z.enum([
  'SENSITIVE',
  'UNSUPPORTED',
  'NEEDS_INPUT',
  'FILL_FAILED',
]);
export type UnresolvedFieldStatus = z.infer<typeof unresolvedFieldStatusSchema>;

/**
 * A sanitized, minimal record of one still-needs-attention field — deliberately not a
 * DetectedField or ReviewableField (never persisted whole, per CLAUDE.md/Phase 4C). `label` is
 * the field's own question text as printed on the form (e.g. "Are you legally authorized to
 * work in the United States?") — the site's own copy, not anything the user typed — and
 * `reason` is always one of the fill engine's/reducer's existing category-level, value-free
 * explanation strings, never raw content.
 */
export const unresolvedFieldSummarySchema = z.object({
  label: z.string().nullable(),
  classification: fieldClassificationSchema,
  status: unresolvedFieldStatusSchema,
  reason: z.string(),
});
export type UnresolvedFieldSummary = z.infer<typeof unresolvedFieldSummarySchema>;

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
  /** Denormalized from the jobs row at save time — see docs/DATA_MODEL.md "applications". */
  sourceUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  atsProvider: jobPlatformTypeSchema.nullable(),
  externalId: z.string().nullable(),
  autofillSummary: autofillSummarySchema.nullable(),
  unresolvedFields: z.array(unresolvedFieldSummarySchema).nullable(),
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

/**
 * Wire body for POST /api/applications (the extension's Phase 4C save flow). Deliberately does
 * NOT carry company/title/location/sourceUrl — those come from the already-owned `jobs` row,
 * looked up server-side by jobId, not trusted from the client (CLAUDE.md: never accept a
 * request body's identity-bearing fields as authorization/data truth when the server can derive
 * them itself). `status` is restricted to SAVED/IN_PROGRESS — APPLIED is only ever set via the
 * separate, explicit mark-applied endpoint, never through this one.
 */
export const saveApplicationRequestSchema = z.object({
  jobId: uuidSchema,
  status: z.enum(['SAVED', 'IN_PROGRESS']),
  autofillSummary: autofillSummarySchema,
  unresolvedFields: z.array(unresolvedFieldSummarySchema),
  /**
   * Generated-answer decisions to record (docs/IMPLEMENTATION_PLAN.md Phase 4C "Approved
   * answers") — references an existing generated_answers row by id rather than re-sending its
   * content, and only ever APPROVED/EDITED (a SKIPPED field has no decision worth recording
   * against the answer row; it just doesn't appear here).
   */
  answeredFields: z.array(
    z.object({
      generatedAnswerId: uuidSchema,
      decision: z.enum(['APPROVED', 'EDITED']),
      /** The user's replacement text when decision is EDITED; null when APPROVED (the
       * original `answer` column is the final text — never duplicated into finalText as if it
       * had been "edited"). */
      finalText: z.string().nullable(),
    }),
  ),
});
export type SaveApplicationRequest = z.infer<typeof saveApplicationRequestSchema>;

export const saveApplicationResponseSchema = z.object({
  applicationId: uuidSchema,
  status: applicationStatusSchema,
  created: z.boolean(),
});
export type SaveApplicationResponse = z.infer<typeof saveApplicationResponseSchema>;

/** GET /api/applications?jobId=... response — lets the popup show "already tracked" before the
 * user does anything, per docs/IMPLEMENTATION_PLAN.md Phase 4C. */
export const trackedApplicationResponseSchema = z.object({
  application: z
    .object({ id: uuidSchema, status: applicationStatusSchema, updatedAt: isoDateTimeSchema })
    .nullable(),
});
export type TrackedApplicationResponse = z.infer<typeof trackedApplicationResponseSchema>;
