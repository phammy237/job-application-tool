-- Career OS -- quality gate: list_own_discovery_feed must never surface a job_catalog row that
-- is no longer ACTIVE.
--
-- The gap: list_own_discovery_feed (migrations 0031/0032/0037/0040) inner-joins job_catalog to
-- user_job_match_scores with no status filter at all. Scoring itself (listActiveJobsWithFeatures,
-- packages/database) already only ever considers status = 'ACTIVE' jobs when upserting
-- user_job_match_scores -- but upsertUserJobMatchScoresBatch only ever inserts/updates, it never
-- deletes a score row for a job that has since left the ACTIVE set. So once a job transitions to
-- POSSIBLY_CLOSED/CLOSED (reconcileMissingJobsForSource) or MERGED (official-posting-resolution's
-- own dedupe -- which *does* explicitly delete its Jobright row's match scores, the one case this
-- gap doesn't hit), its last-computed match score row is orphaned and the feed kept showing it
-- forever, with no automated path to stop. Same class of bug as D6.5's "newly-synced jobs never
-- become visible" gap, mirrored: here a job that stops being a real opportunity never becomes
-- invisible.
--
-- Fix: filter to jc.status = 'ACTIVE' at read time -- the exact same predicate scoring already
-- uses to decide whether to keep refreshing a job's score, applied symmetrically to reading it.
-- Deliberately not POSSIBLY_CLOSED-inclusive: a job Career OS already suspects may be closed
-- (one missed crawl) should not be freshly recommended to a user as a live opportunity while that
-- uncertainty stands: `docs/JOB_DISCOVERY.md`'s D6.5 sits with an amendment for the reasoning.
-- No return-shape change, so CREATE OR REPLACE is sufficient (unlike 0037/0040, which had to
-- DROP + CREATE for a signature change).

create or replace function public.list_own_discovery_feed(
  p_search text default null,
  p_role_families text[] default null,
  p_location_token text default null,
  p_workplace_types text[] default null,
  p_employment_types text[] default null,
  p_eligibility_statuses text[] default null,
  p_min_match numeric default null,
  p_min_coverage numeric default null,
  p_freshness_days integer default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  job_catalog_id uuid,
  title text,
  company_name text,
  location_text text,
  normalized_workplace_type text,
  normalized_employment_type text,
  is_internship boolean,
  role_family text,
  first_seen_at timestamptz,
  match_score numeric,
  coverage numeric,
  eligibility_status text,
  tracked_application_id uuid,
  tracked_application_status text,
  canonical_apply_url text,
  source_url text,
  apply_url text
)
language sql
security invoker
stable
as $$
  select
    jc.id as job_catalog_id,
    jc.title,
    jc.company_name,
    jc.location_text,
    jcf.normalized_workplace_type,
    jcf.normalized_employment_type,
    jcf.is_internship,
    jcf.role_family,
    jc.first_seen_at,
    ujms.match_score,
    ujms.coverage,
    ujms.eligibility_status,
    app.id as tracked_application_id,
    app.status as tracked_application_status,
    jc.canonical_apply_url,
    jc.source_url,
    jc.apply_url
  from public.user_job_match_scores ujms
  join public.job_catalog jc on jc.id = ujms.job_catalog_id
  join public.job_catalog_features jcf on jcf.job_catalog_id = jc.id
  left join public.applications app
    on app.user_id = auth.uid() and app.job_catalog_id = jc.id
  where ujms.user_id = auth.uid()
    and jc.status = 'ACTIVE'
    and (
      p_search is null or btrim(p_search) = '' or
      jc.title ilike '%' || p_search || '%' or
      jc.company_name ilike '%' || p_search || '%' or
      jc.location_text ilike '%' || p_search || '%'
    )
    and (p_role_families is null or jcf.role_family = any(p_role_families))
    and (p_location_token is null or jcf.location_tokens @> array[p_location_token])
    and (p_workplace_types is null or jcf.normalized_workplace_type = any(p_workplace_types))
    and (
      p_employment_types is null
      or jcf.normalized_employment_type = any(p_employment_types)
      or ('INTERNSHIP' = any(p_employment_types) and jcf.is_internship)
    )
    and (p_eligibility_statuses is null or ujms.eligibility_status = any(p_eligibility_statuses))
    and (p_min_match is null or ujms.match_score >= p_min_match)
    and (p_min_coverage is null or ujms.coverage >= p_min_coverage)
    and (p_freshness_days is null or jc.first_seen_at >= now() - (p_freshness_days || ' days')::interval)
  order by ujms.coverage_bucket asc, ujms.match_score desc, jc.id asc
  limit least(greatest(coalesce(p_limit, 25), 0), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_own_discovery_feed from public;
revoke all on function public.list_own_discovery_feed from anon;
grant execute on function public.list_own_discovery_feed to authenticated;
