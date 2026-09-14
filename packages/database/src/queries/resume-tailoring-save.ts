import { DatabaseError } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * The `save_reviewed_tailored_resume` RPC's own rejection reasons (migration 0024, Phase 7F
 * §14/§15/§51) — raised as plain Postgres exceptions with these exact messages, never a generic
 * error the caller has to guess at. `application_not_found`/`resume_not_found` cover both
 * "doesn't exist" and "not owned by this user" identically, same posture as every other query in
 * this package (CLAUDE.md: never distinguish the two to the caller).
 */
export type SaveReviewedTailoredResumeRejection =
  | 'application_not_found'
  | 'resume_not_found'
  | 'stale_base_resume'
  | 'stale_job_context';

const KNOWN_REJECTIONS: SaveReviewedTailoredResumeRejection[] = [
  'application_not_found',
  'resume_not_found',
  'stale_base_resume',
  'stale_job_context',
];

/**
 * Thrown for every known rejection the RPC can raise — the save action branches on `.reason`
 * (same posture as `ConsistencyCheckFailedError`) rather than string-matching a raw Postgres
 * error message itself. `currentValue` carries the RPC's `DETAIL` (the application's actual
 * current `working_resume_version_id`/`job_snapshot_id` at rejection time, for `stale_*`
 * reasons) — null when the RPC didn't supply one or the column itself was null.
 */
export class SaveReviewedTailoredResumeError extends Error {
  constructor(
    public readonly reason: SaveReviewedTailoredResumeRejection,
    public readonly currentValue: string | null,
  ) {
    super(reason);
    this.name = 'SaveReviewedTailoredResumeError';
  }
}

export interface SaveReviewedTailoredResumeInput {
  applicationId: string;
  /** The working résumé version / job snapshot this reviewed draft was generated against — the
   * RPC re-checks both against the application's CURRENT state and rejects with
   * `stale_base_resume`/`stale_job_context` on any mismatch (§14/§15). */
  expectedWorkingResumeVersionId: string;
  expectedJobSnapshotId: string;
  /** Exactly one of `targetResumeId` or `newResumeName` must be set — append the next version to
   * an existing logical résumé, or create a new TAILORED résumé first (§17/§18/§29). */
  targetResumeId: string | null;
  newResumeName: string | null;
  newResumeParentId: string | null;
  versionDisplayName: string;
  snapshotPayload: Json;
}

export interface SaveReviewedTailoredResumeResult {
  resumeId: string;
  resumeCreated: boolean;
  versionId: string;
  versionNumber: number;
  displayName: string;
}

/**
 * Thin wrapper around the service-role-only `save_reviewed_tailored_resume` RPC (migration
 * 0024) — the one atomic operation behind Phase 7F's "Save Tailored Resume"
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §20/§49). All ownership/staleness/versioning/lineage
 * logic lives in the database function itself, row-locked for the duration of the transaction, so
 * two concurrent saves against the same stale base cannot both succeed (§50) — this wrapper only
 * maps params/results and turns the RPC's known rejection messages into a typed error the save
 * action can branch on. Callers must pass an admin (service-role) client, with `userId` derived
 * from the verified server-side session — never a client-supplied field, same posture as
 * `createOwnResumeVersion`/`markApplicationAppliedAtomic`.
 */
export async function saveReviewedTailoredResume(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: SaveReviewedTailoredResumeInput,
): Promise<SaveReviewedTailoredResumeResult> {
  const { data, error } = await supabase
    .rpc('save_reviewed_tailored_resume', {
      p_user_id: userId,
      p_application_id: input.applicationId,
      p_expected_working_resume_version_id: input.expectedWorkingResumeVersionId,
      p_expected_job_snapshot_id: input.expectedJobSnapshotId,
      p_target_resume_id: input.targetResumeId,
      p_new_resume_name: input.newResumeName,
      p_new_resume_parent_id: input.newResumeParentId,
      p_version_display_name: input.versionDisplayName,
      p_snapshot_payload: input.snapshotPayload,
    })
    .single();

  if (error) {
    const reason = KNOWN_REJECTIONS.find((r) => error.message.includes(r));
    if (reason) {
      throw new SaveReviewedTailoredResumeError(reason, error.details || null);
    }
    throw new DatabaseError(`saveReviewedTailoredResume: ${error.message}`, error);
  }
  if (!data) {
    throw new DatabaseError('saveReviewedTailoredResume: expected a row but got null');
  }

  return {
    resumeId: data.resume_id,
    resumeCreated: data.resume_created,
    versionId: data.version_id,
    versionNumber: data.version_number,
    displayName: data.display_name,
  };
}
