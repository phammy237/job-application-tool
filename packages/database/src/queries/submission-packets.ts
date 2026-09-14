import {
  submissionPacketAnswerSchema,
  submissionPacketSchema,
  consistencyFindingSchema,
  consistencyAcknowledgementSchema,
  autofillSummarySchema,
  unresolvedFieldSummarySchema,
  type SubmissionPacket,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['submission_packets']['Row'];

function rowToSubmissionPacket(row: Row): SubmissionPacket {
  return submissionPacketSchema.parse({
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id,
    jobSnapshotId: row.job_snapshot_id,
    resumeId: row.resume_id,
    // Added in migration 0021 (Phase 7B) — same missing-key-on-an-unmigrated-database degrade as
    // every other Phase 5B+ column this function reads defensively.
    resumeVersionId: 'resume_version_id' in row ? row.resume_version_id : null,
    requirementMappingRunId: row.requirement_mapping_run_id,
    answersSnapshot: submissionPacketAnswerSchema
      .array()
      .parse(row.answers_snapshot ?? []),
    autofillSummary: row.autofill_summary
      ? autofillSummarySchema.parse(row.autofill_summary)
      : null,
    unresolvedFields: row.unresolved_fields
      ? unresolvedFieldSummarySchema.array().parse(row.unresolved_fields)
      : null,
    consistencyFindings: consistencyFindingSchema
      .array()
      .parse(row.consistency_findings ?? []),
    consistencyAcknowledgements: consistencyAcknowledgementSchema
      .array()
      .parse(row.consistency_acknowledgements ?? []),
    contentFingerprint: row.content_fingerprint,
    createdAt: row.created_at,
  });
}

/**
 * Read-only — submission_packets has no insert/update query function in this package by design.
 * Every write happens exclusively through markOwnApplicationApplied (applications.ts), which
 * calls the service-role-only mark_application_applied RPC (migration 0013); this table's RLS
 * grants `authenticated` select only, so this is the one legitimate read path.
 */
export async function getOwnSubmissionPacket(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<SubmissionPacket | null> {
  const { data, error } = await supabase
    .from('submission_packets')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnSubmissionPacket');
  return data ? rowToSubmissionPacket(data) : null;
}

/**
 * "What did I submit for this application?" — the read path the application detail page (Phase
 * 5B.4) actually uses. Returns null both when the application isn't APPLIED yet and when it's a
 * legacy APPLIED row that predates packet support (docs/IMPLEMENTATION_PLAN.md Phase 5B.1G) —
 * both are honest, legitimate "no packet" states, never distinguished from each other by this
 * query; the caller decides what to say based on the application's own status.
 */
export async function getOwnSubmissionPacketByApplicationId(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<SubmissionPacket | null> {
  const { data, error } = await supabase
    .from('submission_packets')
    .select('*')
    .eq('application_id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnSubmissionPacketByApplicationId');
  return data ? rowToSubmissionPacket(data) : null;
}

export interface MarkApplicationAppliedInput {
  answersSnapshot: Json;
  autofillSummary: Json | null;
  unresolvedFields: Json | null;
  consistencyFindings: Json;
  consistencyAcknowledgements: Json;
  jobSnapshotId: string | null;
  resumeId: string | null;
  resumeVersionId: string | null;
  requirementMappingRunId: string | null;
  contentFingerprint: string;
}

export interface MarkApplicationAppliedResult {
  applicationId: string;
  status: string;
  appliedAt: string;
  previousStatus: string;
  submissionPacketId: string;
  packetCreated: boolean;
}

/**
 * Thin wrapper around the service-role-only mark_application_applied RPC (migration 0013) — the
 * one atomic operation for the entire APPLIED transition (docs/IMPLEMENTATION_PLAN.md Phase
 * 5B.1H). All of the actual ownership/idempotency/at-most-once-packet/applied_at-preservation
 * logic lives in the database function itself, not here; this wrapper only maps params/results,
 * so two concurrent calls are safe by construction (the function row-locks the application for
 * the duration of the transaction) rather than by convention.
 */
export async function markApplicationAppliedAtomic(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
  input: MarkApplicationAppliedInput,
): Promise<MarkApplicationAppliedResult> {
  const { data, error } = await supabase
    .rpc('mark_application_applied', {
      p_user_id: userId,
      p_application_id: applicationId,
      p_answers_snapshot: input.answersSnapshot,
      p_autofill_summary: input.autofillSummary,
      p_unresolved_fields: input.unresolvedFields,
      p_consistency_findings: input.consistencyFindings,
      p_consistency_acknowledgements: input.consistencyAcknowledgements,
      p_job_snapshot_id: input.jobSnapshotId,
      p_resume_id: input.resumeId,
      p_requirement_mapping_run_id: input.requirementMappingRunId,
      p_content_fingerprint: input.contentFingerprint,
      p_resume_version_id: input.resumeVersionId,
    })
    .single();
  const row = unwrapRow(data, error, 'markApplicationAppliedAtomic');
  return {
    applicationId: row.application_id,
    status: row.status,
    appliedAt: row.applied_at,
    previousStatus: row.previous_status,
    submissionPacketId: row.submission_packet_id,
    packetCreated: row.packet_created,
  };
}
