import type { CareerOsSupabaseClient } from '@career-os/database';
import type { CompanyResearchSnapshot, ResumeTailoringResearchMode } from '@career-os/shared';
import { RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT } from '../config';
import {
  resolveCompanyResearchSnapshotForRequest,
  type ResolveCompanyResearchSnapshotResult,
} from './resolve-company-research-snapshot';

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
 * Phase 7H's snapshot-resolution gate (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §3/§4/§6/§7) —
 * unchanged name, params, and behavior. Phase 7I extracted the actual logic into a generic
 * primitive (`resolve-company-research-snapshot.ts`, `resolveCompanyResearchSnapshotForRequest`)
 * so interview prep could reuse it without importing something résumé-named; this function is now
 * a thin, behavior-preserving wrapper around that primitive, not a reimplementation — every test
 * written against this exact export continues to exercise the same code path.
 */
export async function resolveResumeTailoringResearchSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  params: ResolveResumeTailoringResearchSnapshotParams,
): Promise<ResolveResumeTailoringResearchSnapshotResult> {
  return resolveCompanyResearchSnapshotForRequest(supabase, userId, {
    ...params,
    autoResolveCandidateLimit: RESEARCH_TAILORING_AUTO_RESOLVE_CANDIDATE_LIMIT,
  });
}
