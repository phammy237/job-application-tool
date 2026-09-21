-- Career OS -- D7.1: expose apply-destination URLs on the /discover feed itself.
--
-- list_own_discovery_feed (migrations 0031/0032/0037) never returned canonical_apply_url,
-- source_url, or apply_url at all -- the list-card view had no external link, only the detail
-- page did (reading them via a separate getJobCatalogEntryById call). D7.1's job-card now needs
-- to decide its own primary apply action (selectJobApplyActions, packages/shared) without an
-- extra per-card fetch, so these three columns are added to the feed's own return shape.
--
-- Postgres cannot add a return column via CREATE OR REPLACE (only the body) -- DROP + CREATE,
-- same as migration 0037, with grants reapplied identically.

drop function public.list_own_discovery_feed(
  text, text[], text, text[], text[], text[], numeric, numeric, integer, integer, integer
);

create function public.list_own_discovery_feed(
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
