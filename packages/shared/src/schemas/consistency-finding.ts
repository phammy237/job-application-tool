import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * One entry per deterministic rule (docs/IMPLEMENTATION_PLAN.md Phase 5B.2B) plus
 * UNSUPPORTED_CLAIM, which shares this exact finding shape but is produced by the explicit,
 * user-triggered AI-assisted check (Phase 5B.3) rather than a deterministic rule — always
 * WARNING severity, never BLOCKING (see consistencyFindingSchema's refinement below).
 */
export const consistencyRuleIdSchema = z.enum([
  'GRADUATION_DATE_MISMATCH',
  'GPA_MISMATCH',
  'EMPLOYMENT_DATE_MISMATCH',
  'JOB_TITLE_COMPANY_MISMATCH',
  'ELIGIBILITY_SELF_CONTRADICTION',
  'ELIGIBILITY_PROFILE_MISMATCH',
  'UNSUPPORTED_CLAIM',
]);
export type ConsistencyRuleId = z.infer<typeof consistencyRuleIdSchema>;

/**
 * BLOCKING: two current answers inside the SAME application are structurally contradictory and
 * cannot coherently both be true — never acknowledgeable away, the underlying answer must be
 * fixed. WARNING: an answer differs from stored profile/evidence, where either side might
 * legitimately be stale or intentionally different — requires explicit per-finding
 * acknowledgement, never blocks outright.
 */
export const consistencySeveritySchema = z.enum(['WARNING', 'BLOCKING']);
export type ConsistencySeverity = z.infer<typeof consistencySeveritySchema>;

export const consistencyFieldSourceSchema = z.enum([
  'PROFILE_EDUCATION',
  'PROFILE_EXPERIENCE',
  'PROFILE_CONTACT',
  'GENERATED_ANSWER',
  'AI_EVIDENCE',
]);
export type ConsistencyFieldSource = z.infer<typeof consistencyFieldSourceSchema>;

/**
 * `id` is a deterministic hash of (ruleId + the normalized identity of the two things being
 * compared) — never `randomUUID()`. Re-running the same rule against unchanged inputs must
 * reproduce the identical id, or an acknowledgement collected from an earlier GET
 * /consistency-check could never be matched against the findings recomputed at the authoritative
 * PATCH /mark-applied a moment later (docs/IMPLEMENTATION_PLAN.md Phase 5B.2A).
 *
 * BLOCKING findings are never acknowledgeable — enforced both by the rejection refinement below
 * (a BLOCKING finding can never itself carry a legitimate acknowledgement path) and, more
 * importantly, by the server-side gate in packages/database, which refuses outright whenever any
 * BLOCKING finding is present, regardless of what acknowledgement ids the caller sends.
 */
export const consistencyFindingSchema = z.object({
  id: z.string().min(1),
  ruleId: consistencyRuleIdSchema,
  severity: consistencySeveritySchema,
  fieldALabel: z.string(),
  fieldASource: consistencyFieldSourceSchema,
  fieldAValue: z.string(),
  fieldBLabel: z.string(),
  fieldBSource: consistencyFieldSourceSchema,
  fieldBValue: z.string(),
  /** Short, human-readable, never raw model chain-of-thought (same posture as
   * generatedAnswer.reasoningSummary) — always plainly states which two values conflict. */
  description: z.string(),
});
export type ConsistencyFinding = z.infer<typeof consistencyFindingSchema>;

/** UNSUPPORTED_CLAIM (Phase 5B.3) must always be WARNING — an AI-assisted finding may never be
 * BLOCKING, so a model can never be the thing that stops a user from submitting. */
export const AI_ASSISTED_RULE_IDS: ReadonlySet<ConsistencyRuleId> = new Set([
  'UNSUPPORTED_CLAIM',
]);

export const consistencyAcknowledgementSchema = z.object({
  findingId: z.string().min(1),
  acknowledgedAt: isoDateTimeSchema,
});
export type ConsistencyAcknowledgement = z.infer<typeof consistencyAcknowledgementSchema>;

/** GET /api/applications/:id/consistency-check response — advisory only, computed fresh on every
 * call, never persisted. See docs/IMPLEMENTATION_PLAN.md Phase 5B.2E/F: this endpoint exists for
 * UX, not authorization — the PATCH mark-applied gate independently recomputes. */
export const consistencyCheckResponseSchema = z.object({
  findings: z.array(consistencyFindingSchema),
  blockingCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
});
export type ConsistencyCheckResponse = z.infer<typeof consistencyCheckResponseSchema>;

/** Wire body for the authoritative PATCH mark-applied call — the client sends only which
 * currently-shown WARNING finding ids it has acknowledged, never the findings themselves, never a
 * severity, never a value. The server recomputes everything else itself. */
export const markAppliedRequestSchema = z.object({
  acknowledgedFindingIds: z.array(z.string()).default([]),
});
export type MarkAppliedRequest = z.infer<typeof markAppliedRequestSchema>;

/**
 * The 409-equivalent response shape when the authoritative gate rejects a mark-applied attempt —
 * same findings shape as the GET response so the UI can render both with one component, plus
 * which category caused the rejection.
 */
export const consistencyBlockedResponseSchema = z.object({
  status: z.literal('consistency_check_failed'),
  reason: z.enum(['blocking_findings', 'unacknowledged_warnings']),
  findings: z.array(consistencyFindingSchema),
  blockingCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
});
export type ConsistencyBlockedResponse = z.infer<typeof consistencyBlockedResponseSchema>;

/**
 * POST /api/applications/:id/unsupported-claims-check response (docs/IMPLEMENTATION_PLAN.md
 * Phase 5B.3) — explicit user-triggered only, never automatic, never persisted (ephemeral by
 * design — see generate-unsupported-claims-check.ts's own doc comment on why). `findings` here
 * always has `ruleId: 'UNSUPPORTED_CLAIM'` and `severity: 'WARNING'` — an AI-assisted finding can
 * never be BLOCKING, so a model can never be the thing that stops a submission.
 *
 * Deliberately always HTTP 200 for every one of these three shapes (a real auth/ownership
 * failure is the only non-200 this route ever returns) — a rate limit, provider error, or
 * "nothing to check yet" is reported as data, not as an HTTP error, since this check can never
 * block or fail the user's ability to submit.
 */
export const unsupportedClaimCheckResponseSchema = z.union([
  z.object({ status: z.literal('ok'), findings: z.array(consistencyFindingSchema) }),
  z.object({
    status: z.literal('no_claims_to_check'),
    reason: z.enum(['no_answers_to_check', 'insufficient_facts']),
    findings: z.array(consistencyFindingSchema),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['rate_limited', 'provider_error', 'validation_failed']),
    findings: z.array(consistencyFindingSchema),
  }),
]);
export type UnsupportedClaimCheckResponse = z.infer<typeof unsupportedClaimCheckResponseSchema>;
