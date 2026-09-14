import { assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';

/**
 * Phase 7B — batched lookups joining `resume_versions` against `applications.
 * working_resume_version_id` and `submission_packets.resume_version_id`. Kept in a separate
 * module from `resume-versions.ts` (Phase 7A) since these specifically depend on the Phase 7B
 * columns those two other tables gained in migration 0021.
 */

/**
 * Batched "which applications currently have each of these versions selected as their working
 * résumé" lookup — the resume detail page's "applications using each version" section
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7A" §20), one query across every version on the page, not
 * one per version. A version with no application currently pointing at it is absent from the map.
 */
export async function listOwnApplicationsWithWorkingResumeVersion(
  supabase: CareerOsSupabaseClient,
  userId: string,
  resumeVersionIds: string[],
): Promise<Map<string, { id: string; company: string; title: string }[]>> {
  const result = new Map<string, { id: string; company: string; title: string }[]>();
  if (resumeVersionIds.length === 0) return result;

  const { data, error } = await supabase
    .from('applications')
    .select('id, company, title, working_resume_version_id')
    .eq('user_id', userId)
    .in('working_resume_version_id', resumeVersionIds);
  assertNoError(error, 'listOwnApplicationsWithWorkingResumeVersion');

  for (const row of data ?? []) {
    const versionId = row.working_resume_version_id;
    if (!versionId) continue;
    const list = result.get(versionId) ?? [];
    list.push({ id: row.id, company: row.company, title: row.title });
    result.set(versionId, list);
  }
  return result;
}

/**
 * Batched "which of these versions was ever the SUBMITTED (frozen-into-a-packet) résumé for some
 * application" lookup — the resume detail page's submitted-use indicator. Reads
 * `submission_packets` (immutable, canonical historical record — never `applications` itself) so
 * this reflects real submission history even after the application's working résumé has since
 * changed.
 */
export async function listOwnSubmittedApplicationsForResumeVersions(
  supabase: CareerOsSupabaseClient,
  userId: string,
  resumeVersionIds: string[],
): Promise<
  Map<string, { applicationId: string; packetId: string; createdAt: string }[]>
> {
  const result = new Map<
    string,
    { applicationId: string; packetId: string; createdAt: string }[]
  >();
  if (resumeVersionIds.length === 0) return result;

  const { data, error } = await supabase
    .from('submission_packets')
    .select('id, application_id, resume_version_id, created_at')
    .eq('user_id', userId)
    .in('resume_version_id', resumeVersionIds);
  assertNoError(error, 'listOwnSubmittedApplicationsForResumeVersions');

  for (const row of data ?? []) {
    const versionId = row.resume_version_id;
    if (!versionId) continue;
    const list = result.get(versionId) ?? [];
    list.push({
      applicationId: row.application_id,
      packetId: row.id,
      createdAt: row.created_at,
    });
    result.set(versionId, list);
  }
  return result;
}
