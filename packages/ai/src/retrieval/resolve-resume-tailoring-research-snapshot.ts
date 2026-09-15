import {
  getOwnCompanyResearchSnapshot,
  listOwnCompanyResearchSnapshotsForApplication,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import {
  isCompanyResearchSnapshotCompatible,
  type CompanyResearchSnapshot,
  type ResumeTailoringResearchMode,
} from '@career-os/shared';
import { RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT } from '../config';

export interface ResolveResumeTailoringResearchSnapshotParams {
  applicationId: string;
  company: string;
  title: string;
  jobSnapshotId: string | null;
  researchMode: ResumeTailoringResearchMode;
  /** The client-requested exact snapshot id, if any — never trusted blindly; resolved and
   * ownership/compatibility-checked below (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §6). */
  requestedSnapshotId: string | null;
}

export type ResolveResumeTailoringResearchSnapshotResult =
  /** `JOB_ONLY` was requested, or `JOB_PLUS_COMPANY_RESEARCH` was requested with no explicit id
   * and no compatible snapshot exists for this application — Phase 7E's existing behavior is
   * unchanged in either case (§4); this is never surfaced to the caller as an error. */
  | { status: 'none' }
  /** An explicit `requestedSnapshotId` was given but does not resolve to a snapshot owned by this
   * user (wrong id, another user's snapshot, or already deleted). Only reachable when the caller
   * asked for a *specific* snapshot — the auto-resolve path (no explicit id) never returns this. */
  | { status: 'not_found' }
  /** An explicit `requestedSnapshotId` resolved to a real, owned snapshot, but its frozen
   * company/role/job-snapshot identity no longer matches this application's current context
   * (§7) — never silently used. */
  | { status: 'context_mismatch' }
  | { status: 'ok'; snapshot: CompanyResearchSnapshot };

/**
 * Phase 7H's one snapshot-resolution gate (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §3/§4/§6/§7) —
 * pure orchestration over already-persisted Phase 7G data, zero Tavily/Claude calls of its own
 * (§5/§27). Two distinct paths:
 *
 *   - Explicit `requestedSnapshotId`: the user (or the UI on their behalf) asked for a *specific*
 *     snapshot — resolved via the same RLS-scoped, ownership-checked read Phase 7G's research page
 *     itself uses, then compatibility-checked; either failure is a real, surfaced rejection (the
 *     caller asked for something specific and it can't honestly be honored).
 *   - No explicit id (`JOB_PLUS_COMPANY_RESEARCH` with nothing more specific requested): the
 *     "use latest research" default (§3/§35) — the application's own most recent compatible
 *     snapshot is used, or this silently degrades to `JOB_ONLY` if none exists/matches (§4);
 *     never an error, since nothing specific was ever promised.
 */
export async function resolveResumeTailoringResearchSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: ResolveResumeTailoringResearchSnapshotParams,
): Promise<ResolveResumeTailoringResearchSnapshotResult> {
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
  for (const summary of summaries.slice(0, RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT)) {
    const snapshot = await getOwnCompanyResearchSnapshot(supabase, userId, summary.id);
    if (snapshot && isCompanyResearchSnapshotCompatible(snapshot, applicationContext)) {
      return { status: 'ok', snapshot };
    }
  }
  return { status: 'none' };
}
