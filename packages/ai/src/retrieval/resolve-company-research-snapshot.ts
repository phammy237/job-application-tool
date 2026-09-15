import {
  getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { isCompanyResearchSnapshotCompatible, type CompanyResearchSnapshot } from '@career-os/shared';

/**
 * Phase 7I — the generic core of Phase 7H's snapshot-resolution gate
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7I" — extracted rather than duplicated: "prefer reusing/
 * extracting the Phase 7H selector rather than creating subtly divergent duplicate ranking
 * logic," applied here to snapshot resolution too). `resolveResumeTailoringResearchSnapshot`
 * (`./resolve-resume-tailoring-research-snapshot.ts`) is now a thin wrapper around this function
 * that preserves its own exact pre-existing name/params/behavior — Phase 7H's own tests exercise
 * it unchanged. Interview prep (`generate-interview-prep.ts`) calls this directly under a name
 * that doesn't imply résumés.
 */
export type CompanyResearchRequestMode = 'JOB_ONLY' | 'JOB_PLUS_COMPANY_RESEARCH';

export interface ResolveCompanyResearchSnapshotParams {
  applicationId: string;
  company: string;
  title: string;
  jobSnapshotId: string | null;
  researchMode: CompanyResearchRequestMode;
  /** The client-requested exact snapshot id, if any — never trusted blindly; resolved and
   * ownership/compatibility-checked below. */
  requestedSnapshotId: string | null;
  /** Bounds how many of the application's most recent snapshots are checked for compatibility
   * when no explicit id is requested — each caller supplies its own tuning constant
   * (`packages/ai/src/config.ts`) rather than this module owning one. */
  autoResolveCandidateLimit: number;
}

export type ResolveCompanyResearchSnapshotResult =
  /** `JOB_ONLY` was requested, or `JOB_PLUS_COMPANY_RESEARCH` was requested with no explicit id
   * and no compatible snapshot exists for this application — existing (pre-research) pipeline
   * behavior is unchanged in either case; this is never surfaced to the caller as an error. */
  | { status: 'none' }
  /** An explicit `requestedSnapshotId` was given but does not resolve to a snapshot owned by this
   * user (wrong id, another user's snapshot, or already deleted). Only reachable when the caller
   * asked for a *specific* snapshot — the auto-resolve path (no explicit id) never returns this. */
  | { status: 'not_found' }
  /** An explicit `requestedSnapshotId` resolved to a real, owned snapshot, but its frozen
   * company/role/job-snapshot identity no longer matches this application's current context —
   * never silently used. */
  | { status: 'context_mismatch' }
  | { status: 'ok'; snapshot: CompanyResearchSnapshot };

/**
 * Two distinct paths:
 *
 *   - Explicit `requestedSnapshotId`: the caller asked for a *specific* snapshot — resolved via
 *     the same RLS-scoped, ownership-checked read Phase 7G's research page itself uses, then
 *     compatibility-checked; either failure is a real, surfaced rejection (the caller asked for
 *     something specific and it can't honestly be honored).
 *   - No explicit id (`JOB_PLUS_COMPANY_RESEARCH` with nothing more specific requested): the
 *     "use latest research" default — the application's own most recent compatible snapshot is
 *     used, or this silently degrades to `JOB_ONLY`-equivalent (`{status: 'none'}`) if none
 *     exists/matches; never an error, since nothing specific was ever promised.
 */
export async function resolveCompanyResearchSnapshotForRequest(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: ResolveCompanyResearchSnapshotParams,
): Promise<ResolveCompanyResearchSnapshotResult> {
  if (params.researchMode === 'JOB_ONLY') {
    return { status: 'none' };
  }

  const applicationContext = {
    company: params.company,
    title: params.title,
    jobSnapshotId: params.jobSnapshotId,
  };

  if (params.requestedSnapshotId) {
    const snapshot = await getOwnCompanyResearchSnapshot(
      supabase,
      userId,
      params.requestedSnapshotId,
    );
    if (!snapshot) {
      return { status: 'not_found' };
    }
    if (!isCompanyResearchSnapshotCompatible(snapshot, applicationContext)) {
      return { status: 'context_mismatch' };
    }
    return { status: 'ok', snapshot };
  }

  const summaries = await listOwnCompanyResearchSnapshotsForApplication(
    supabase,
    userId,
    params.applicationId,
  );
  for (const summary of summaries.slice(0, params.autoResolveCandidateLimit)) {
    const snapshot = await getOwnCompanyResearchSnapshot(supabase, userId, summary.id);
    if (snapshot && isCompanyResearchSnapshotCompatible(snapshot, applicationContext)) {
      return { status: 'ok', snapshot };
    }
  }
  return { status: 'none' };
}
