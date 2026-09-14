import { z } from 'zod';
import { uuidSchema } from './common';
import {
  MAX_RESUME_TAILORING_OPERATIONS,
  resumeTailoringOperationViewSchema,
} from './resume-tailoring';

/**
 * Phase 7F — the user-control layer over a Phase 7E `ResumeTailoringProposal`. Every operation in
 * a proposal starts `PENDING` and the user must actively resolve it — never defaulted to
 * `ACCEPTED` (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §5). This file defines the wire contract for
 * what comes back to the server when the user saves: not a new parallel proposal representation,
 * but the *same* `ResumeTailoringOperationView` objects Phase 7E already returns, each tagged with
 * a client-assigned `operationId` (stamped once, immediately on receiving the proposal — see
 * `apps/web/.../resume-tailoring-panel.tsx` — deterministic and never model-generated, per §4) and
 * this review's decision/edit for it. The server never trusts these views as authoritative
 * citations by themselves: `save-reviewed-tailored-resume.ts` re-derives its own fresh allowlists
 * from the current database state and independently revalidates every id and every grounded
 * claim before anything is persisted (§13/§48).
 */
export const resumeTailoringOperationDecisionSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
]);
export type ResumeTailoringOperationDecision = z.infer<
  typeof resumeTailoringOperationDecisionSchema
>;

/**
 * A user's manual edit to a proposed `REWRITE_BULLET`/`ADD_BULLET` (§7/§8). `provenanceChoice` is
 * the explicit, honest choice the product spec requires: `KEEP_GROUNDED` asks the save path to
 * re-run the same deterministic numeric/technology guards Phase 7E used, against the operation's
 * own cited facts (and, for a rewrite, the original bullet text) — the edit is only saved as
 * `CANDIDATE_FACTS`-grounded if that passes. `MANUAL` always succeeds and is never labeled
 * fact-grounded, whatever it says (§30: "Conservative default... User-edited AI bullet -> MANUAL
 * unless there is a strong reason to preserve verified fact provenance"). Never silently
 * downgraded from one to the other without the result saying so (§8/§13).
 */
export const resumeTailoringOperationEditSchema = z.object({
  text: z.string().trim().min(1).max(600),
  provenanceChoice: z.enum(['KEEP_GROUNDED', 'MANUAL']),
});
export type ResumeTailoringOperationEdit = z.infer<
  typeof resumeTailoringOperationEditSchema
>;

/** One reviewed operation as submitted back to the save endpoint. */
export const resumeTailoringReviewedOperationInputSchema = z.object({
  operationId: z.string().min(1).max(50),
  operation: resumeTailoringOperationViewSchema,
  decision: resumeTailoringOperationDecisionSchema,
  edit: resumeTailoringOperationEditSchema.nullable().default(null),
});
export type ResumeTailoringReviewedOperationInput = z.infer<
  typeof resumeTailoringReviewedOperationInputSchema
>;

/**
 * POST /api/applications/:id/resume-tailoring/save request body (§47). Deliberately minimal:
 * `baseResumeVersionId`/`jobSnapshotId` are the two staleness anchors (§14/§15) re-checked against
 * the application's *current* state before anything else happens; `operations` is the full
 * reviewed set (including PENDING/REJECTED ones, so the server can independently confirm nothing
 * was left unresolved — §35 requires every operation resolved before save, and the server must
 * never trust a client claim of "all resolved" that omits the very operations that weren't).
 */
export const saveReviewedTailoredResumeInputSchema = z.object({
  baseResumeVersionId: uuidSchema,
  jobSnapshotId: uuidSchema,
  operations: z
    .array(resumeTailoringReviewedOperationInputSchema)
    .max(MAX_RESUME_TAILORING_OPERATIONS),
  /** Required `true` when the base version has an active custom LaTeX override — an explicit,
   * server-checked acknowledgment that saving regenerates LaTeX from structured content and does
   * not carry the override forward (§39). Ignored (never required) when there is no override. */
  acknowledgeCustomLatexOverrideReset: z.boolean().default(false),
});
export type SaveReviewedTailoredResumeInput = z.infer<
  typeof saveReviewedTailoredResumeInputSchema
>;
