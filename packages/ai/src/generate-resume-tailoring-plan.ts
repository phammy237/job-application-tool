import { randomUUID } from 'node:crypto';
import {
  decrementOwnAiRequestUsage,
  getCurrentOwnRequirementMappingRun,
  getOwnApplication,
  getOwnJobSnapshot,
  getOwnResumeVersion,
  incrementOwnAiRequestUsage,
  listCurrentOwnRequirementMappings,
  listOwnApprovedFactsForGeneration,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  applyResumeTailoringPlan,
  buildResumeTailoringOperationViews,
  computeResumeTailoringCoverage,
  computeResumeTailoringSummary,
  renderStructuredResumeToLatex,
  validateResumeTailoringPlan,
  type ResumeTailoringProposal,
  type ResumeTailoringRejectionReason,
  type ResumeTailoringResearchMode,
} from '@career-os/shared';
import { callClaudeForResumeTailoring } from './claude/call-claude';
import { MODEL_ID, RESUME_TAILORING_PROMPT_VERSION } from './config';
import { validateResumeTailoringContract } from './contract/validate-resume-tailoring-contract';
import { buildResumeTailoringSystemPrompt } from './prompt/build-resume-tailoring-system-prompt';
import { buildResumeTailoringUserPrompt } from './prompt/build-resume-tailoring-user-prompt';
import { selectResumeTailoringFacts } from './retrieval/select-resume-tailoring-facts';
import { resolveResumeTailoringResearchSnapshot } from './retrieval/resolve-resume-tailoring-research-snapshot';

export interface GenerateResumeTailoringPlanParams {
  applicationId: string;
  /** Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §4/§36/§37) — defaults to `JOB_ONLY` when
   * omitted, so every pre-7H call site (and every 7E/7F test) keeps its exact existing behavior
   * unchanged. Company research is never assumed just because a snapshot exists. */
  researchMode?: ResumeTailoringResearchMode;
  /** An explicit snapshot the caller wants used — ignored entirely when `researchMode` is
   * `JOB_ONLY` (§37). Never trusted blindly: re-resolved and ownership/compatibility-checked
   * server-side in `resolveResumeTailoringResearchSnapshot` before anything else happens (§6). */
  companyResearchSnapshotId?: string | null;
}

export type GenerateResumeTailoringPlanResult =
  | { status: 'application_not_found' }
  /** The application has no working résumé version selected at all — there is nothing to tailor
   * (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §3). */
  | { status: 'no_working_resume' }
  /** The working résumé version exists but its content is `METADATA_ONLY` (pre-Phase-7C, or never
   * given structured content) — there is no structured content to safely apply operations to
   * (§3). Never silently falls back to treating raw text as structured. */
  | { status: 'unsupported_resume_format' }
  /** No job snapshot exists for this application — there is nothing role-specific to tailor
   * toward (§4). */
  | { status: 'missing_job_snapshot' }
  /** Phase 7H — an explicit `companyResearchSnapshotId` was given but doesn't resolve to a
   * snapshot owned by this user (§6). Never returned for the no-explicit-id "use latest
   * research" path, which degrades to `JOB_ONLY` instead (§4). */
  | { status: 'research_snapshot_not_found' }
  /** Phase 7H — an explicit `companyResearchSnapshotId` resolved to a real snapshot, but its
   * frozen company/role/job-snapshot identity no longer matches this application's current
   * context (§7) — never silently used. */
  | { status: 'stale_company_research' }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'ok'; proposal: ResumeTailoringProposal };

const PROVIDER = 'anthropic';

/** Every rejection this pipeline's own deep validator can produce maps onto one of the three
 * existing `ai_usage_events.rejection_reason` values (no new DB value needed, confirmed against
 * the live linked project before writing migration 0023, docs/IMPLEMENTATION_PLAN.md "Phase 7E"
 * §57): an unknown/unsupplied id is the same "the model cited something it wasn't given" failure
 * every other pipeline already reports as `unknown_source_fact_id`; a structural problem
 * (conflicting operations, an out-of-range index, a malformed skill reorder) is a
 * `validation_failed`; an invented number or technology is the same "claimed something without
 * real support" failure the unsupported-claims check pipeline already reports as
 * `unsupported_claims_present`. */
function mapRejectionReason(
  reason: 'validation_failed' | ResumeTailoringRejectionReason,
): 'validation_failed' | 'unknown_source_fact_id' | 'unsupported_claims_present' {
  switch (reason) {
    case 'unknown_bullet_id':
    case 'unknown_entry_id':
    case 'unknown_skill_group_id':
    case 'unknown_fact_id':
    case 'unknown_requirement_id':
    case 'unknown_research_finding_id':
      return 'unknown_source_fact_id';
    case 'validation_failed':
    case 'invalid_skill_reorder':
    case 'invalid_target_index':
    case 'operation_conflict':
      return 'validation_failed';
    case 'ungrounded_number':
    case 'ungrounded_technology':
      return 'unsupported_claims_present';
  }
}

/**
 * Orchestrates one explicit, user-triggered résumé-tailoring generation end to end
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7E"): eligibility gate -> rate limit -> retrieval -> one
 * Claude attempt -> shape validation -> deep semantic validation -> at most one retry on
 * rejection only -> apply the validated plan to a COPY of the base résumé -> render -> return.
 * Same eligibility-before-rate-limit ordering as generate-follow-up-draft.ts/
 * generate-interview-prep.ts, same reasoning: every eligibility check below is a free read, so a
 * structurally ineligible request (no working résumé, unsupported format, no job snapshot) costs
 * the user's quota nothing.
 *
 * The base résumé is always re-derived here, from the application's CURRENT
 * `workingResumeVersionId`, never trusted from anything the caller passed in (§3/§40) — there is
 * no `resumeVersionId` parameter on this function at all, by construction, so there is nothing
 * for a caller to get wrong or a client to spoof.
 *
 * Fully ephemeral, same posture as every other Phase 5B/5C.3 pipeline in this package: this
 * function never creates a résumé version, never changes `working_resume_version_id`, never
 * touches `applications`/`submission_packets` in any way (§21/§45) — its only durable side effect
 * is the best-effort `ai_usage_events` telemetry row below, and even that never fails the user's
 * actual request if the insert itself fails.
 *
 * Phase 7H (docs/IMPLEMENTATION_PLAN.md "Phase 7H") extends this same pipeline — never a parallel
 * one — with an OPTIONAL, explicit company-research snapshot: `resolveResumeTailoringResearchSnapshot`
 * (a free read, run before the rate-limit check) resolves at most one exact immutable Phase 7G
 * snapshot, folds a bounded, ranked subset of its findings into this same single Claude call, and
 * lets the model justify emphasis (never facts) with `researchFindingIds`. Zero additional
 * Tavily/Claude calls are ever made here (§5/§27/§28/§65) — this pipeline only ever reads research
 * that was already generated and persisted by the separate, explicit Phase 7G flow.
 */
export async function generateResumeTailoringPlan(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateResumeTailoringPlanParams,
): Promise<GenerateResumeTailoringPlanResult> {
  // Step 1 — eligibility gate, before anything billed. Every check here is a free read.
  const application = await getOwnApplication(supabase, userId, params.applicationId);
  if (!application) {
    return { status: 'application_not_found' };
  }
  if (!application.workingResumeVersionId) {
    return { status: 'no_working_resume' };
  }
  const resumeVersion = await getOwnResumeVersion(
    supabase,
    userId,
    application.workingResumeVersionId,
  );
  if (!resumeVersion) {
    // Defensive — the composite FK (migration 0021) should make this impossible in practice.
    return { status: 'no_working_resume' };
  }
  if (resumeVersion.snapshotFormat !== 'STRUCTURED_V1') {
    return { status: 'unsupported_resume_format' };
  }
  const baseResume = resumeVersion.snapshotPayload;

  if (!application.jobSnapshotId) {
    return { status: 'missing_job_snapshot' };
  }
  const snapshot = await getOwnJobSnapshot(supabase, userId, application.jobSnapshotId);
  if (!snapshot) {
    return { status: 'missing_job_snapshot' };
  }

  // Step 1b — Phase 7H company-research snapshot resolution, still before any billed call: this
  // is also a free read, and an explicit-but-invalid request is a real rejection that must not
  // cost the user's quota (§6/§7).
  const requestedResearchMode = params.researchMode ?? 'JOB_ONLY';
  const researchResolution = await resolveResumeTailoringResearchSnapshot(supabase, userId, {
    applicationId: application.id,
    company: application.company,
    title: application.title,
    jobSnapshotId: application.jobSnapshotId,
    researchMode: requestedResearchMode,
    requestedSnapshotId: params.companyResearchSnapshotId ?? null,
  });
  if (researchResolution.status === 'not_found') {
    return { status: 'research_snapshot_not_found' };
  }
  if (researchResolution.status === 'context_mismatch') {
    return { status: 'stale_company_research' };
  }
  // `none` (JOB_ONLY, or JOB_PLUS_COMPANY_RESEARCH with nothing compatible found) degrades
  // honestly rather than erroring (§4) — the proposal's own `researchMode` always reflects what
  // ACTUALLY happened, never what was requested.
  const researchSnapshot = researchResolution.status === 'ok' ? researchResolution.snapshot : null;
  const effectiveResearchMode: ResumeTailoringResearchMode = researchSnapshot
    ? 'JOB_PLUS_COMPANY_RESEARCH'
    : 'JOB_ONLY';

  // Step 2 — rate limit, before any provider call (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 3 — retrieval. A CURRENT requirement-mapping run is reused if one exists, never
  // generated by this pipeline (§5) — same "degrade honestly, never silently chain another AI
  // call" posture as generate-interview-prep.ts.
  const [currentRun, allApprovedFacts] = await Promise.all([
    getCurrentOwnRequirementMappingRun(supabase, userId, snapshot.id),
    listOwnApprovedFactsForGeneration(supabase, userId),
  ]);
  const currentMapping = currentRun
    ? await listCurrentOwnRequirementMappings(supabase, userId, currentRun.id)
    : null;
  const facts = selectResumeTailoringFacts(allApprovedFacts, baseResume, currentMapping);

  const systemPrompt = buildResumeTailoringSystemPrompt();
  const generationRunId = randomUUID();

  // Built once, outside the retry loop — these are entirely determined by baseResume/facts/
  // currentMapping/snapshot, none of which changes between attempt 1 and the retry. The prompt
  // itself is still rebuilt per attempt (only its trailing retryReason sentence differs).
  const promptBuild = buildResumeTailoringUserPrompt({
    snapshot,
    currentMapping,
    baseResume,
    facts,
    researchSnapshot,
  });
  const {
    allowedFactIds,
    factTextById,
    requirementContext,
    allowedRequirementIds,
    mappingIsMissing,
    allowedResearchFindingIds,
    researchFindingsById,
    selectedResearchFindingCount,
  } = promptBuild;
  const requirementTextById = new Map(requirementContext.map((r) => [r.id, r.text]));

  const runAttempt = async (retryReason?: string) => {
    const { userText } = retryReason
      ? buildResumeTailoringUserPrompt({
          snapshot,
          currentMapping,
          baseResume,
          facts,
          researchSnapshot,
          retryReason,
        })
      : promptBuild;

    const started = Date.now();
    const callResult = await callClaudeForResumeTailoring(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }

    const shapeResult = validateResumeTailoringContract(callResult.rawText);
    if (shapeResult.status !== 'ok') {
      return { kind: 'rejected' as const, reason: 'validation_failed' as const, latencyMs };
    }

    const deepResult = validateResumeTailoringPlan(shapeResult.plan, baseResume, {
      factIds: allowedFactIds,
      factTextById,
      requirementIds: allowedRequirementIds,
      researchFindingIds: allowedResearchFindingIds,
    });
    if (deepResult.status !== 'ok') {
      return { kind: 'rejected' as const, reason: deepResult.reason, latencyMs };
    }

    return { kind: 'accepted' as const, operations: deepResult.operations, latencyMs };
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
        : outcome.reason === 'validation_failed'
          ? 'the response was not valid JSON matching the required contract'
          : `a plan was rejected (${outcome.reason}) — every id must come from what was offered, ` +
            `operations must not conflict, and every number/technology in a rewrite or new bullet ` +
            `must already appear in the bullet being rewritten or in a cited fact`;
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
    taskType: 'resume_tailoring',
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
    promptVersion: RESUME_TAILORING_PROMPT_VERSION,
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

  // Step 5 — apply the validated plan to a COPY of the base résumé; render via the exact same
  // deterministic pure renderer the Studio uses for structured content (§22) — the model never
  // touches rendering, and nothing here mutates baseResume, resumeVersion, application, or any
  // other persisted row (§20/§21/§45). Deliberately `renderStructuredResumeToLatex`, not
  // `getLatexForResumeVersion` — the latter applies the base version's own Advanced override when
  // one is present, which would silently discard every proposed edit from the preview. Tailoring
  // always operates on canonical structured content only; when `customLatexOverridePresent` is
  // true, this preview intentionally differs from what the base version currently renders as,
  // and the UI surfaces that as an explicit warning rather than pretending the override was
  // edited too.
  const proposedResume = applyResumeTailoringPlan(baseResume, outcome.operations);
  const proposedResumeLatex = renderStructuredResumeToLatex(proposedResume);

  const proposal: ResumeTailoringProposal = {
    baseResumeVersionId: resumeVersion.id,
    baseResumeDisplayName: resumeVersion.displayName,
    baseResumeVersionNumber: resumeVersion.versionNumber,
    jobSnapshotId: snapshot.id,
    requirementMappingRunId: currentRun?.id ?? null,
    baseResume,
    customLatexOverridePresent: baseResume.renderOverride !== null,
    researchMode: effectiveResearchMode,
    companyResearchSnapshotId: researchSnapshot?.id ?? null,
    companyResearchResearchedAt: researchSnapshot?.researchedAt ?? null,
    selectedResearchFindingCount,
    operations: buildResumeTailoringOperationViews(
      outcome.operations,
      baseResume,
      factTextById,
      requirementTextById,
      researchFindingsById,
    ),
    summary: computeResumeTailoringSummary(outcome.operations),
    coverage: computeResumeTailoringCoverage(outcome.operations, requirementContext, mappingIsMissing),
    proposedResumeLatex,
  };

  return { status: 'ok', proposal };
}
