import { randomUUID } from 'node:crypto';
import {
  getCurrentOwnRequirementMappingRun,
  getOwnJobSnapshot,
  getOwnSubmissionPacketByApplicationId,
  incrementOwnAiRequestUsage,
  listCurrentOwnRequirementMappings,
  listOwnApprovedFactsForGeneration,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  actionAssistanceFor,
  type InterviewPrepResult,
  type InterviewPrepSubmittedAnswer,
  type NextActionType,
} from '@career-os/shared';
import { callClaudeForInterviewPrep } from './claude/call-claude';
import {
  INTERVIEW_PREP_PROMPT_VERSION,
  MODEL_ID,
  SUBMITTED_ANSWER_CHAR_CAP,
} from './config';
import { validateInterviewPrepContract } from './contract/validate-interview-prep-contract';
import { deriveEligibleNextAction } from './derive-eligible-next-action';
import { buildInterviewPrepSystemPrompt } from './prompt/build-interview-prep-system-prompt';
import { buildInterviewPrepUserPrompt } from './prompt/build-interview-prep-user-prompt';

export interface GenerateInterviewPrepParams {
  applicationId: string;
}

export type GenerateInterviewPrepResult =
  | { status: 'application_not_found' }
  | { status: 'action_not_current'; currentActionType: NextActionType }
  /** No job snapshot exists for this application at all — there is nothing role-specific to
   * prepare from (a bare status change into INTERVIEW with no captured posting). Never silently
   * generates a generic, ungrounded prep packet instead. */
  | { status: 'insufficient_context' }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'ok'; prep: InterviewPrepResult };

const PROVIDER = 'anthropic';

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Orchestrates one explicit, user-triggered interview-prep generation end to end
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3B"): eligibility gate -> rate limit -> retrieval -> one
 * Claude attempt -> validate -> at most one retry -> return. Same eligibility-before-rate-limit
 * ordering as `generate-follow-up-draft.ts`, same reasoning.
 *
 * Reuses Phase 5A's grounding architecture directly rather than a loose free-text call: a CURRENT
 * requirement-mapping run's real ids (if one exists) or a direct read of the job snapshot's own
 * requirement lists (if none does — this function NEVER triggers requirement-mapping generation
 * itself, silently or otherwise), plus `listOwnApprovedFactsForGeneration`'s same retrieval this
 * package already uses everywhere else, plus (when the application has one) the immutable
 * `submission_packets` row's frozen answers — read-only, never reconstructed or mutated.
 *
 * Ephemeral, same posture as the other Phase 5B/5C.3 pipelines: no persisted prep result, only the
 * `ai_usage_events` telemetry row.
 */
export async function generateInterviewPrep(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateInterviewPrepParams,
): Promise<GenerateInterviewPrepResult> {
  // Step 1 — eligibility gate, before anything billed.
  const current = await deriveEligibleNextAction(supabase, userId, params.applicationId);
  if (!current) {
    return { status: 'application_not_found' };
  }
  if (actionAssistanceFor(current.nextAction.type) !== 'INTERVIEW_PREP') {
    return { status: 'action_not_current', currentActionType: current.nextAction.type };
  }
  const { application } = current;

  if (!application.jobSnapshotId) {
    return { status: 'insufficient_context' };
  }
  const snapshot = await getOwnJobSnapshot(supabase, userId, application.jobSnapshotId);
  if (!snapshot) {
    return { status: 'insufficient_context' };
  }

  // Step 2 — rate limit, before any provider call (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 3 — retrieval. Missing facts degrade gracefully (handled by the prompt/validator, never
  // blocked here); a CURRENT requirement-mapping run is reused if one exists, never generated.
  const [currentRun, facts, submissionPacket] = await Promise.all([
    getCurrentOwnRequirementMappingRun(supabase, userId, snapshot.id),
    listOwnApprovedFactsForGeneration(supabase, userId),
    application.submissionPacketId
      ? getOwnSubmissionPacketByApplicationId(supabase, userId, application.id)
      : null,
  ]);
  const currentMapping = currentRun
    ? await listCurrentOwnRequirementMappings(supabase, userId, currentRun.id)
    : null;

  const submittedAnswersToReview: InterviewPrepSubmittedAnswer[] = (
    submissionPacket?.answersSnapshot ?? []
  ).map((answer) => ({
    fieldLabel: answer.fieldLabel,
    answerText: truncate(
      answer.finalText ?? answer.originalAnswer,
      SUBMITTED_ANSWER_CHAR_CAP,
    ),
  }));

  const systemPrompt = buildInterviewPrepSystemPrompt();
  const generationRunId = randomUUID();

  const runAttempt = async (retryReason?: string) => {
    const { userText, allowedFactIds, allowedRequirementIds } =
      buildInterviewPrepUserPrompt({
        snapshot,
        currentMapping,
        facts,
        retryReason,
      });
    const started = Date.now();
    const callResult = await callClaudeForInterviewPrep(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateInterviewPrepContract(
      callResult.rawText,
      allowedFactIds,
      allowedRequirementIds,
    );
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, prep: validated.prep, latencyMs };
    }
    return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
  };

  // Step 4 — attempt 1, then exactly one retry on rejection only.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : outcome.reason === 'unknown_source_fact_id'
          ? 'a sourceFactIds/sourceRequirementId(s) entry included an id outside the provided lists'
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
    taskType: 'interview_prep',
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
    promptVersion: INTERVIEW_PREP_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'validation_failed' };
  }

  // Step 5 — provenanceSummary/usedCurrentRequirementMapping are entirely server-computed, never
  // model output — same "provenance is never a model claim" posture as the follow-up pipeline's
  // usedContext.
  const usedCurrentRequirementMapping =
    currentMapping !== null && currentMapping.length > 0;
  const requirementCount = usedCurrentRequirementMapping
    ? (currentMapping?.length ?? 0)
    : snapshot.requiredQualifications.length + snapshot.preferredQualifications.length;
  const provenanceSummary =
    `Based on ${requirementCount} job requirement${requirementCount === 1 ? '' : 's'}` +
    `${usedCurrentRequirementMapping ? ' (from your current requirement analysis)' : ''} and ` +
    `${facts.length} approved profile fact${facts.length === 1 ? '' : 's'}.`;

  return {
    status: 'ok',
    prep: {
      ...outcome.prep,
      submittedAnswersToReview,
      provenanceSummary,
      usedCurrentRequirementMapping,
    },
  };
}
