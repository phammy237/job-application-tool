import {
  requirementMappingRunSchema,
  type RequirementMappingRun,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['requirement_mapping_runs']['Row'];

function rowToRun(row: Row): RequirementMappingRun {
  return requirementMappingRunSchema.parse({
    id: row.id,
    userId: row.user_id,
    jobSnapshotId: row.job_snapshot_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    retrievalFactCount: row.retrieval_fact_count,
    failureCategory: row.failure_category,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
  });
}

/** The run currently shown for a snapshot, if any — GET .../requirements only ever surfaces
 * `status = 'CURRENT'`; SUPERSEDED/FAILED runs are retained for audit but have no history UI in
 * Phase 5A (docs/IMPLEMENTATION_PLAN.md round-3 §7). */
export async function getCurrentOwnRequirementMappingRun(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobSnapshotId: string,
): Promise<RequirementMappingRun | null> {
  const { data, error } = await supabase
    .from('requirement_mapping_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('job_snapshot_id', jobSnapshotId)
    .eq('status', 'CURRENT')
    .maybeSingle();
  assertNoError(error, 'getCurrentOwnRequirementMappingRun');
  return data ? rowToRun(data) : null;
}

/** Fetches one specific run by id, regardless of its status (CURRENT/SUPERSEDED/FAILED) —
 * unlike getCurrentOwnRequirementMappingRun, which only ever finds the live CURRENT run for a
 * snapshot. Used by the historical submission-packet viewer (docs/IMPLEMENTATION_PLAN.md Phase
 * 5B.4) to look up the specific run a submission_packets row froze a reference to at mark-applied
 * time — that run may since have been superseded by a newer analysis, and the caller is
 * responsible for surfacing that honestly rather than implying the frozen run is still current. */
export async function getOwnRequirementMappingRunById(
  supabase: CareerOsSupabaseClient,
  userId: string,
  runId: string,
): Promise<RequirementMappingRun | null> {
  const { data, error } = await supabase
    .from('requirement_mapping_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('id', runId)
    .maybeSingle();
  assertNoError(error, 'getOwnRequirementMappingRunById');
  return data ? rowToRun(data) : null;
}

export interface CreatePendingRequirementMappingRunInput {
  jobSnapshotId: string;
  provider: string;
  model: string;
  promptVersion: string;
  retrievalFactCount: number;
}

/** Wraps the service-role-only create_pending_requirement_mapping_run RPC (migration 0010) —
 * inserted before the Claude call so ai_usage_events rows have a stable generation_run_id to
 * correlate against from the very first attempt. */
export async function createOwnPendingRequirementMappingRun(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreatePendingRequirementMappingRunInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_pending_requirement_mapping_run', {
    p_user_id: userId,
    p_job_snapshot_id: input.jobSnapshotId,
    p_provider: input.provider,
    p_model: input.model,
    p_prompt_version: input.promptVersion,
    p_retrieval_fact_count: input.retrievalFactCount,
  });
  return unwrapRow(data, error, 'createOwnPendingRequirementMappingRun');
}

/** Idempotent — a duplicate/retried failure report returns false rather than throwing (see the
 * RPC's own doc comment in migration 0010). */
export async function markOwnRequirementMappingRunFailed(
  supabase: CareerOsSupabaseClient,
  userId: string,
  runId: string,
  failureCategory: 'provider_error' | 'validation_failed' | 'refusal' | 'rate_limited',
): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_requirement_mapping_run_failed', {
    p_user_id: userId,
    p_run_id: runId,
    p_failure_category: failureCategory,
  });
  assertNoError(error, 'markOwnRequirementMappingRunFailed');
  return data ?? false;
}
