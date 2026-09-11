import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { autofillSummarySchema, unresolvedFieldSummarySchema } from './application';
import { fieldClassificationSchema } from './detected-field';
import { generatedAnswerUserDecisionSchema } from './generated-answer';
import {
  consistencyAcknowledgementSchema,
  consistencyFindingSchema,
} from './consistency-finding';

/**
 * One frozen, literal answer entry inside a submission packet — sourced exclusively from an
 * already-persisted `generated_answers` row for this application (docs/IMPLEMENTATION_PLAN.md
 * Phase 5B.1C). This is deliberately NOT a record of every field on the employer's form: Career
 * OS only ever has a literal value for a field if the user requested an AI suggestion for it
 * (whether or not they ultimately approved/edited/skipped it) — a field the user typed directly
 * into the page, or that the browser's own autofill completed, was never sent to Career OS and
 * has no entry here. `userDecision` distinguishes what was actually used (APPROVED/EDITED)
 * from what was shown but not used (SKIPPED, or never decided at all — still `null`).
 */
export const submissionPacketAnswerSchema = z.object({
  generatedAnswerId: uuidSchema,
  fieldLabel: z.string(),
  fieldClassification: fieldClassificationSchema,
  /** The AI's original draft, exactly as generated. */
  originalAnswer: z.string(),
  /** The user's edited replacement, or null if never edited (APPROVED as-is, skipped, or never
   * decided) — never a copy of originalAnswer masquerading as an edit. */
  finalText: z.string().nullable(),
  userDecision: generatedAnswerUserDecisionSchema.nullable(),
  sourceFactIds: z.array(uuidSchema),
  confidence: z.number().min(0).max(1),
});
export type SubmissionPacketAnswer = z.infer<typeof submissionPacketAnswerSchema>;

/**
 * The persisted `submission_packets` row shape (docs/DATA_MODEL.md, migration 0013). Immutable
 * once written — created exactly once, at the first real transition into APPLIED, by the
 * service-role-only `mark_application_applied` Postgres function. A historical record: it stores
 * *resolved values*, never a live-re-resolving pointer, unlike `requirement_evidence_mappings`'
 * matchedFacts — the entire point is "what did I actually submit," which must never change when
 * the profile, résumé, job posting, requirement mapping, or AI models change later.
 */
export const submissionPacketSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  applicationId: uuidSchema,
  /** Null when the application had no linked job snapshot at freeze time (e.g. a manually
   * dashboard-created application with no job). */
  jobSnapshotId: uuidSchema.nullable(),
  /** Null whenever `applications.resume_id` was null at freeze time — which is every application
   * today, since no code path currently writes that column (docs/IMPLEMENTATION_PLAN.md Phase
   * 5B.0/5B.1E). Never inferred or defaulted to a "current"/"primary" résumé. */
  resumeId: uuidSchema.nullable(),
  /** Null when no CURRENT requirement_mapping_run existed for the linked snapshot at freeze
   * time — a reference into an already-immutable table, never duplicated content. */
  requirementMappingRunId: uuidSchema.nullable(),
  answersSnapshot: z.array(submissionPacketAnswerSchema),
  autofillSummary: autofillSummarySchema.nullable(),
  unresolvedFields: z.array(unresolvedFieldSummarySchema).nullable(),
  consistencyFindings: z.array(consistencyFindingSchema),
  consistencyAcknowledgements: z.array(consistencyAcknowledgementSchema),
  contentFingerprint: z.string().min(1),
  createdAt: isoDateTimeSchema,
});
export type SubmissionPacket = z.infer<typeof submissionPacketSchema>;

/** GET /api/applications/:id/packet response — null is a legitimate, honest state (either the
 * application isn't APPLIED yet, or it's a legacy APPLIED row that predates packet support; see
 * docs/IMPLEMENTATION_PLAN.md Phase 5B.1G "legacy APPLIED" temporal invariant), not an error. */
export const submissionPacketResponseSchema = z.object({
  packet: submissionPacketSchema.nullable(),
});
export type SubmissionPacketResponse = z.infer<typeof submissionPacketResponseSchema>;
