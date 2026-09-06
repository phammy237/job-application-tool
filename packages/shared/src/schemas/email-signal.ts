import { z } from 'zod';
import type { ApplicationStatus } from './application';
import { isoDateTimeSchema, uuidSchema } from './common';

export const emailClassificationSchema = z.enum([
  'APPLICATION_RECEIVED',
  'ASSESSMENT',
  'INTERVIEW',
  'ACTION_REQUIRED',
  'OFFER',
  'REJECTED',
  'OTHER',
]);
export type EmailClassification = z.infer<typeof emailClassificationSchema>;

/**
 * Tracks whether a below-threshold match has been reviewed — see
 * docs/DATA_MODEL.md "email_signals" for the full rationale (same role as
 * `generated_answers.user_decision`). `AUTO_APPLIED` and `NOT_APPLICABLE` are set at insert
 * time by the sync pipeline; `PENDING` moves to `CONFIRMED`/`DECLINED` only via
 * POST /api/email-signals/:id/confirm.
 */
export const emailSignalConfirmationStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'AUTO_APPLIED',
  'NOT_APPLICABLE',
]);
export type EmailSignalConfirmationStatus = z.infer<typeof emailSignalConfirmationStatusSchema>;

/** A processed Gmail message signal (docs/DATA_MODEL.md "email_signals"). Deliberately minimal
 * — never the full email body, see docs/EMAIL_INTEGRATION.md §3. */
export const emailSignalSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  emailConnectionId: uuidSchema,
  providerMessageId: z.string(),
  sender: z.string().nullable(),
  senderDomain: z.string().nullable(),
  subject: z.string().nullable(),
  receivedAt: isoDateTimeSchema.nullable(),
  matchedApplicationId: uuidSchema.nullable(),
  classification: emailClassificationSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().nullable(),
  confirmationStatus: emailSignalConfirmationStatusSchema,
  processedAt: isoDateTimeSchema,
});
export type EmailSignal = z.infer<typeof emailSignalSchema>;

/**
 * The single source of truth for classification -> application-status mapping, shared by both
 * the sync pipeline (auto-applied matches) and confirmOwnEmailSignal (user-confirmed matches) so
 * the mapping is never duplicated or allowed to drift between the two call sites. `OTHER` maps to
 * `null` — never proposed as a status change, per docs/EMAIL_INTEGRATION.md §2.
 */
export const EMAIL_CLASSIFICATION_TO_STATUS: Record<EmailClassification, ApplicationStatus | null> = {
  APPLICATION_RECEIVED: 'APPLICATION_RECEIVED',
  ASSESSMENT: 'ASSESSMENT',
  INTERVIEW: 'INTERVIEW',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  OFFER: 'OFFER',
  REJECTED: 'REJECTED',
  OTHER: null,
};
