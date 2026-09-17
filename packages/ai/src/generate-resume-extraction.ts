import { randomUUID } from 'node:crypto';
import {
  decrementOwnAiRequestUsage,
  incrementOwnAiRequestUsage,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import type { ResumeExtractionContract } from '@career-os/shared';
import { callClaudeForResumeExtraction } from './claude/call-claude';
import { MODEL_ID, RESUME_EXTRACTION_PROMPT_VERSION } from './config';
import { validateResumeExtractionContract } from './contract/validate-resume-extraction-contract';
import { buildResumeExtractionSystemPrompt } from './prompt/build-resume-extraction-system-prompt';
import { buildResumeExtractionUserPrompt } from './prompt/build-resume-extraction-user-prompt';

export type GenerateResumeExtractionResult =
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'invalid_output' }
  | { status: 'ok'; result: ResumeExtractionContract; droppedCount: number };

const PROVIDER = 'anthropic';

/**
 * Orchestrates one résumé-structuring generation end to end: rate limit -> one Claude attempt ->
 * validate (shape + verbatim grounding, see validate-resume-extraction-contract.ts) -> at most
 * one retry, only on a hard shape-validation failure (never on a grounding-driven drop, which
 * isn't something a retry meaningfully fixes) -> return. Mirrors generate-email-classification.ts's
 * skeleton (rate-limit-first, untrusted-content tagging, one retry only on rejection, best-effort
 * telemetry, quota refund on provider_error).
 *
 * `resumeText` is the already-deterministically-extracted PDF text (apps/web's pdf-text-extraction,
 * never re-derived here) — this function makes no storage/file-parsing calls of its own.
 */
export async function generateResumeExtraction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  resumeText: string,
): Promise<GenerateResumeExtractionResult> {
  // Step 1 — rate limit, before any provider call (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  const generationRunId = randomUUID();
  const systemPrompt = buildResumeExtractionSystemPrompt();
  const userText = buildResumeExtractionUserPrompt(resumeText);

  const runAttempt = async () => {
    const started = Date.now();
    const callResult = await callClaudeForResumeExtraction(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateResumeExtractionContract(callResult.rawText, resumeText);
    if (validated.status === 'rejected') {
      return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
    }
    return {
      kind: 'accepted' as const,
      result: validated.result,
      droppedCount: validated.droppedCount,
      latencyMs,
    };
  };

  // Step 2 — attempt 1, then exactly one retry, only on a hard shape-validation rejection.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    outcome = await runAttempt();
  }

  // Best-effort usage telemetry — never fails the user's actual request, and never includes the
  // résumé's own text (docs/SECURITY_AND_PRIVACY.md "no raw resume text logging").
  await recordAiUsageEvent(supabase, userId, {
    applicationId: null,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: null,
    provider: PROVIDER,
    model: MODEL_ID,
    taskType: 'resume_extraction',
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
      outcome.kind === 'rejected' && outcome.reason !== 'refusal' ? outcome.reason : null,
    escalationReason: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: null,
    latencyMs: outcome.latencyMs,
    promptVersion: RESUME_EXTRACTION_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    // Claude was never meaningfully reached — give back the unit Step 1 pre-emptively reserved
    // (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'invalid_output' };
  }

  return { status: 'ok', result: outcome.result, droppedCount: outcome.droppedCount };
}
