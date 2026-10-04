import { resumeTailoringProposalSchema, type ResumeTailoringProposal } from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

export interface PendingResumeTailoringDraft {
  id: string;
  userId: string;
  applicationId: string;
  proposal: ResumeTailoringProposal;
  createdAt: string;
}

function rowToDraft(row: {
  id: string;
  user_id: string;
  application_id: string;
  proposal: unknown;
  created_at: string;
}): PendingResumeTailoringDraft {
  return {
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id,
    proposal: resumeTailoringProposalSchema.parse(row.proposal),
    createdAt: row.created_at,
  };
}

/** Whether this application already has a pending draft awaiting review (D9 Phase B,
 * `runAutoTailorDraftingForUser`'s "skip if one already exists" check) — a bare existence probe,
 * never fetches/parses the (potentially large) stored proposal. */
export async function hasOwnPendingResumeTailoringDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('pending_resume_tailoring_drafts')
    .select('id')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .maybeSingle();
  assertNoError(error, 'hasOwnPendingResumeTailoringDraft');
  return data !== null;
}

/** The application detail page's one read — null when no draft exists (never generated, already
 * consumed by a save, or explicitly dismissed). Staleness (the stored proposal's
 * `baseResumeVersionId`/`jobSnapshotId` no longer matching the application's CURRENT values) is
 * deliberately NOT checked here — the caller already has the live `Application` in hand and
 * re-checks it the exact same way `/resume-tailoring/save` itself does, so there is exactly one
 * place in the codebase that encodes what "stale" means for a tailoring proposal, not two. */
export async function getOwnPendingResumeTailoringDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<PendingResumeTailoringDraft | null> {
  const { data, error } = await supabase
    .from('pending_resume_tailoring_drafts')
    .select('*')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .maybeSingle();
  assertNoError(error, 'getOwnPendingResumeTailoringDraft');
  return data ? rowToDraft(data) : null;
}

/** Inserts a new pending draft (D9 Phase B orchestrator only) — never an upsert: the caller
 * (`runAutoTailorDraftingForUser`) always checks `hasOwnPendingResumeTailoringDraft` first and
 * skips generating a new one while one already exists, so a conflict here would mean a genuine
 * race, not an expected overwrite. */
export async function createOwnPendingResumeTailoringDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
  proposal: ResumeTailoringProposal,
): Promise<void> {
  const { error } = await supabase.from('pending_resume_tailoring_drafts').insert({
    user_id: userId,
    application_id: applicationId,
    proposal: proposal as unknown as Json,
  });
  assertNoError(error, 'createOwnPendingResumeTailoringDraft');
}

/** Removes a pending draft — called both after a successful
 * `/api/applications/:id/resume-tailoring/save` (clean consumption) and when the application
 * detail page finds a stored draft has gone stale (self-healing cleanup, so the next cron tick
 * can generate a fresh one instead of the stale row lingering forever). Never throws when no
 * draft exists — both call sites treat "nothing to delete" as a success, not an error. */
export async function deleteOwnPendingResumeTailoringDraft(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pending_resume_tailoring_drafts')
    .delete()
    .eq('user_id', userId)
    .eq('application_id', applicationId);
  assertNoError(error, 'deleteOwnPendingResumeTailoringDraft');
}
