-- Career OS -- Discover internship filter fix (found during D7 verification).
--
-- Bug: /discover's "Employment type = Internship" checkbox filters on
-- `job_catalog_features.normalized_employment_type = 'INTERNSHIP'` only. That column is derived
-- purely from the provider's own `employment_type` field via `normalizeEmploymentType()`. But the
-- canonical internship classification, already computed once by `extractJobCatalogFeatures()`
-- (packages/shared/src/lib/extract-job-catalog-features.ts) and stored as
-- `job_catalog_features.is_internship`, is deliberately BROADER -- it is
-- `normalizedEmploymentType === 'INTERNSHIP' || seniority === 'INTERN'`, because Greenhouse never
-- populates `employment_type` at all, and some ATS employment_type values (e.g. Lever/Ashby's
-- "Full-time" meaning "full-time hours during the internship", not a permanent role) don't say
-- "internship" even when the posting's own title unambiguously does.
--
-- Verified against the live linked project: exactly 10 ACTIVE rows have `is_internship = true`
-- but `normalized_employment_type != 'INTERNSHIP'` (all 10 also already have a
-- user_job_match_scores row for the one real user, so all 10 were feed-eligible but hidden by the
-- old filter) -- 7 Stripe (Greenhouse never sets employment_type; title is literally "Software
-- Engineer, Intern"), 1 Notion ("Data Science Intern (Winter 2027)", Ashby's employment_type =
-- "FullTime"), 2 Palantir ("...Internship", Lever's employment_type = "Full-time"). 7 + 1 + 2 = 10.
-- All 10 are genuine internships by unambiguous title evidence (seniority = 'INTERN', a
-- deterministic title-phrase match on "intern"/"internship" -- see extract-seniority.ts) -- none
-- are false positives from provider/repo inference.
--
-- Fix, two parts:
--   1. Filter: when the caller's employment-type filter includes 'INTERNSHIP', also match
--      `jcf.is_internship`, reusing the already-computed canonical column -- no new
--      internship-detection logic here or anywhere else, no provider-based inference, no Jobright
--      special-case. Every other employment-type filter value (FULL_TIME/PART_TIME/CONTRACT/
--      TEMPORARY) is untouched: those still match only via `normalized_employment_type`, exactly
--      as before.
--   2. Display: `is_internship` is added to the returned columns so the UI can label a
--      canonically-classified internship as "Internship" even when its own
--      `normalized_employment_type` reads UNKNOWN/FULL_TIME -- otherwise a card would pass the new
--      Internship filter yet visibly show "Full-time"/"Employment type unknown" with no
--      indication Career OS classified it as an internship (apps/web's job-card.tsx is the one
--      consumer that reads this new column; `normalized_employment_type` itself is untouched and
--      still returned as-is for every other purpose).
--
-- ORDER BY/pagination/every other filter clause is byte-for-byte unchanged from migration 0032's
-- definition. Postgres cannot add a return column via CREATE OR REPLACE (only the body), so this
-- must DROP + CREATE -- which also drops the function's grants, reapplied below exactly as
-- migrations 0031/0032 established them.

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
  tracked_application_status text
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
    app.status as tracked_application_status
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
