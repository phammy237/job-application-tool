import { z } from 'zod';
import { detectedFieldSchema, fieldClassificationSchema, NEVER_SUGGEST_CLASSIFICATIONS } from './detected-field';
import { generatedAnswerSchema, type GeneratedAnswer } from './generated-answer';

/**
 * Where one detected field stands in the Phase 4 review flow (docs/IMPLEMENTATION_PLAN.md
 * Phase 4A). Split into two parts on purpose:
 *
 * - SENSITIVE/UNSUPPORTED/ALREADY_COMPLETED are structural — computable instantly from the
 *   DetectedField alone (see classifyInitialReviewState below), no Claude call involved.
 * - PENDING_SUGGESTION/READY/SUGGESTED/NEEDS_INPUT track a field through the async suggestion
 *   request: not yet asked, asked, and asked-with/without a usable result.
 */
export const fieldReviewStateSchema = z.enum([
  /** DEMOGRAPHIC/LEGAL/AUTHENTICATION — never gets a suggestion, ever. No approval UI renders. */
  'SENSITIVE',
  /** FILE_UPLOAD (no upload workflow exists yet) or UNKNOWN (detector couldn't confidently
   * classify it) — technically unreliable to fill automatically, always manual. */
  'UNSUPPORTED',
  /** Field already had a non-empty value at detection time — preserved, not overwritten,
   * unless the user explicitly asks for a suggestion anyway. */
  'ALREADY_COMPLETED',
  /** Eligible for a suggestion; none requested yet. */
  'PENDING_SUGGESTION',
  /** A suggestion was generated with confidence >= READY_CONFIDENCE_THRESHOLD — a direct,
   * high-confidence match, low-risk to bulk-approve. */
  'READY',
  /** A suggestion was generated below the READY threshold — a genuine draft that needs the
   * user to actually read it before approving, never bulk-approved. */
  'SUGGESTED',
  /** A suggestion was requested but the pipeline had nothing to offer (insufficient approved
   * facts, or a structurally-valid-but-rejected draft) — same user-facing meaning as
   * insufficient_facts/no_suggestion from packages/ai, deliberately not distinguished here
   * either, per that pipeline's own "caller can't tell rejected from insufficient" design. */
  'NEEDS_INPUT',
]);
export type FieldReviewState = z.infer<typeof fieldReviewStateSchema>;

/**
 * Mirrors generatedAnswerUserDecisionSchema's vocabulary (APPROVED/EDITED/SKIPPED) plus PENDING
 * for "not decided yet" — reusing the persisted column's enum rather than inventing a competing
 * one, since a decision made here is meant to eventually become that column's value once Phase
 * 4C adds the endpoint to persist it.
 */
export const fieldApprovalStateSchema = z.enum(['PENDING', 'APPROVED', 'EDITED', 'SKIPPED']);
export type FieldApprovalState = z.infer<typeof fieldApprovalStateSchema>;

/**
 * One detected field plus everything the Phase 4A review UI needs to render and act on it.
 * Composes DetectedField and GeneratedAnswer rather than duplicating their fields — see
 * docs/IMPLEMENTATION_PLAN.md Phase 4's "use existing types when available."
 */
export const reviewableFieldSchema = z.object({
  detected: detectedFieldSchema,
  reviewState: fieldReviewStateSchema,
  approvalState: fieldApprovalStateSchema,
  /** The persisted generated_answers row once a suggestion has been fetched; null before that
   * (or if the fetch produced no usable answer). */
  suggestion: generatedAnswerSchema.nullable(),
  /** Set when approvalState is EDITED — the user's replacement text, distinct from
   * suggestion.answer (the model's original draft), mirroring the eventual finalText column. */
  editedText: z.string().nullable(),
  /** Set when a suggestion request failed (provider error, unexpected response shape). Cleared
   * on the next request for the same field. */
  errorMessage: z.string().nullable(),
});
export type ReviewableField = z.infer<typeof reviewableFieldSchema>;

const UNSUPPORTED_CLASSIFICATIONS: ReadonlySet<z.infer<typeof fieldClassificationSchema>> = new Set(
  ['FILE_UPLOAD', 'UNKNOWN'],
);

/**
 * A suggestion at or above this confidence is treated as a direct, low-risk match (READY) —
 * eligible for "approve all eligible" — rather than a draft that needs individual review
 * (SUGGESTED). Reuses packages/ai's existing per-answer confidence score rather than adding a
 * second AI code path or model call to distinguish "direct" from "generated" — see
 * docs/IMPLEMENTATION_PLAN.md Phase 4's "preserve the working suggestion pipeline" note.
 */
export const READY_CONFIDENCE_THRESHOLD = 0.85;

/**
 * The structural half of review-state assignment — computable the instant a field is detected,
 * before any suggestion is requested. Fields never sent for a suggestion (SENSITIVE/UNSUPPORTED)
 * are decided here so the popup never even offers to fetch one for them — CLAUDE.md's
 * "enforcement, not labeling" rule applied client-side too, not just trusted to the backend's
 * own refusal in packages/ai/src/generate-suggestion.ts.
 */
export function classifyInitialReviewState(field: {
  classification: z.infer<typeof fieldClassificationSchema>;
  currentValue: string | null;
}): FieldReviewState {
  if (NEVER_SUGGEST_CLASSIFICATIONS.has(field.classification)) return 'SENSITIVE';
  if (UNSUPPORTED_CLASSIFICATIONS.has(field.classification)) return 'UNSUPPORTED';
  if (field.currentValue) return 'ALREADY_COMPLETED';
  return 'PENDING_SUGGESTION';
}

/**
 * The async half — call once a suggestion request resolves. `null` means the request completed
 * but produced nothing usable (not_supported_for_field/insufficient_facts/no_suggestion all
 * collapse to this — see fieldReviewStateSchema's NEEDS_INPUT doc comment).
 */
export function reviewStateForSuggestion(suggestion: GeneratedAnswer | null): FieldReviewState {
  if (!suggestion) return 'NEEDS_INPUT';
  return suggestion.confidence >= READY_CONFIDENCE_THRESHOLD ? 'READY' : 'SUGGESTED';
}

/** True for the two states a user can actually approve/edit/skip — every other state has
 * structurally nothing to decide on (CLAUDE.md: "there is structurally no suggestion to
 * approve" for SENSITIVE fields; the same logic extends to the not-yet-resolved states here). */
export function isDecidable(reviewState: FieldReviewState): boolean {
  return reviewState === 'READY' || reviewState === 'SUGGESTED';
}
