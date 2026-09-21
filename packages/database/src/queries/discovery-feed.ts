import {
  discoveryFeedResultItemSchema,
  type Application,
  type DiscoveryFeedFilters,
  type DiscoveryFeedResultItem,
  type JobCatalogEntry,
  type JobCatalogFeatures,
  type UserJobMatchScore,
} from '@career-os/shared';
import { assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOwnApplicationByCatalogJobId } from './applications';
import { getJobCatalogEntryById } from './job-catalog';
import { getJobCatalogFeatures } from './job-catalog-features';
import { getOwnMatchScore } from './user-job-match-scores';

export const DISCOVERY_FEED_DEFAULT_PAGE_SIZE = 20;

function rowToDiscoveryFeedResultItem(row: {
  job_catalog_id: string;
  title: string;
  company_name: string;
  location_text: string | null;
  normalized_workplace_type: string;
  normalized_employment_type: string;
  is_internship: boolean;
  role_family: string;
  first_seen_at: string;
  match_score: number;
  coverage: number;
  eligibility_status: string;
  tracked_application_id: string | null;
  tracked_application_status: string | null;
  canonical_apply_url: string | null;
  source_url: string | null;
  apply_url: string;
}): DiscoveryFeedResultItem {
  return discoveryFeedResultItemSchema.parse({
    jobCatalogId: row.job_catalog_id,
    title: row.title,
    companyName: row.company_name,
    locationText: row.location_text,
    normalizedWorkplaceType: row.normalized_workplace_type,
    normalizedEmploymentType: row.normalized_employment_type,
    isInternship: row.is_internship,
    roleFamily: row.role_family,
    firstSeenAt: row.first_seen_at,
    matchScore: row.match_score,
    coverage: row.coverage,
    eligibilityStatus: row.eligibility_status,
    trackedApplicationId: row.tracked_application_id,
    trackedApplicationStatus: row.tracked_application_status,
    canonicalApplyUrl: row.canonical_apply_url,
    sourceUrl: row.source_url,
    applyUrl: row.apply_url,
  });
}

export interface DiscoveryFeedPage {
  items: DiscoveryFeedResultItem[];
  hasNextPage: boolean;
}

/**
 * Wraps `list_own_discovery_feed` (migration 0031) — a `SECURITY INVOKER` RPC that inherits the
 * calling user's RLS via `auth.uid()`. Unlike the service-role write paths elsewhere in this
 * package, there is no separate `user_id` to pass in or independently filter by here: the
 * identity boundary IS the authenticated Postgres role making the call (this must only ever be
 * invoked with a session-scoped client — see `apps/web/lib/supabase/server.ts` — never a
 * service-role client).
 *
 * Requests `pageSize + 1` rows and slices the extra one off to derive `hasNextPage`, deliberately
 * avoiding a `count(*) over()` total count — that approach has no sane answer for a page
 * requested past the end of the result set (docs/JOB_DISCOVERY.md "Pagination strategy").
 */
export async function listOwnDiscoveryFeed(
  supabase: CareerOsSupabaseClient,
  filters: DiscoveryFeedFilters,
  options: { pageSize?: number } = {},
): Promise<DiscoveryFeedPage> {
  const pageSize = options.pageSize ?? DISCOVERY_FEED_DEFAULT_PAGE_SIZE;
  const offset = (filters.page - 1) * pageSize;

  const { data, error } = await supabase.rpc('list_own_discovery_feed', {
    p_search: filters.search,
    p_role_families: filters.roleFamilies,
    p_location_token: filters.locationToken,
    p_workplace_types: filters.workplaceTypes,
    p_employment_types: filters.employmentTypes,
    p_eligibility_statuses: filters.eligibilityStatuses,
    p_min_match: filters.minMatch,
    p_min_coverage: filters.minCoverage,
    p_freshness_days: filters.freshnessDays,
    p_limit: pageSize + 1,
    p_offset: offset,
  });
  assertNoError(error, 'listOwnDiscoveryFeed');

  const rows = data ?? [];
  const hasNextPage = rows.length > pageSize;
  const items = rows.slice(0, pageSize).map(rowToDiscoveryFeedResultItem);
  return { items, hasNextPage };
}

/** Distinct location tokens for the feed's location filter dropdown, sourced from
 * `list_discovery_location_tokens` (`unnest`+`distinct` server-side, capped at 200 — see
 * migration 0031). */
export async function listDiscoveryLocationTokens(
  supabase: CareerOsSupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('list_discovery_location_tokens');
  assertNoError(error, 'listDiscoveryLocationTokens');
  return (data ?? []).map((row) => row.location_token);
}

export interface DiscoveryFeedJobDetail {
  job: JobCatalogEntry;
  features: JobCatalogFeatures | null;
  matchScore: UserJobMatchScore | null;
  /** D6 (migration 0032) — the caller's own tracked application for this catalog job, if any.
   * Null means untracked; never affects `matchScore`/`features`/`job` above. */
  trackedApplication: Application | null;
}

/**
 * Composed detail view for `/discover/[id]` — four independent reads (the job_catalog row, its
 * extracted features, the caller's own match score row, and the caller's own tracked application
 * for this job), never a recomputation in this layer or the page above it. `matchScore` is null
 * when the requesting user has no score for this job yet (e.g. a job entered the catalog after
 * their last `discovery:rank` run) — callers must render that as "not yet scored," never
 * fabricate a 0/UNKNOWN triple in its place. This is a single-job read, so a direct
 * `getOwnApplicationByCatalogJobId` call here is correctly sized — the list feed instead joins
 * tracked state directly into `list_own_discovery_feed` to avoid an N+1 across many cards.
 */
export async function getOwnDiscoveryFeedJobDetail(
  supabase: CareerOsSupabaseClient,
  userId: string,
  jobCatalogId: string,
): Promise<DiscoveryFeedJobDetail | null> {
  const job = await getJobCatalogEntryById(supabase, jobCatalogId);
  if (!job) return null;

  const [features, matchScore, trackedApplication] = await Promise.all([
    getJobCatalogFeatures(supabase, jobCatalogId),
    getOwnMatchScore(supabase, userId, jobCatalogId),
    getOwnApplicationByCatalogJobId(supabase, userId, jobCatalogId),
  ]);

  return { job, features, matchScore, trackedApplication };
}
