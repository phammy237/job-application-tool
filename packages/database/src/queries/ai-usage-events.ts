import { aiUsageEventSchema, type AiUsageEvent, type AiUsageEventInput } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['ai_usage_events']['Row'];

function rowToAiUsageEvent(row: Row): AiUsageEvent {
  return aiUsageEventSchema.parse({
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id,
    generationRunId: row.generation_run_id,
    attemptNumber: row.attempt_number,
    ladder: row.ladder,
    fieldClassification: row.field_classification,
    provider: row.provider,
    model: row.model,
    taskType: row.task_type,
    providerSucceeded: row.provider_succeeded,
    outcome: row.outcome,
    rejectionReason: row.rejection_reason,
    escalationReason: row.escalation_reason,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    estimatedCost: row.estimated_cost,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  });
}

/**
 * Records one provider attempt (or the deterministic short-circuit, or a deliberately skipped
 * escalation slot). No call site exists yet — packages/ai's generate-suggestion.ts is
 * single-provider today and doesn't call this. Once a caller is wired up, it must treat insert
 * failures as non-fatal (wrap this call so a lost telemetry row never fails the user's actual
 * request). See docs/IMPLEMENTATION_PLAN.md's Phase 3 note on ai_usage_events.
 */
export async function recordAiUsageEvent(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: AiUsageEventInput,
): Promise<AiUsageEvent> {
  const { data, error } = await supabase
    .from('ai_usage_events')
    .insert({
      user_id: userId,
      application_id: input.applicationId,
      generation_run_id: input.generationRunId,
      attempt_number: input.attemptNumber,
      ladder: input.ladder,
      field_classification: input.fieldClassification,
      provider: input.provider,
      model: input.model,
      task_type: input.taskType,
      provider_succeeded: input.providerSucceeded,
      outcome: input.outcome,
      rejection_reason: input.rejectionReason,
      escalation_reason: input.escalationReason,
      input_tokens: input.inputTokens,
      cached_input_tokens: input.cachedInputTokens,
      output_tokens: input.outputTokens,
      estimated_cost: input.estimatedCost,
      latency_ms: input.latencyMs,
    })
    .select('*')
    .single();
  return rowToAiUsageEvent(unwrapRow(data, error, 'recordAiUsageEvent'));
}

export async function getOwnAiUsageEvent(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<AiUsageEvent | null> {
  const { data, error } = await supabase
    .from('ai_usage_events')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnAiUsageEvent');
  return data ? rowToAiUsageEvent(data) : null;
}
