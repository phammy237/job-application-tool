import { randomUUID } from 'node:crypto';
import {
  createCompanyResearchSnapshot,
  decrementOwnAiRequestUsage,
  getCurrentOwnRequirementMappingRun,
  getOwnApplication,
  getOwnJobSnapshot,
  incrementOwnAiRequestUsage,
  listCurrentOwnRequirementMappings,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  validateCompanyResearchPlan,
  type CompanyResearchFinding,
  type CompanyResearchSnapshot,
  type CompanyResearchSourceType,
} from '@career-os/shared';
import { callClaudeForCompanyResearch } from './claude/call-claude';
import { COMPANY_RESEARCH_PROMPT_VERSION, MODEL_ID } from './config';
import { validateCompanyResearchContract } from './contract/validate-company-research-contract';
import { buildCompanyResearchSystemPrompt } from './prompt/build-company-research-system-prompt';
import { buildCompanyResearchUserPrompt } from './prompt/build-company-research-user-prompt';
import { discoverAndExtractCompanyResearchSources } from './research/discover-and-extract-company-research-sources';

export interface GenerateCompanyResearchParams {
  applicationId: string;
}

export type GenerateCompanyResearchResult =
  | { status: 'application_not_found' }
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'research_provider_unavailable' }
  | { status: 'no_useful_sources' }
  | { status: 'insufficient_source_evidence' }
  | { status: 'search_provider_error'; message: string }
  | { status: 'ai_provider_unavailable'; message: string }
  | { status: 'invalid_research_output' }
  | { status: 'stale_application_context' }
  | { status: 'ok'; snapshot: CompanyResearchSnapshot };

const PROVIDER = 'anthropic';

/**
 * Orchestrates one explicit, user-triggered company-research generation end to end
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G"): eligibility -> rate limit -> deterministic query
 * generation -> bounded search+extraction -> one Claude synthesis attempt (+ at most one retry) ->
 * shape/deep validation -> staleness re-check -> atomic persistence. RESEARCH ONLY (§"Phase 7G"
 * top): never creates/changes a résumé version, never touches `working_resume_version_id`, never
 * calls Phase 7E/7F, never regenerates interview prep, and never sends the candidate's résumé,
 * approved facts, or any other candidate-specific data to either the search provider or Claude
 * (§40).
 *
 * `companyName`/`roleTitle` are always the application's CURRENT `company`/`title` fields,
 * re-derived here — there is no way for a caller to supply an arbitrary company/role to research
 * on this application's behalf.
 */
export async function generateCompanyResearch(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateCompanyResearchParams,
): Promise<GenerateCompanyResearchResult> {
  // Step 1 — eligibility gate, before anything billed or network-bound. A free read.
  const application = await getOwnApplication(supabase, userId, params.applicationId);
  if (!application) {
    return { status: 'application_not_found' };
  }
  const companyName = application.company;
  const roleTitle = application.title;
  const jobSnapshotId = application.jobSnapshotId;

  // Step 2 — rate limit, before any external call (search or AI) — company research is expensive
  // as a whole action, not just its final AI call (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §37).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 3 — job context, reused exactly like every other pipeline in this package (never
  // triggers Phase 5A generation itself; degrades honestly when no mapping/snapshot exists, §43).
  const jobSnapshot = jobSnapshotId
    ? await getOwnJobSnapshot(supabase, userId, jobSnapshotId)
    : null;
  const currentMapping = jobSnapshot
    ? await getCurrentOwnRequirementMappingRun(supabase, userId, jobSnapshot.id).then(
        (run) =>
          run ? listCurrentOwnRequirementMappings(supabase, userId, run.id) : null,
      )
    : null;

  const topRequirementTopics = [
    currentMapping?.[0]?.requirementText,
    jobSnapshot?.requiredQualifications[0],
    jobSnapshot?.preferredQualifications[0],
    jobSnapshot?.skills[0],
  ].filter((t): t is string => Boolean(t && t.trim().length > 0));

  // Step 4 — bounded web retrieval, entirely separate from AI synthesis (§16). No ai_usage_events
  // row is recorded for any outcome here — no AI call has happened yet.
  const discovery = await discoverAndExtractCompanyResearchSources({
    companyName,
    roleTitle,
    topRequirementTopics,
  });
  if (discovery.status === 'research_provider_unavailable') {
    return { status: 'research_provider_unavailable' };
  }
  if (discovery.status === 'no_useful_sources') {
    return { status: 'no_useful_sources' };
  }
  if (discovery.status === 'insufficient_source_evidence') {
    return { status: 'insufficient_source_evidence' };
  }
  if (discovery.status === 'provider_error') {
    // The search provider was never meaningfully reached and no Claude call has happened yet —
    // give back the unit Step 2 pre-emptively reserved
    // (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    return { status: 'search_provider_error', message: discovery.message };
  }

  const systemPrompt = buildCompanyResearchSystemPrompt();
  const promptBuild = buildCompanyResearchUserPrompt({
    companyName,
    roleTitle,
    jobSnapshot,
    currentMapping,
    sources: discovery.sources.map((s) => ({
      id: s.id,
      title: s.title,
      publisher: s.publisher,
      publishedAt: s.publishedAt,
      text: s.text,
    })),
  });
  const { allowedSourceIds, allowedRequirementIds } = promptBuild;
  const generationRunId = randomUUID();

  const runAttempt = async (retryReason?: string) => {
    const { userText } = retryReason
      ? buildCompanyResearchUserPrompt({
          companyName,
          roleTitle,
          jobSnapshot,
          currentMapping,
          sources: discovery.sources.map((s) => ({
            id: s.id,
            title: s.title,
            publisher: s.publisher,
            publishedAt: s.publishedAt,
            text: s.text,
          })),
          retryReason,
        })
      : promptBuild;

    const started = Date.now();
    const callResult = await callClaudeForCompanyResearch(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }

    const shapeResult = validateCompanyResearchContract(callResult.rawText);
    if (shapeResult.status !== 'ok') {
      return {
        kind: 'rejected' as const,
        reason: 'validation_failed' as const,
        latencyMs,
      };
    }

    const deepResult = validateCompanyResearchPlan(shapeResult.plan, {
      sourceIds: allowedSourceIds,
      requirementIds: allowedRequirementIds,
    });
    if (deepResult.status !== 'ok') {
      return { kind: 'rejected' as const, reason: deepResult.reason, latencyMs };
    }

    return { kind: 'accepted' as const, findings: deepResult.findings, latencyMs };
  };

  // Step 5 — attempt 1, then exactly one retry on rejection only (§38).
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : outcome.reason === 'validation_failed'
          ? 'the response was not valid JSON matching the required contract'
          : outcome.reason === 'no_findings'
            ? 'zero findings were returned — if the sources genuinely support nothing, that is a ' +
              'valid answer, but double check every source before concluding that'
            : `a plan was rejected (${outcome.reason}) — every sourceId must come from a given ` +
              `<source> tag, and every requirementId must come from <job_context>'s requirement list`;
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
    taskType: 'company_research',
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
        ? outcome.reason === 'no_findings'
          ? 'unsupported_claims_present'
          : outcome.reason === 'validation_failed'
            ? 'validation_failed'
            : 'unknown_source_fact_id'
        : null,
    escalationReason: null,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCost: null,
    latencyMs: outcome.latencyMs,
    promptVersion: COMPANY_RESEARCH_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    // Claude was never meaningfully reached — give back the unit Step 2 pre-emptively reserved
    // (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    return { status: 'ai_provider_unavailable', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    return { status: 'invalid_research_output' };
  }

  // Step 6 — staleness re-check, right before persistence (§76): if the application's own
  // company/role/job-context changed while research was in flight, never save a snapshot
  // mislabeled with a company/role it no longer describes.
  const freshApplication = await getOwnApplication(
    supabase,
    userId,
    params.applicationId,
  );
  if (
    !freshApplication ||
    freshApplication.company !== companyName ||
    freshApplication.title !== roleTitle ||
    (freshApplication.jobSnapshotId ?? null) !== (jobSnapshotId ?? null)
  ) {
    return { status: 'stale_application_context' };
  }

  // Step 7 — resolve findings against their full source objects (for the persistence payload and
  // the returned snapshot alike) and persist atomically.
  const sourceById = new Map(discovery.sources.map((s) => [s.id, s]));
  const findings: CompanyResearchFinding[] = outcome.findings.map((f) => ({
    id: randomUUID(),
    category: f.category,
    claim: f.claim,
    roleRelevance: f.roleRelevance ?? null,
    requirementIds: f.requirementIds,
    sources: f.sourceIds.map((id) => {
      const source = sourceById.get(id)!;
      return {
        id: source.id,
        url: source.url,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        publisher: source.publisher,
        sourceType: source.sourceType,
        publishedAt: source.publishedAt,
        retrievedAt: new Date().toISOString(),
        evidenceExcerpt: source.text,
        contentHash: source.contentHash,
      };
    }),
  }));

  // Only sources actually cited by at least one accepted finding are worth persisting — an
  // extracted-but-uncited source adds storage with no provenance value.
  const citedSourceIds = new Set(findings.flatMap((f) => f.sources.map((s) => s.id)));
  const citedSources = discovery.sources.filter((s) => citedSourceIds.has(s.id));

  const retrievedAt = new Date().toISOString();
  const saved = await createCompanyResearchSnapshot(supabase, userId, {
    applicationId: application.id,
    companyName,
    roleTitle,
    jobSnapshotId: jobSnapshotId ?? null,
    sources: citedSources.map((s) => ({
      id: s.id,
      url: s.url,
      canonicalUrl: s.canonicalUrl,
      title: s.title,
      publisher: s.publisher,
      sourceType: s.sourceType as CompanyResearchSourceType,
      publishedAt: s.publishedAt,
      evidenceExcerpt: s.text,
      contentHash: s.contentHash,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      claim: f.claim,
      roleRelevance: f.roleRelevance,
      requirementIds: f.requirementIds,
      sourceIds: f.sources.map((s) => s.id),
    })),
  });

  const snapshot: CompanyResearchSnapshot = {
    id: saved.snapshotId,
    userId,
    applicationId: application.id,
    companyName,
    roleTitle,
    jobSnapshotId: jobSnapshotId ?? null,
    researchedAt: retrievedAt,
    createdAt: retrievedAt,
    findings,
    sources: citedSources.map((s) => ({
      id: s.id,
      url: s.url,
      canonicalUrl: s.canonicalUrl,
      title: s.title,
      publisher: s.publisher,
      sourceType: s.sourceType,
      publishedAt: s.publishedAt,
      retrievedAt,
      evidenceExcerpt: s.text,
      contentHash: s.contentHash,
    })),
  };

  return { status: 'ok', snapshot };
}
