import { randomUUID } from 'node:crypto';
import {
  decrementOwnAiRequestUsage,
  incrementOwnAiRequestUsage,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import type { EmailClassification } from '@career-os/shared';
import { callClaudeForEmailClassification } from './claude/call-claude';
import { EMAIL_CLASSIFICATION_PROMPT_VERSION, MODEL_ID } from './config';
import { validateEmailClassificationContract } from './contract/validate-email-classification-contract';
import { buildEmailClassificationSystemPrompt } from './prompt/build-email-classification-system-prompt';
import { buildEmailClassificationUserPrompt } from './prompt/build-email-classification-user-prompt';

export interface ClassifyEmailParams {
  sender: string;
  subject: string;
  snippet: string;
}

export type ClassifyEmailResult =
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'classified'; classification: EmailClassification; confidence: number; evidence: string };

const PROVIDER = 'anthropic';

/**
 * The Claude fallback classifier — only called by packages/email's sync orchestrator for
 * messages the deterministic rules in docs/EMAIL_INTEGRATION.md §1.4 can't confidently resolve.
 * Mirrors generate-requirement-mapping.ts's skeleton (rate-limit-first, untrusted-content
 * tagging, one retry only on rejection, best-effort telemetry) but is simpler in two ways: there
 * is no retrieval step (the caller already has the sender/subject/snippet in hand) and no
 * persisted-run lifecycle to promote (a classification either comes back usable or it doesn't —
 * nothing atomic to commit), so generationRunId is a bare randomUUID() rather than a PENDING row,
 * matching generate-suggestion.ts's simpler pattern rather than generate-requirement-mapping.ts's.
 */
export async function classifyEmail(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: ClassifyEmailParams,
): Promise<ClassifyEmailResult> {
  // Step 1 — rate limit, before any provider call (docs/AI_GROUNDING.md §7). A blocked request
  // never reaches Claude and never costs anything; the caller falls back to leaving the message
  // unclassified rather than guessing.
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  const generationRunId = randomUUID();
  const systemPrompt = buildEmailClassificationSystemPrompt();

  const runAttempt = async (retryReason?: string) => {
    const userText = buildEmailClassificationUserPrompt({ ...params, retryReason });
    const started = Date.now();
    const callResult = await callClaudeForEmailClassification(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateEmailClassificationContract(callResult.rawText);
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, result: validated.result, latencyMs };
    }
    return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
  };

  // Step 2 — attempt 1, then exactly one retry, only on a rejection (refusal or contract
  // failure), never on a hard provider_error — same policy as the other two pipelines.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : 'the response was not valid JSON matching the required contract';
    outcome = await runAttempt(retryReasonText);
  }

  // Best-effort usage telemetry — never fails the user's actual request.
  await recordAiUsageEvent(supabase, userId, {
    applicationId: null,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: null,
    provider: PROVIDER,
    model: MODEL_ID,
    taskType: 'email_classification',
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
    promptVersion: EMAIL_CLASSIFICATION_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    // The provider was never meaningfully reached — give back the unit Step 1 pre-emptively
    // reserved (supabase/migrations/0033_ai_request_usage_accounting_fix.sql) — this is the exact
    // real incident this fixes: 50 consecutive Claude authentication failures from this path
    // silently exhausted a real account's entire shared quota with zero legitimate AI usage.
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'validation_failed' };
  }

  return {
    status: 'classified',
    classification: outcome.result.classification,
    confidence: outcome.result.confidence,
    evidence: outcome.result.evidence,
  };
}
