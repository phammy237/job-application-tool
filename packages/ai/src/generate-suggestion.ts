import { randomUUID } from 'node:crypto';
import {
  createOwnGeneratedAnswer,
  decrementOwnAiRequestUsage,
  getOwnJob,
  incrementOwnAiRequestUsage,
  listOwnApprovedFactsForGeneration,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  classifyFieldLabel,
  type FieldClassification,
  type GeneratedAnswer,
  type GeneratedAnswerContract,
  type GeneratedAnswerRejectionReason,
} from '@career-os/shared';
import { callClaudeForSuggestion, type ClaudeCallUsage } from './claude/call-claude';
import { estimateCostUsd, MODEL_ID, NEVER_SUGGEST_CLASSIFICATIONS } from './config';
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
  reasoning_leak:
    'reasoningSummary read like internal step-by-step reasoning rather than a short, one-or-two-sentence summary naming which facts you used',
};

/** generated_answers.rejection_reason (docs/DATA_MODEL.md) has no 'reasoning_leak' value —
 * validateContract's reasoning-leak check is this pipeline's own internal detail, stored under
 * the closest real DB reason (same "map an internal-only reason onto a shared DB value" pattern
 * generate-company-research.ts already uses for its own 'no_findings' reason). */
function toPersistedRejectionReason(
  reason: GeneratedAnswerRejectionReason | 'reasoning_leak',
): GeneratedAnswerRejectionReason {
  return reason === 'reasoning_leak' ? 'validation_failed' : reason;
}

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
  // `fieldClassification` is client-supplied, so the server also classifies the label itself and
  // refuses if either one says never-suggest — a mislabeled "Gender" field still gets nothing.
  if (
    NEVER_SUGGEST_CLASSIFICATIONS.has(params.fieldClassification) ||
    NEVER_SUGGEST_CLASSIFICATIONS.has(classifyFieldLabel(params.fieldLabel))
  ) {
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
  // only in `rejectionReason`/`attemptNumber`, so a schema field added to GeneratedAnswerInput
  // only needs wiring up here once, not at call sites that can silently drift out of sync.
  // `attemptNumber` is an explicit parameter (never closed over a mutable outer variable) so a
  // persist call always records the attempt it actually came from, even after later code has
  // moved on to a different attempt number.
  const buildAnswerInput = (
    answer: GeneratedAnswerContract,
    rejectionReason: GeneratedAnswerRejectionReason | 'reasoning_leak' | null,
    attemptNum: number,
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
    rejectionReason: rejectionReason === null ? null : toPersistedRejectionReason(rejectionReason),
    availableFactIds,
    generationRunId,
    attemptNumber: attemptNum,
  });

  const runAttempt = async (retryReason?: string) => {
    const { userText, allowedFactIds } = buildUserPrompt({
      job: { title: job.title, company: job.company },
      fieldLabel: params.fieldLabel,
      fieldClassification: params.fieldClassification,
      rankedFacts,
      retryReason,
    });
    const started = Date.now();
    const callResult = await callClaudeForSuggestion(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return {
        kind: 'rejected' as const,
        reason: 'refusal' as const,
        answer: null,
        latencyMs,
        usage: callResult.usage,
      };
    }
    const validated = validateContract(callResult.rawText, allowedFactIds);
    if (validated.status === 'ok') {
      return {
        kind: 'accepted' as const,
        answer: validated.answer,
        latencyMs,
        usage: callResult.usage,
      };
    }
    return {
      kind: 'rejected' as const,
      reason: validated.reason,
      answer: validated.answer,
      latencyMs,
      usage: callResult.usage,
    };
  };

  // Step 3 — attempt 1.
  const firstOutcome = await runAttempt();
  let attemptNumber = 1;
  let outcome = firstOutcome;

  // Step 4 — exactly one retry, on any failure (refusal or contract rejection).
  let retried = false;
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    retried = true;
    outcome = await runAttempt(REJECTION_REASON_TEXT[outcome.reason] ?? outcome.reason);
  }

  // Attempt 1's own rejected-but-structurally-valid answer is never silently dropped, even when
  // the retry goes on to succeed (or fails a different way) — previously this was only persisted
  // when the *final* outcome was itself a rejection, losing attempt 1's record entirely on a
  // reject-then-succeed sequence.
  if (retried && firstOutcome.kind === 'rejected' && firstOutcome.answer) {
    await createOwnGeneratedAnswer(
      supabase,
      userId,
      buildAnswerInput(firstOutcome.answer, firstOutcome.reason, 1),
    ).catch(() => {});
  }

  // Best-effort usage telemetry for the final attempt — never fails the user's actual request.
  // No usage exists for a provider_error attempt (the provider was never meaningfully reached).
  const claudeUsage: ClaudeCallUsage | null = outcome.kind === 'provider_error' ? null : outcome.usage;
  await recordAiUsageEvent(supabase, userId, {
    applicationId: params.applicationId,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: params.fieldClassification,
    provider: 'anthropic',
    model: MODEL_ID,
    taskType: 'field_suggestion',
    providerSucceeded: outcome.kind !== 'provider_error',
    outcome:
      outcome.kind === 'accepted'
        ? 'accepted'
        : outcome.kind === 'provider_error'
          ? 'provider_error'
          : outcome.reason === 'refusal'
            ? 'refusal'
            : 'rejected',
    rejectionReason:
      outcome.kind === 'rejected' && outcome.reason !== 'refusal'
        ? toPersistedRejectionReason(outcome.reason)
        : null,
    escalationReason: null,
    inputTokens: claudeUsage?.inputTokens ?? 0,
    cachedInputTokens: 0,
    outputTokens: claudeUsage?.outputTokens ?? 0,
    estimatedCost: claudeUsage ? estimateCostUsd(claudeUsage) : null,
    latencyMs: outcome.latencyMs,
    promptVersion: null,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  // Step 5 — final disposition.
  if (outcome.kind === 'provider_error') {
    // The provider was never meaningfully reached (auth/network/5xx) — give back the unit
    // Step 1 pre-emptively reserved rather than permanently spending the user's shared quota on
    // a request that did no real work (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
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
        buildAnswerInput(outcome.answer, outcome.reason, attemptNumber),
      );
    }
    return { status: 'no_suggestion' };
  }

  const created = await createOwnGeneratedAnswer(
    supabase,
    userId,
    buildAnswerInput(outcome.answer, null, attemptNumber),
  );

  return { status: 'generated', answer: created };
}
