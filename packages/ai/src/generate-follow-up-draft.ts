import { randomUUID } from 'node:crypto';
import {
  decrementOwnAiRequestUsage,
  getOwnJobSnapshot,
  getOwnProfile,
  incrementOwnAiRequestUsage,
  listOwnEmailSignalsForApplication,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  actionAssistanceFor,
  type FollowUpDraftResult,
  type FollowUpDraftUsedContextTag,
  type NextActionType,
} from '@career-os/shared';
import { callClaudeForFollowUpDraft } from './claude/call-claude';
import { FOLLOW_UP_DRAFT_PROMPT_VERSION, MODEL_ID } from './config';
import { validateFollowUpDraftContract } from './contract/validate-follow-up-draft-contract';
import { deriveEligibleNextAction } from './derive-eligible-next-action';
import { buildFollowUpDraftSystemPrompt } from './prompt/build-follow-up-draft-system-prompt';
import { buildFollowUpDraftUserPrompt } from './prompt/build-follow-up-draft-user-prompt';

export interface GenerateFollowUpDraftParams {
  applicationId: string;
}

export type GenerateFollowUpDraftResult =
  | { status: 'application_not_found' }
  /** The deterministic next action for this application is no longer CONSIDER_FOLLOW_UP (e.g. a
   * status change landed since the page loaded) — this pipeline never generates a draft for an
   * action that is no longer current (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3C"). */
  | { status: 'action_not_current'; currentActionType: NextActionType }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'ok'; draft: FollowUpDraftResult };

const PROVIDER = 'anthropic';

/**
 * Orchestrates one explicit, user-triggered follow-up draft end to end
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3A"): eligibility gate -> rate limit -> retrieval -> one
 * Claude attempt -> validate -> at most one retry -> return. Deliberately checks eligibility
 * *before* the rate limit (unlike the Phase 5A/5B pipelines, which rate-limit first) — a
 * structurally ineligible request (ownership failure, or a next action that is no longer
 * CONSIDER_FOLLOW_UP) costs the user's quota nothing, since it was never going to produce a
 * result regardless of what a provider call would return.
 *
 * Ephemeral, same posture as `generate-unsupported-claims-check.ts`: no run-lifecycle table, no
 * persisted draft — the only trace of an attempt is the existing `ai_usage_events` telemetry row
 * (best-effort, never fails the user's actual request). This pipeline never decides *whether* to
 * follow up or *when* — that is `deriveEligibleNextAction`'s job, already decided by the time this
 * function's rate-limit step even runs; the model only ever helps with wording.
 */
export async function generateFollowUpDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateFollowUpDraftParams,
): Promise<GenerateFollowUpDraftResult> {
  // Step 1 — eligibility gate, before anything billed.
  const current = await deriveEligibleNextAction(supabase, userId, params.applicationId);
  if (!current) {
    return { status: 'application_not_found' };
  }
  if (actionAssistanceFor(current.nextAction.type) !== 'FOLLOW_UP_DRAFT') {
    return { status: 'action_not_current', currentActionType: current.nextAction.type };
  }
  const { application, nextAction } = current;

  // Step 2 — rate limit, before any provider call (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 3 — retrieval. Every input here is either already on the `applications` row, or one of a
  // small, explicitly-allowed set of *confirmed* trusted sources — never a PENDING/DECLINED email
  // signal (listOwnEmailSignalsForApplication returns every signal for this application
  // regardless of confirmationStatus; filtered here to CONFIRMED/AUTO_APPLIED only, the same two
  // states that were ever allowed to move `applications.status` in the first place).
  const [jobSnapshot, emailSignals, profile] = await Promise.all([
    application.jobSnapshotId
      ? getOwnJobSnapshot(supabase, userId, application.jobSnapshotId)
      : null,
    listOwnEmailSignalsForApplication(supabase, userId, application.id),
    getOwnProfile(supabase, userId),
  ]);
  const confirmedEmailSignal =
    emailSignals.find(
      (signal) =>
        signal.confirmationStatus === 'CONFIRMED' ||
        signal.confirmationStatus === 'AUTO_APPLIED',
    ) ?? null;
  const candidateName = profile?.fullName ?? null;

  const systemPrompt = buildFollowUpDraftSystemPrompt();
  const generationRunId = randomUUID();

  const runAttempt = async (retryReason?: string) => {
    const userText = buildFollowUpDraftUserPrompt({
      application: {
        company: application.company,
        title: application.title,
        status: application.status,
        appliedAt: application.appliedAt,
      },
      nextAction: {
        followUpAnchorAt: nextAction.followUpAnchorAt,
        daysSinceFollowUpAnchor: nextAction.daysSinceFollowUpAnchor,
      },
      jobSnapshot,
      confirmedEmailSignal,
      candidateName,
      retryReason,
    });
    const started = Date.now();
    const callResult = await callClaudeForFollowUpDraft(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateFollowUpDraftContract(callResult.rawText);
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, draft: validated.draft, latencyMs };
    }
    return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
  };

  // Step 4 — attempt 1, then exactly one retry on rejection only, matching every other pipeline's
  // policy in this package.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : outcome.reason === 'fabricated_interaction_claim'
          ? 'the draft implied a conversation, referral, interview, or assessment that was never given to you as a fact'
          : 'the response was not valid JSON matching the required contract';
    outcome = await runAttempt(retryReasonText);
  }

  // Best-effort usage telemetry — never fails the user's actual request.
  await recordAiUsageEvent(supabase, userId, {
    applicationId: application.id,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: null,
    provider: PROVIDER,
    model: MODEL_ID,
    taskType: 'follow_up_draft',
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
        ? 'validation_failed'
        : null,
    escalationReason: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: null,
    latencyMs: outcome.latencyMs,
    promptVersion: FOLLOW_UP_DRAFT_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    // Claude was never meaningfully reached — give back the unit reserved earlier
    // (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'validation_failed' };
  }

  // Step 5 — usedContext is entirely server-computed from what was actually retrieved above,
  // never model output (see followUpDraftUsedContextTagSchema's own doc comment).
  const usedContext: FollowUpDraftUsedContextTag[] = ['APPLICATION_STATUS'];
  if (application.appliedAt) usedContext.push('APPLICATION_DATE');
  if (nextAction.daysSinceFollowUpAnchor !== null) usedContext.push('FOLLOW_UP_TIMING');
  if (jobSnapshot) usedContext.push('JOB_SNAPSHOT');
  if (confirmedEmailSignal) usedContext.push('CONFIRMED_EMPLOYER_EMAIL');
  if (candidateName) usedContext.push('CANDIDATE_NAME');

  return {
    status: 'ok',
    draft: { subject: outcome.draft.subject, body: outcome.draft.body, usedContext },
  };
}
