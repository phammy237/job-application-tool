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
  computeInterviewPrepResearchSummary,
  resolveInterviewPrepItemsCompanyRelevance,
  type CompanyResearchMode,
  type InterviewPrepResult,
  type InterviewPrepSubmittedAnswer,
  type NextActionType,
} from '@career-os/shared';
import { callClaudeForInterviewPrep } from './claude/call-claude';
import {
  INTERVIEW_PREP_PROMPT_VERSION,
  MODEL_ID,
  RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT,
  SUBMITTED_ANSWER_CHAR_CAP,
} from './config';
import {
  validateInterviewPrepContract,
  type InterviewPrepContractValidationResult,
} from './contract/validate-interview-prep-contract';
import { deriveEligibleNextAction } from './derive-eligible-next-action';
import { buildInterviewPrepSystemPrompt } from './prompt/build-interview-prep-system-prompt';
import { buildInterviewPrepUserPrompt } from './prompt/build-interview-prep-user-prompt';
import { resolveCompanyResearchSnapshotForRequest } from './retrieval/resolve-company-research-snapshot';

export interface GenerateInterviewPrepParams {
  applicationId: string;
  /** Phase 7I (docs/IMPLEMENTATION_PLAN.md "Phase 7I") — defaults to `JOB_ONLY` when omitted, so
   * every pre-7I call site (and every 5C.3B test) keeps its exact existing behavior unchanged.
   * Company research is never assumed just because a snapshot exists. */
  researchMode?: CompanyResearchMode;
  /** An explicit snapshot the caller wants used — ignored entirely when `researchMode` is
   * `JOB_ONLY`. Never trusted blindly: re-resolved and ownership/compatibility-checked
   * server-side before anything else happens. */
  companyResearchSnapshotId?: string | null;
}

export type GenerateInterviewPrepResult =
  | { status: 'application_not_found' }
  | { status: 'action_not_current'; currentActionType: NextActionType }
  /** No job snapshot exists for this application at all — there is nothing role-specific to
   * prepare from (a bare status change into INTERVIEW with no captured posting). Never silently
   * generates a generic, ungrounded prep packet instead. */
  | { status: 'insufficient_context' }
  /** Phase 7I — an explicit `companyResearchSnapshotId` was given but doesn't resolve to a
   * snapshot owned by this user. Never returned for the no-explicit-id "use latest research"
   * path, which degrades to `JOB_ONLY` instead. */
  | { status: 'research_snapshot_not_found' }
  /** Phase 7I — an explicit `companyResearchSnapshotId` resolved to a real snapshot, but its
   * frozen company/role/job-snapshot identity no longer matches this application's current
   * context — never silently used. */
  | { status: 'stale_company_research' }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'ok'; prep: InterviewPrepResult };

const PROVIDER = 'anthropic';

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/** Every rejection this pipeline's own validator can produce maps onto one of the three existing
 * `ai_usage_events.rejection_reason` values — same posture/precedent as résumé tailoring's own
 * `mapRejectionReason` (docs/IMPLEMENTATION_PLAN.md "Phase 7H"): an unknown/unsupplied id
 * (including an out-of-allowlist `researchFindingIds` entry, Phase 7I) is the same "the model
 * cited something it wasn't given" failure already reported as `unknown_source_fact_id`; an
 * invented number or technology (Phase 7I's candidate-fact-safety guard) is the same "claimed
 * something without real support" failure already reported as `unsupported_claims_present`. */
function mapRejectionReason(
  reason: 'validation_failed' | Exclude<InterviewPrepContractValidationResult, { status: 'ok' }>['reason'],
): 'validation_failed' | 'unknown_source_fact_id' | 'unsupported_claims_present' {
  switch (reason) {
    case 'unknown_source_fact_id':
      return 'unknown_source_fact_id';
    case 'validation_failed':
      return 'validation_failed';
    case 'ungrounded_number':
    case 'ungrounded_technology':
      return 'unsupported_claims_present';
  }
}

/**
 * Orchestrates one explicit, user-triggered interview-prep generation end to end
 * (docs/IMPLEMENTATION_PLAN.md "Phase 5C.3B"): eligibility gate -> rate limit -> retrieval -> one
 * Claude attempt -> validate -> at most one retry -> return. Same eligibility-before-rate-limit
 * ordering as generate-follow-up-draft.ts, same reasoning.
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
 *
 * Phase 7I (docs/IMPLEMENTATION_PLAN.md "Phase 7I") extends this same pipeline — never a parallel
 * one — with an OPTIONAL, explicit company-research snapshot:
 * `resolveCompanyResearchSnapshotForRequest` (a free read, run before the rate-limit check, the
 * exact same generic primitive Phase 7H's résumé tailoring uses) resolves at most one exact
 * immutable Phase 7G snapshot, folds a bounded, ranked subset of its findings into this same
 * single Claude call, and lets the model justify preparation relevance (never candidate facts)
 * with `researchFindingIds`. Zero additional Tavily/Claude calls are ever made here — this
 * pipeline only ever reads research that was already generated and persisted by the separate,
 * explicit Phase 7G flow.
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

  // Step 1b — Phase 7I company-research snapshot resolution, still before any billed call: this
  // is also a free read, and an explicit-but-invalid request is a real rejection that must not
  // cost the user's quota.
  const requestedResearchMode = params.researchMode ?? 'JOB_ONLY';
  const researchResolution = await resolveCompanyResearchSnapshotForRequest(supabase, userId, {
    applicationId: application.id,
    company: application.company,
    title: application.title,
    jobSnapshotId: application.jobSnapshotId,
    researchMode: requestedResearchMode,
    requestedSnapshotId: params.companyResearchSnapshotId ?? null,
    autoResolveCandidateLimit: RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT,
  });
  if (researchResolution.status === 'not_found') {
    return { status: 'research_snapshot_not_found' };
  }
  if (researchResolution.status === 'context_mismatch') {
    return { status: 'stale_company_research' };
  }
  // `none` (JOB_ONLY, or JOB_PLUS_COMPANY_RESEARCH with nothing compatible found) degrades
  // honestly rather than erroring — the result's own `researchMode` always reflects what
  // ACTUALLY happened, never what was requested.
  const researchSnapshot = researchResolution.status === 'ok' ? researchResolution.snapshot : null;
  const effectiveResearchMode: CompanyResearchMode = researchSnapshot
    ? 'JOB_PLUS_COMPANY_RESEARCH'
    : 'JOB_ONLY';

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

  const promptBuild = buildInterviewPrepUserPrompt({
    snapshot,
    currentMapping,
    facts,
    researchSnapshot,
  });
  const {
    allowedFactIds,
    factTextById,
    allowedRequirementIds,
    allowedResearchFindingIds,
    researchFindingsById,
    selectedResearchFindingCount,
  } = promptBuild;

  const runAttempt = async (retryReason?: string) => {
    const { userText } = retryReason
      ? buildInterviewPrepUserPrompt({
          snapshot,
          currentMapping,
          facts,
          researchSnapshot,
          retryReason,
        })
      : promptBuild;
    const started = Date.now();
    const callResult = await callClaudeForInterviewPrep(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateInterviewPrepContract(callResult.rawText, {
      factIds: allowedFactIds,
      factTextById,
      requirementIds: allowedRequirementIds,
      researchFindingIds: allowedResearchFindingIds,
    });
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
          ? 'a sourceFactIds/sourceRequirementId(s)/researchFindingIds entry included an id outside the provided lists'
          : outcome.reason === 'ungrounded_number' || outcome.reason === 'ungrounded_technology'
            ? 'a candidate-specific item introduced a number or technology not present in its cited facts — company research can justify relevance, never a candidate claim'
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
      outcome.kind === 'rejected' && outcome.reason !== 'refusal'
        ? mapRejectionReason(outcome.reason)
        : null,
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

  // Step 5 — provenanceSummary/usedCurrentRequirementMapping/companyRelevance/research summary
  // counts are entirely server-computed, never model output — same "provenance is never a model
  // claim" posture as the follow-up pipeline's usedContext and résumé tailoring's own summary.
  const usedCurrentRequirementMapping =
    currentMapping !== null && currentMapping.length > 0;
  const requirementCount = usedCurrentRequirementMapping
    ? (currentMapping?.length ?? 0)
    : snapshot.requiredQualifications.length + snapshot.preferredQualifications.length;
  const provenanceSummary =
    `Based on ${requirementCount} job requirement${requirementCount === 1 ? '' : 's'}` +
    `${usedCurrentRequirementMapping ? ' (from your current requirement analysis)' : ''} and ` +
    `${facts.length} approved profile fact${facts.length === 1 ? '' : 's'}.`;

  const { prep } = outcome;
  const { researchFindingsReferenced, itemsInfluencedByResearch } =
    computeInterviewPrepResearchSummary([
      ...prep.rolePriorities.map((item) => item.researchFindingIds),
      ...prep.evidenceToEmphasize.map((item) => item.researchFindingIds),
      ...prep.starStoryPrompts.map((item) => item.researchFindingIds),
      ...prep.possibleQuestions.map((item) => item.researchFindingIds),
      ...prep.questionsToAsk.map((item) => item.researchFindingIds),
      ...prep.gapsToPrepare.map((item) => item.researchFindingIds),
    ]);

  return {
    status: 'ok',
    prep: {
      rolePriorities: resolveInterviewPrepItemsCompanyRelevance(
        prep.rolePriorities,
        researchFindingsById,
      ),
      evidenceToEmphasize: resolveInterviewPrepItemsCompanyRelevance(
        prep.evidenceToEmphasize,
        researchFindingsById,
      ),
      starStoryPrompts: resolveInterviewPrepItemsCompanyRelevance(
        prep.starStoryPrompts,
        researchFindingsById,
      ),
      possibleQuestions: resolveInterviewPrepItemsCompanyRelevance(
        prep.possibleQuestions,
        researchFindingsById,
      ),
      questionsToAsk: resolveInterviewPrepItemsCompanyRelevance(
        prep.questionsToAsk,
        researchFindingsById,
      ),
      gapsToPrepare: resolveInterviewPrepItemsCompanyRelevance(
        prep.gapsToPrepare,
        researchFindingsById,
      ),
      submittedAnswersToReview,
      provenanceSummary,
      usedCurrentRequirementMapping,
      researchMode: effectiveResearchMode,
      companyResearchSnapshotId: researchSnapshot?.id ?? null,
      companyResearchResearchedAt: researchSnapshot?.researchedAt ?? null,
      selectedResearchFindingCount,
      researchFindingsReferenced,
      itemsInfluencedByResearch,
    },
  };
}
