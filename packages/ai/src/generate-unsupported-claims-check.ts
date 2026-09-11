import { randomUUID } from 'node:crypto';
import {
  incrementOwnAiRequestUsage,
  listOwnApprovedFactsForGeneration,
  listOwnGeneratedAnswersForApplication,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { computeFindingId, type ConsistencyFinding } from '@career-os/shared';
import { callClaudeForUnsupportedClaimCheck } from './claude/call-claude';
import { MODEL_ID, UNSUPPORTED_CLAIM_CHECK_PROMPT_VERSION } from './config';
import { validateUnsupportedClaimContract } from './contract/validate-unsupported-claim-contract';
import { buildUnsupportedClaimSystemPrompt } from './prompt/build-unsupported-claim-system-prompt';
import { buildUnsupportedClaimUserPrompt } from './prompt/build-unsupported-claim-user-prompt';

export interface GenerateUnsupportedClaimsCheckParams {
  applicationId: string;
}

export type GenerateUnsupportedClaimsCheckResult =
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'no_answers_to_check' }
  | { status: 'insufficient_facts' }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'ok'; findings: ConsistencyFinding[] };

const PROVIDER = 'anthropic';

/**
 * Orchestrates one explicit, user-triggered unsupported-claim check end to end
 * (docs/IMPLEMENTATION_PLAN.md Phase 5B.3): structural gates -> rate limit -> retrieval -> one
 * Claude attempt -> validate -> at most one retry -> convert accepted entries into
 * ConsistencyFinding[]. Deliberately mirrors generate-requirement-mapping.ts's shape — same
 * rate-limit-before-call ordering, same one-retry-on-rejection-only policy, same reuse of
 * listOwnApprovedFactsForGeneration — but this pipeline is:
 *
 * - Explicitly user-triggered only, same as requirement-mapping (never automatic — no caller in
 *   this codebase invokes it from a save/autofill/sync/mark-applied path).
 * - Always advisory: every produced finding is WARNING severity, never BLOCKING (a model can
 *   never be the thing that stops a submission), and this function's output is never passed into
 *   markOwnApplicationApplied's authoritative gate — that gate stays purely deterministic.
 * - Ephemeral: no PENDING/CURRENT/FAILED run table like requirement_mapping_runs. The only
 *   persisted trace of an attempt is the existing ai_usage_events telemetry row (best-effort,
 *   never fails the user's actual request) — see docs/IMPLEMENTATION_PLAN.md Phase 5B.3E for why
 *   an ephemeral advisory result was judged sufficient rather than a persisted-run architecture.
 */
export async function generateUnsupportedClaimsCheck(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateUnsupportedClaimsCheckParams,
): Promise<GenerateUnsupportedClaimsCheckResult> {
  // Step 1 — rate limit, before any provider call (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 2 — retrieval. Only answers the user actually decided to use (APPROVED/EDITED) — a
  // SKIPPED or never-decided suggestion was never going to be submitted, so there is no claim to
  // check (same filter as packages/database's consistency.ts, applied independently here since
  // packages/ai does not depend on that deterministic-only module).
  const generatedAnswers = await listOwnGeneratedAnswersForApplication(
    supabase,
    userId,
    params.applicationId,
  );
  const answers = generatedAnswers
    .filter((a) => a.userDecision === 'APPROVED' || a.userDecision === 'EDITED')
    .map((a) => ({
      generatedAnswerId: a.id,
      fieldLabel: a.fieldLabel,
      text: a.finalText ?? a.answer,
    }));
  if (answers.length === 0) {
    return { status: 'no_answers_to_check' };
  }

  const approvedFacts = await listOwnApprovedFactsForGeneration(supabase, userId);
  if (approvedFacts.length === 0) {
    return { status: 'insufficient_facts' };
  }

  const systemPrompt = buildUnsupportedClaimSystemPrompt();
  // Correlates this attempt's ai_usage_events row(s) — there is no persisted run row to derive an
  // id from (this pipeline is ephemeral), so a fresh id is generated purely for that telemetry
  // correlation, never stored or exposed anywhere else.
  const generationRunId = randomUUID();

  const runAttempt = async (retryReason?: string) => {
    const { userText, allowedFactIds } = buildUnsupportedClaimUserPrompt({
      answers,
      facts: approvedFacts,
      retryReason,
    });
    const started = Date.now();
    const callResult = await callClaudeForUnsupportedClaimCheck(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateUnsupportedClaimContract(
      callResult.rawText,
      allowedFactIds,
      answers.length,
    );
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, entries: validated.entries, latencyMs };
    }
    return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
  };

  // Step 3 — attempt 1, then exactly one retry — but only on a rejection, never on a hard
  // provider_error, matching generate-requirement-mapping.ts's exact policy.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : outcome.reason === 'unknown_source_fact_id'
          ? 'citedFactIds included an id outside the provided fact list'
          : outcome.reason === 'wrong_length'
            ? 'the response array length did not match the number of answers provided'
            : 'the response was not valid JSON matching the required contract';
    outcome = await runAttempt(retryReasonText);
  }

  // Best-effort usage telemetry — never fails the user's actual request.
  await recordAiUsageEvent(supabase, userId, {
    applicationId: params.applicationId,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: null,
    provider: PROVIDER,
    model: MODEL_ID,
    taskType: 'unsupported_claim_check',
    providerSucceeded: outcome.kind !== 'provider_error',
    outcome:
      outcome.kind === 'accepted'
        ? 'accepted'
        : outcome.kind === 'provider_error'
          ? 'provider_error'
          : outcome.reason === 'refusal'
            ? 'refusal'
            : 'rejected',
    // 'wrong_length' is this pipeline's own, more specific internal reason (used above to build
    // an accurate retry-prompt message) — telemetry only has the three shared rejection-reason
    // values (docs/DATA_MODEL.md ai_usage_events.rejection_reason CHECK constraint), and
    // 'wrong_length' genuinely is a validation failure (the response didn't match the required
    // contract shape), so it's recorded as 'validation_failed' rather than widening that shared,
    // cross-pipeline enum for one pipeline's more granular internal distinction.
    rejectionReason:
      outcome.kind === 'rejected' && outcome.reason !== 'refusal'
        ? outcome.reason === 'wrong_length'
          ? 'validation_failed'
          : outcome.reason
        : null,
    escalationReason: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: null,
    latencyMs: outcome.latencyMs,
    promptVersion: UNSUPPORTED_CLAIM_CHECK_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'validation_failed' };
  }

  // Step 4 — convert accepted entries into ConsistencyFinding[]. Only UNSUPPORTED entries become
  // findings; SUPPORTED/UNCERTAIN produce nothing (an uncertain result is not itself a claim to
  // flag — see the system prompt's explicit "prefer UNCERTAIN over guessing" instruction). Every
  // finding is WARNING — enforced structurally here, not left to caller discipline.
  const findings: ConsistencyFinding[] = [];
  outcome.entries.forEach((entry, index) => {
    if (entry.supportStatus !== 'UNSUPPORTED') return;
    const answer = answers[index];
    if (!answer) return;
    findings.push({
      id: computeFindingId(['UNSUPPORTED_CLAIM', answer.generatedAnswerId]),
      ruleId: 'UNSUPPORTED_CLAIM',
      severity: 'WARNING',
      fieldALabel: answer.fieldLabel,
      fieldASource: 'GENERATED_ANSWER',
      fieldAValue: answer.text,
      fieldBLabel: 'Approved evidence',
      fieldBSource: 'AI_EVIDENCE',
      fieldBValue:
        entry.citedFactIds.length > 0
          ? `${entry.citedFactIds.length} related fact(s) found, but not enough to support this`
          : 'no supporting approved facts found',
      description: entry.explanation,
    });
  });

  return { status: 'ok', findings };
}
