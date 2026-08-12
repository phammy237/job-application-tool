import {
  generatedAnswerSchema,
  type GeneratedAnswer,
  type GeneratedAnswerInput,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['generated_answers']['Row'];

function rowToGeneratedAnswer(row: Row): GeneratedAnswer {
  return generatedAnswerSchema.parse({
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id,
    jobId: row.job_id,
    fieldLabel: row.field_label,
    fieldClassification: row.field_classification,
    answer: row.answer,
    confidence: row.confidence,
    sourceFactIds: row.source_fact_ids ?? [],
    reasoningSummary: row.reasoning_summary,
    unsupportedClaims: row.unsupported_claims ?? [],
    requiresUserReview: row.requires_user_review,
    userDecision: row.user_decision,
    finalText: row.final_text,
    insufficientData: row.insufficient_data,
    rejectionReason: row.rejection_reason,
    availableFactIds: row.available_fact_ids,
    generationRunId: row.generation_run_id,
    attemptNumber: row.attempt_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * Persists a generated_answers row regardless of whether it passed the rejection gate
 * (docs/AI_GROUNDING.md §4) — packages/ai calls this for both accepted and rejected-but-
 * structurally-valid results, per the "kept for audit" column note in docs/DATA_MODEL.md.
 * Callers must not surface a row from this function's return value directly to a user; use
 * listOwnGeneratedAnswersForApplication, which filters rejected rows out.
 */
export async function createOwnGeneratedAnswer(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: GeneratedAnswerInput,
): Promise<GeneratedAnswer> {
  const { data, error } = await supabase
    .from('generated_answers')
    .insert({
      user_id: userId,
      application_id: input.applicationId,
      job_id: input.jobId,
      field_label: input.fieldLabel,
      field_classification: input.fieldClassification,
      answer: input.answer,
      confidence: input.confidence,
      source_fact_ids: input.sourceFactIds,
      reasoning_summary: input.reasoningSummary,
      unsupported_claims: input.unsupportedClaims,
      requires_user_review: input.requiresUserReview,
      user_decision: input.userDecision,
      final_text: input.finalText,
      insufficient_data: input.insufficientData,
      rejection_reason: input.rejectionReason,
      available_fact_ids: input.availableFactIds,
      generation_run_id: input.generationRunId,
      attempt_number: input.attemptNumber,
    })
    .select('*')
    .single();
  return rowToGeneratedAnswer(unwrapRow(data, error, 'createOwnGeneratedAnswer'));
}

export interface RecordGeneratedAnswerDecisionInput {
  applicationId: string;
  decision: 'APPROVED' | 'EDITED';
  /** The user's replacement text when decision is EDITED, null when APPROVED — never copies
   * `answer` into `finalText` for an unedited approval, so finalText staying null continues to
   * mean exactly "unedited AI output," never "edited to be identical." */
  finalText: string | null;
}

/**
 * Records the user's approve/edit decision against an *existing* generated_answers row and
 * links it to the application it was used for (docs/IMPLEMENTATION_PLAN.md Phase 4C) — this is
 * the first and only writer of user_decision/final_text; every prior code path leaves them null.
 * Ownership-scoped by user_id like every other write here; also scoped to rows that don't
 * already belong to a *different* application, so a save can't silently re-point an answer used
 * elsewhere. Updating the existing row (never inserting a new one) is what keeps repeated saves
 * from creating duplicate answer-usage rows.
 */
export async function recordOwnGeneratedAnswerDecision(
  supabase: CareerOsSupabaseClient,
  userId: string,
  generatedAnswerId: string,
  input: RecordGeneratedAnswerDecisionInput,
): Promise<GeneratedAnswer | null> {
  const { data, error } = await supabase
    .from('generated_answers')
    .update({
      user_decision: input.decision,
      final_text: input.finalText,
      application_id: input.applicationId,
    })
    .eq('id', generatedAnswerId)
    .eq('user_id', userId)
    .or(`application_id.is.null,application_id.eq.${input.applicationId}`)
    .select('*')
    .maybeSingle();
  assertNoError(error, 'recordOwnGeneratedAnswerDecision');
  return data ? rowToGeneratedAnswer(data) : null;
}

export async function getOwnGeneratedAnswer(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<GeneratedAnswer | null> {
  const { data, error } = await supabase
    .from('generated_answers')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnGeneratedAnswer');
  return data ? rowToGeneratedAnswer(data) : null;
}

/**
 * User-facing read path — filters out any row that failed the rejection gate at generation
 * time (`unsupported_claims` non-empty). This is the structural guarantee behind "a rejected
 * answer is never shown to the user": a future UI query built on top of this function cannot
 * accidentally leak one just by omitting a WHERE clause, because the filter lives here.
 */
export async function listOwnGeneratedAnswersForApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<GeneratedAnswer[]> {
  const { data, error } = await supabase
    .from('generated_answers')
    .select('*')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    // Postgres array-literal equality, not the TS-typed .eq() (which expects a string[] and
    // would serialize wrong) — this is the enforcement point described above.
    .filter('unsupported_claims', 'eq', '{}')
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnGeneratedAnswersForApplication');
  return (data ?? []).map(rowToGeneratedAnswer);
}
