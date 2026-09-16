-- Career OS — Job Discovery Track, D5A: the first user-facing /discover feed. See
-- docs/JOB_DISCOVERY.md for the full design (default ordering rule, filter semantics).
--
-- This migration adds no new tables — only what's needed to serve an efficient, deterministic,
-- filterable, paginated feed over the existing D4 tables (job_catalog, job_catalog_features,
-- user_job_match_scores), all already RLS-protected. Nothing here changes D1-D4 semantics: no
-- existing column, constraint, trigger, or RLS policy is altered.

-- ================================================================================================
-- PART 1 — default ordering support: a generated "coverage bucket" column + index.
--
-- docs/JOB_DISCOVERY.md's D4 live audit found that sorting purely by match_score surfaces
-- low-Coverage noise at the top (a job where almost everything is UNKNOWN except one lucky
-- OBSERVED_FRESHNESS=1.0 can hit match_score=100 with coverage as low as 4%). The default feed
-- order is therefore: prefer meaningful Coverage first, then Match within a coverage tier
-- (docs/JOB_DISCOVERY.md "Default discovery order" has the exact rule and the bucket thresholds'
-- justification against the D4 coverage percentiles).
--
-- A GENERATED ALWAYS ... STORED column (not a plain expression in ORDER BY) is used specifically
-- so this can be indexed and sorted on directly via a normal btree — Postgres can't use an index
-- for an ORDER BY over an ad-hoc CASE expression computed at query time. 0 = highest tier (>=60%
-- coverage), 1 = moderate (30-59%), 2 = low (<30%) — ascending sort puts the best tier first.
-- Immutable expression (comparisons against constants), safe for a generated column.
-- ================================================================================================

alter table public.user_job_match_scores
  add column coverage_bucket smallint generated always as (
    case
      when coverage >= 60 then 0
      when coverage >= 30 then 1
      else 2
    end
  ) stored;

create index user_job_match_scores_user_default_order_idx
  on public.user_job_match_scores (user_id, coverage_bucket, match_score desc);

-- ================================================================================================
-- PART 2 — filter-performance indexes on job_catalog_features.
--
-- job_catalog_features already has indexes on role_family/seniority/feature_version (migration
-- 0030); normalized_workplace_type and normalized_employment_type are the two remaining D5A
-- filter columns that get direct equality/ANY() filters in the feed query below and didn't yet
-- have one.
-- ================================================================================================

create index job_catalog_features_workplace_type_idx
  on public.job_catalog_features (normalized_workplace_type);
create index job_catalog_features_employment_type_idx
  on public.job_catalog_features (normalized_employment_type);

-- ================================================================================================
-- PART 3 — deterministic text search support (no AI, no embeddings).
--
-- pg_trgm's GIN indexes are what makes a plain `ILIKE '%term%'` substring search (title/company)
-- avoid a sequential scan as the catalog grows past the "tens of thousands of jobs" scale target
-- — a standard, well-understood Postgres extension, not a new dependency or external service.
-- ================================================================================================

create extension if not exists pg_trgm;

create index job_catalog_title_trgm_idx on public.job_catalog using gin (title gin_trgm_ops);
create index job_catalog_company_name_trgm_idx
  on public.job_catalog using gin (company_name gin_trgm_ops);

-- ================================================================================================
-- PART 4 — list_own_discovery_feed: the one query the /discover feed issues.
--
-- Why an RPC (docs/JOB_DISCOVERY.md "Database access", justified per CLAUDE.md's "don't add
-- service-role RPCs gratuitously" — this one is NOT service-role, see below): this is a genuine
-- 3-table join (job_catalog + job_catalog_features + user_job_match_scores) with several optional
-- filters and a sort key that spans a generated column plus a real column, all needing to run as
-- ONE indexed, paginated query. PostgREST's embedded-resource filtering cannot express a
-- computed-column-first sort across a join, and assembling this from separate PostgREST calls
-- would mean fetching unbounded intermediate result sets to join/sort/paginate in application
-- code — exactly the "fetch the whole catalog into memory" anti-pattern this phase must avoid.
--
-- SECURITY INVOKER (not DEFINER, not service-role-only): this function grants no privilege the
-- calling `authenticated` user doesn't already have via RLS — job_catalog/job_catalog_features are
-- already authenticated-select-all, and user_job_match_scores' own RLS policy already restricts a
-- caller to their own rows. The explicit `ujms.user_id = auth.uid()` filter below is redundant
-- with RLS by design (defense-in-depth + lets the planner use the covering index directly, same
-- reasoning CLAUDE.md gives for service-role paths re-checking ownership, applied here even though
-- this path never bypasses RLS at all).
-- ================================================================================================

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
  role_family text,
  first_seen_at timestamptz,
  match_score numeric,
  coverage numeric,
  eligibility_status text
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
    jcf.role_family,
    jc.first_seen_at,
    ujms.match_score,
    ujms.coverage,
    ujms.eligibility_status
  from public.user_job_match_scores ujms
  join public.job_catalog jc on jc.id = ujms.job_catalog_id
  join public.job_catalog_features jcf on jcf.job_catalog_id = jc.id
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
    and (p_employment_types is null or jcf.normalized_employment_type = any(p_employment_types))
    and (p_eligibility_statuses is null or ujms.eligibility_status = any(p_eligibility_statuses))
    and (p_min_match is null or ujms.match_score >= p_min_match)
    and (p_min_coverage is null or ujms.coverage >= p_min_coverage)
    and (p_freshness_days is null or jc.first_seen_at >= now() - (p_freshness_days || ' days')::interval)
  order by ujms.coverage_bucket asc, ujms.match_score desc, jc.id asc
  limit least(greatest(coalesce(p_limit, 25), 0), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Revoking from PUBLIC alone is not enough here — unlike every other RPC in this codebase (all
-- service-role-only), this one is meant to stay callable by `authenticated`, and Supabase's
-- platform-level default privileges grant `anon`/`authenticated`/`service_role` EXECUTE on every
-- function in `public` directly (not merely via the PUBLIC pseudo-role), so an explicit revoke
-- from `anon` is required too — confirmed live: without this line `anon` could call the function
-- with zero error (D5A live verification).
revoke all on function public.list_own_discovery_feed from public;
revoke all on function public.list_own_discovery_feed from anon;
grant execute on function public.list_own_discovery_feed to authenticated;

-- ================================================================================================
-- PART 5 — list_discovery_location_tokens: the small, bounded set of location filter options.
--
-- job_catalog_features.location_tokens is an array column — PostgREST cannot `unnest`/`distinct`
-- it in a plain select(), and paginating every row in application code just to flatten+dedupe an
-- array column is wasteful (the exact "avoid N+1 / avoid fetching everything" principle this
-- phase must respect). A tiny, well-bounded aggregation, safe as SECURITY INVOKER for the same
-- reason as Part 4 (job_catalog_features is already authenticated-select-all — this grants no new
-- access, only a cheaper way to compute a `select distinct` over an already-readable array
-- column). Capped at 200 tokens — well above the realistic distinct-location count at this
-- product's target scale.
-- ================================================================================================

create or replace function public.list_discovery_location_tokens()
returns table (location_token text)
language sql
security invoker
stable
as $$
  select distinct unnest(location_tokens) as location_token
  from public.job_catalog_features
  where cardinality(location_tokens) > 0
  order by 1
  limit 200;
$$;

revoke all on function public.list_discovery_location_tokens from public;
revoke all on function public.list_discovery_location_tokens from anon;
grant execute on function public.list_discovery_location_tokens to authenticated;
