import { randomUUID } from 'node:crypto';
import {
  createOwnPendingRequirementMappingRun,
  decrementOwnAiRequestUsage,
  getOwnJobSnapshot,
  incrementOwnAiRequestUsage,
  listOwnApprovedFactsForGeneration,
  markOwnRequirementMappingRunFailed,
  promoteOwnRequirementMappingRun,
  recordAiUsageEvent,
  type AiUsageCheck,
  type CareerOsSupabaseClient,
  type Json,
} from '@career-os/database';
import { computeRequirementFingerprint, type MatchedFactProvenance } from '@career-os/shared';
import { callClaudeForRequirementMapping } from './claude/call-claude';
import { MODEL_ID, REQUIREMENT_MAPPING_PROMPT_VERSION } from './config';
import { validateRequirementMappingContract } from './contract/validate-requirement-mapping-contract';
import { buildRequirementMappingSystemPrompt } from './prompt/build-requirement-mapping-system-prompt';
import { buildRequirementMappingUserPrompt } from './prompt/build-requirement-mapping-user-prompt';

export interface GenerateRequirementMappingParams {
  jobSnapshotId: string;
}

export type GenerateRequirementMappingResult =
  | { status: 'rate_limited'; usage: AiUsageCheck }
  | { status: 'snapshot_not_found' }
  | { status: 'insufficient_facts' }
  | { status: 'provider_error'; message: string }
  | { status: 'validation_failed' }
  | { status: 'promoted'; runId: string; mappingCount: number };

const PROVIDER = 'anthropic';

/**
 * Orchestrates one requirement-mapping generation end to end: structural gates -> rate limit ->
 * retrieval -> PENDING run -> one Claude attempt -> validate -> at most one retry -> atomic
 * promotion. Mirrors generate-suggestion.ts's shape deliberately — same rate-limit-before-call
 * ordering, same one-retry policy, same reuse of listOwnApprovedFactsForGeneration — but this
 * pipeline is user-triggered only (never called from the save flow) and its output is a whole
 * validated set promoted atomically, never a single answer.
 */
export async function generateRequirementMapping(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: GenerateRequirementMappingParams,
): Promise<GenerateRequirementMappingResult> {
  // Step 1 — rate limit, before any provider call. A blocked request never reaches Claude and
  // never costs anything (docs/AI_GROUNDING.md §7).
  const usage = await incrementOwnAiRequestUsage(supabase, userId);
  if (!usage.allowed) {
    return { status: 'rate_limited', usage };
  }

  // Step 2 — retrieval.
  const snapshot = await getOwnJobSnapshot(supabase, userId, params.jobSnapshotId);
  if (!snapshot) {
    return { status: 'snapshot_not_found' };
  }

  const approvedFacts = await listOwnApprovedFactsForGeneration(supabase, userId);
  if (approvedFacts.length === 0) {
    return { status: 'insufficient_facts' };
  }

  // Step 3 — create the PENDING run before calling Claude, so ai_usage_events rows have a
  // stable generation_run_id to correlate against from the first attempt onward.
  const runId = await createOwnPendingRequirementMappingRun(supabase, userId, {
    jobSnapshotId: snapshot.id,
    provider: PROVIDER,
    model: MODEL_ID,
    promptVersion: REQUIREMENT_MAPPING_PROMPT_VERSION,
    retrievalFactCount: approvedFacts.length,
  });

  const systemPrompt = buildRequirementMappingSystemPrompt();
  const generationRunId = runId;

  const runAttempt = async (retryReason?: string) => {
    const { userText, allowedFactIds } = buildRequirementMappingUserPrompt({
      snapshot,
      facts: approvedFacts,
      retryReason,
    });
    const started = Date.now();
    const callResult = await callClaudeForRequirementMapping(systemPrompt, userText);
    const latencyMs = Date.now() - started;

    if (callResult.status === 'provider_error') {
      return { kind: 'provider_error' as const, message: callResult.message, latencyMs };
    }
    if (callResult.status === 'refusal') {
      return { kind: 'rejected' as const, reason: 'refusal' as const, latencyMs };
    }
    const validated = validateRequirementMappingContract(callResult.rawText, allowedFactIds);
    if (validated.status === 'ok') {
      return { kind: 'accepted' as const, mappings: validated.mappings, latencyMs };
    }
    return { kind: 'rejected' as const, reason: validated.reason, latencyMs };
  };

  // Step 4 — attempt 1, then exactly one retry — but only on a rejection (refusal or contract
  // failure), never on a hard provider_error, matching generate-suggestion.ts's exact policy: a
  // provider error (network/API failure) is not something a same-input retry is likely to fix,
  // and provider_error returns immediately below with no retry.
  let attemptNumber = 1;
  let outcome = await runAttempt();
  if (outcome.kind === 'rejected') {
    attemptNumber = 2;
    const retryReasonText =
      outcome.reason === 'refusal'
        ? 'the request was declined'
        : outcome.reason === 'unknown_source_fact_id'
          ? 'matchedFactIds included an id outside the provided fact list'
          : 'the response was not valid JSON matching the required contract';
    outcome = await runAttempt(retryReasonText);
  }

  // Best-effort usage telemetry — never fails the user's actual request (recordAiUsageEvent's
  // own doc comment). Fire-and-forget per attempt is unnecessary here since we already have both
  // outcomes computed sequentially; record only the final outcome's attempt to keep this simple,
  // matching the minimal Phase 5A scope (full per-attempt-1-and-2 telemetry is not required by
  // the approved design).
  await recordAiUsageEvent(supabase, userId, {
    applicationId: null,
    generationRunId,
    attemptNumber,
    ladder: 'normal',
    fieldClassification: null,
    provider: PROVIDER,
    model: MODEL_ID,
    taskType: 'requirement_mapping',
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
    promptVersion: REQUIREMENT_MAPPING_PROMPT_VERSION,
  }).catch(() => {
    // Telemetry loss must never fail the user's actual request.
  });

  if (outcome.kind === 'provider_error') {
    // Claude was never meaningfully reached — give back the unit Step 1 pre-emptively reserved
    // (supabase/migrations/0033_ai_request_usage_accounting_fix.sql).
    await decrementOwnAiRequestUsage(supabase, userId).catch(() => {});
    await markOwnRequirementMappingRunFailed(supabase, userId, runId, 'provider_error');
    return { status: 'provider_error', message: outcome.message };
  }
  if (outcome.kind === 'rejected') {
    await markOwnRequirementMappingRunFailed(
      supabase,
      userId,
      runId,
      outcome.reason === 'refusal' ? 'refusal' : 'validation_failed',
    );
    return { status: 'validation_failed' };
  }

  // Step 5 — attach server-derived provenance (never model-generated) and compute each
  // requirement's dedup fingerprint, then attempt atomic promotion. A duplicate requirement
  // fingerprint here is treated the same as any other contract validation failure — the whole
  // run is rejected, never partially promoted.
  const factsById = new Map(approvedFacts.map((fact) => [fact.id, fact]));
  const seenFingerprints = new Set<string>();
  const payload: Json[] = [];

  for (const mapping of outcome.mappings) {
    const fingerprint = await computeRequirementFingerprint(mapping.requirementText);
    if (seenFingerprints.has(fingerprint)) {
      await markOwnRequirementMappingRunFailed(supabase, userId, runId, 'validation_failed');
      return { status: 'validation_failed' };
    }
    seenFingerprints.add(fingerprint);

    const matchedFacts: MatchedFactProvenance[] = mapping.matchedFactIds.map((factId) => {
      const fact = factsById.get(factId);
      // Unreachable: validateRequirementMappingContract already rejected any id outside
      // allowedFactIds, which is built from this exact approvedFacts list.
      if (!fact) throw new Error(`matched fact ${factId} missing from the retrieved fact set`);
      return { factId, sourceTable: fact.sourceTable, factUpdatedAt: fact.updatedAt };
    });

    payload.push({
      requirementText: mapping.requirementText,
      requirementFingerprint: fingerprint,
      requirementCategory: mapping.requirementCategory,
      requiredOrPreferred: mapping.requiredOrPreferred,
      relationship: mapping.relationship,
      matchedFacts: matchedFacts as unknown as Json,
      explanation: mapping.explanation,
      confidence: mapping.confidence,
      requiresUserConfirmation: mapping.requiresUserConfirmation,
    });
  }

  const result = await promoteOwnRequirementMappingRun(supabase, userId, runId, payload);

  return { status: 'promoted', runId: result.runId, mappingCount: result.mappingCount };
}
