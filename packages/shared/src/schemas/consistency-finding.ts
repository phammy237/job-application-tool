import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * One entry per deterministic rule (docs/IMPLEMENTATION_PLAN.md Phase 5B.2B) plus
 * UNSUPPORTED_CLAIM, which shares this exact finding shape but is produced by the explicit,
 * user-triggered AI-assisted check (Phase 5B.3) rather than a deterministic rule — always
 * WARNING severity, never BLOCKING (see consistencyFindingSchema's own refinement below).
 *
 * `RELOCATION_SELF_CONTRADICTION`/`RELOCATION_PROFILE_MISMATCH` were added in the Phase 5B
 * hardening pass as a **backward-compatible expansion**, never a rename: before this, both
 * `evaluateEligibilityGroup` calls in `consistency-rules.ts` (one for `WORK_AUTHORIZATION`, one
 * for `RELOCATION`) reused the same `ELIGIBILITY_SELF_CONTRADICTION`/`ELIGIBILITY_PROFILE_MISMATCH`
 * ids for both classifications, making a finding's `ruleId` alone insufficient to tell a
 * work-authorization concern apart from a relocation one (only free-text `description`/
 * `fieldBLabel` disambiguated them). `ELIGIBILITY_SELF_CONTRADICTION`/`ELIGIBILITY_PROFILE_MISMATCH`
 * are kept exactly as-is and remain the ids `WORK_AUTHORIZATION` findings use — this enum only
 * ever gained new members, so every historical `submission_packets.consistency_findings` JSON
 * blob written before this pass (using either the old shared ids, for a relocation finding that
 * predates this split, or the `ELIGIBILITY_*` ids for a work-authorization one) still parses
 * against this exact schema without any migration.
 */
export const consistencyRuleIdSchema = z.enum([
  'GRADUATION_DATE_MISMATCH',
  'GPA_MISMATCH',
  'EMPLOYMENT_DATE_MISMATCH',
  'JOB_TITLE_COMPANY_MISMATCH',
  'ELIGIBILITY_SELF_CONTRADICTION',
  'ELIGIBILITY_PROFILE_MISMATCH',
  'RELOCATION_SELF_CONTRADICTION',
  'RELOCATION_PROFILE_MISMATCH',
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

/**
 * `PROFILE_ELIGIBILITY` was added in the Phase 5B hardening pass — another backward-compatible
 * expansion, never a rename. Before this, both work-authorization and relocation profile-mismatch
 * findings tagged their profile-side value `PROFILE_CONTACT`, which is a semantic misnomer
 * (neither is contact information). `PROFILE_CONTACT` is kept exactly as-is in this enum — every
 * historical finding already frozen into a `submission_packets` row with that tag still parses —
 * but `evaluateEligibilityGroup` now tags newly-generated eligibility/profile-preference findings
 * with `PROFILE_ELIGIBILITY` instead. (Nothing in this codebase's profiles table actually stores
 * plain contact info like an email/phone in a way this rule engine ever compares against, so
 * `PROFILE_CONTACT` may end up fully retired from new output entirely — it stays in the enum only
 * for historical-JSON compatibility.)
 */
export const consistencyFieldSourceSchema = z.enum([
  'PROFILE_EDUCATION',
  'PROFILE_EXPERIENCE',
  'PROFILE_CONTACT',
  'PROFILE_ELIGIBILITY',
  'GENERATED_ANSWER',
  'AI_EVIDENCE',
]);
export type ConsistencyFieldSource = z.infer<typeof consistencyFieldSourceSchema>;

/** UNSUPPORTED_CLAIM (Phase 5B.3) must always be WARNING — an AI-assisted finding may never be
 * BLOCKING, so a model can never be the thing that stops a user from submitting. Declared before
 * `consistencyFindingSchema` so its own refinement (below) can reference this set directly,
 * rather than duplicating the rule-id list inline. */
export const AI_ASSISTED_RULE_IDS: ReadonlySet<ConsistencyRuleId> = new Set([
  'UNSUPPORTED_CLAIM',
]);

/**
 * `id` is a deterministic hash of (ruleId + the normalized identity of the two things being
 * compared) — never `randomUUID()`. Re-running the same rule against unchanged inputs must
 * reproduce the identical id, or an acknowledgement collected from an earlier GET
 * /consistency-check could never be matched against the findings recomputed at the authoritative
 * PATCH /mark-applied a moment later (docs/IMPLEMENTATION_PLAN.md Phase 5B.2A).
 *
 * BLOCKING findings are never acknowledgeable — enforced primarily by the server-side gate in
 * packages/database, which refuses outright whenever any BLOCKING finding is present, regardless
 * of what acknowledgement ids the caller sends.
 *
 * Phase 5B hardening: the `.superRefine` below is a second, independent, schema-level guard —
 * defense in depth, not the only check — rejecting any finding that pairs an AI-assisted rule id
 * (`AI_ASSISTED_RULE_IDS`, currently just `UNSUPPORTED_CLAIM`) with `severity: 'BLOCKING'`. Today
 * `generate-unsupported-claims-check.ts` already hardcodes `severity: 'WARNING'` on every finding
 * it produces — that remains the actual, load-bearing control, and model/provider output has
 * never had any way to set severity itself. This refinement exists so a future bug that ever did
 * try to construct an AI-assisted BLOCKING finding would fail schema validation immediately,
 * rather than silently succeeding because nothing else was checking for that combination.
 */
export const consistencyFindingSchema = z
  .object({
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
  })
  .superRefine((finding, ctx) => {
    if (finding.severity === 'BLOCKING' && AI_ASSISTED_RULE_IDS.has(finding.ruleId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity'],
        message: `An AI-assisted rule (${finding.ruleId}) can never be BLOCKING — this would let model/provider output control whether a submission is blocked.`,
      });
    }
  });
export type ConsistencyFinding = z.infer<typeof consistencyFindingSchema>;

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
export type UnsupportedClaimCheckResponse = z.infer<
  typeof unsupportedClaimCheckResponseSchema
>;
