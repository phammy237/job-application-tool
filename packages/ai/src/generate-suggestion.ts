import { randomUUID } from 'node:crypto';
import {
  createOwnGeneratedAnswer,
  getOwnJob,
  incrementOwnAiRequestUsage,
  listOwnApprovedFactsForGeneration,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import type {
  FieldClassification,
  GeneratedAnswer,
  GeneratedAnswerContract,
  GeneratedAnswerRejectionReason,
} from '@career-os/shared';
import { callClaudeForSuggestion } from './claude/call-claude';
import { NEVER_SUGGEST_CLASSIFICATIONS } from './config';
import { validateContract } from './contract/validate-contract';
import { buildSystemPrompt } from './prompt/build-system-prompt';
import { buildUserPrompt } from './prompt/build-user-prompt';
import { rankFacts } from './retrieval/rank-facts';

export interface GenerateSuggestionParams {
  jobId: string;
  applicationId: string | null;
  fieldLabel: string;
  fieldClassification: FieldClassification;
}

export type GenerateSuggestionResult =
  | { status: 'not_supported_for_field' }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'job_not_found' }
  | { status: 'insufficient_facts' }
  | { status: 'no_suggestion' }
  | { status: 'provider_error'; message: string }
  | { status: 'generated'; answer: GeneratedAnswer };

const REJECTION_REASON_TEXT: Record<string, string> = {
  refusal: 'the request was declined',
  validation_failed: 'the response was not valid JSON matching the required contract',
  unknown_source_fact_id: 'sourceFactIds included an id outside the provided fact list',
  unsupported_claims_present: 'unsupportedClaims was non-empty — every claim must be fact-backed',
};

/**
 * Orchestrates one suggestion generation end to end: structural refusal -> rate limit ->
 * retrieval -> one Claude attempt -> validate -> at most one retry with a stricter prompt ->
 * persist/return. See docs/AI_GROUNDING.md and the Phase 3 implementation plan for the exact
 * pipeline this implements.
 */
export async function generateSuggestion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateSuggestionParams,
): Promise<GenerateSuggestionResult> {
  // Step 0 — structural refusal, before any DB read or Claude call. This is where CLAUDE.md's
  // "enforcement, not labeling" rule for DEMOGRAPHIC/LEGAL/AUTHENTICATION fields lives in code.
  if (NEVER_SUGGEST_CLASSIFICATIONS.has(params.fieldClassification)) {
    return { status: 'not_supported_for_field' };
  }

  // Step 1 — rate limit. Only increments on success, so a blocked request costs nothing.
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 2 — retrieval.
  const job = await getOwnJob(supabase, userId, params.jobId);
  if (!job) {
    return { status: 'job_not_found' };
  }

  const approvedFacts = await listOwnApprovedFactsForGeneration(supabase, userId);
  const rankedFacts = rankFacts(job, params.fieldClassification, approvedFacts, {
    now: new Date(),
  });
  if (rankedFacts.length === 0) {
    return { status: 'insufficient_facts' };
  }

  const systemPrompt = buildSystemPrompt();
  // Correlates this row (and, once wired up, its ai_usage_events telemetry rows) back to one
  // logical generation — deliberately not a foreign key (see generated-answer.ts's doc comment).
  const generationRunId = randomUUID();
  const availableFactIds = rankedFacts.map(({ fact }) => fact.id);

  // Shared by both persist call sites below (rejected-but-audited and accepted) — they differ
  // only in `rejectionReason`, so a schema field added to GeneratedAnswerInput only needs
  // wiring up here once, not at two call sites that can silently drift out of sync.
  const buildAnswerInput = (
    answer: GeneratedAnswerContract,
    rejectionReason: GeneratedAnswerRejectionReason | null,
  ) => ({
    applicationId: params.applicationId,
    jobId: job.id,
    fieldLabel: params.fieldLabel,
    fieldClassification: params.fieldClassification,
    answer: answer.answer,
    confidence: answer.confidence,
    sourceFactIds: answer.sourceFactIds,
    reasoningSummary: answer.reasoningSummary,
    unsupportedClaims: answer.unsupportedClaims,
    requiresUserReview: true,
    userDecision: null,
    finalText: null,
    insufficientData: answer.insufficientData,
    rejectionReason,
    availableFactIds,
    generationRunId,
    attemptNumber,
  });

  const runAttempt = async (retryReason?: string) => {
    const { userText, allowedFactIds } = buildUserPrompt({
      job: { title: job.title, company: job.company },
      fieldLabel: params.fieldLabel,
      fieldClassification: params.fieldClassification,
      rankedFacts,
      retryReason,
    });
    const callResult = await callClaudeForSuggestion(systemPrompt, userText);

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal', answer: null };
    }
    const validated = validateContract(callResult.rawText, allowedFactIds);
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, answer: validated.answer };
    }
    return { kind: 'rejected' as const, reason: validated.reason, answer: validated.answer };
  };

  // Step 3 — attempt 1.
  let attemptNumber = 1;
  let outcome = await runAttempt();

  // Step 4 — exactly one retry, on any failure (refusal or contract rejection).
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    outcome = await runAttempt(REJECTION_REASON_TEXT[outcome.reason] ?? outcome.reason);
  }

  // Step 5 — final disposition.
  if (outcome.kind === 'provider_error') {
    return { status: 'provider_error', message: outcome.message };
  }

  if (outcome.kind === 'rejected') {
    if (outcome.answer) {
      // Structurally valid but semantically rejected — persisted for audit (per
      // docs/DATA_MODEL.md's column note), never surfaced by a user-facing query
      // (listOwnGeneratedAnswersForApplication filters these out). The caller only ever sees
      // `no_suggestion`, identical in shape to `insufficient_facts`.
      await createOwnGeneratedAnswer(
        supabase,
        userId,
        buildAnswerInput(outcome.answer, outcome.reason),
      );
    }
    return { status: 'no_suggestion' };
  }

  const created = await createOwnGeneratedAnswer(
    supabase,
    userId,
    buildAnswerInput(outcome.answer, null),
  );

  return { status: 'generated', answer: created };
}
