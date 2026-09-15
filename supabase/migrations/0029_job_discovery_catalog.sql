-- Career OS — Job Discovery Track, D1: global job discovery catalog + ATS source registry.
--
-- This is deliberately NOT the existing jobs/job_snapshots system. `jobs`/`job_snapshots`
-- answer "what did this user decide to analyze/apply to" (user-owned, RLS-scoped by user_id).
-- `job_sources`/`job_catalog` below answer "what jobs currently exist on the internet" — global,
-- shared, platform-owned data with no user_id column at all (deliberately: these are not
-- per-user records, and bolting on a user_id merely to fit the usual RLS template would be
-- fabricating an owner that doesn't exist). See docs/JOB_DISCOVERY.md for the full design.
--
-- Nothing here touches jobs/job_snapshots/applications/requirement_mapping_runs/
-- submission_packets or any other existing table.

-- ================================================================================================
-- PART 1 — job_sources: registry of employer ATS job boards this catalog crawls.
-- ================================================================================================

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  source_type text not null check (source_type in ('GREENHOUSE', 'LEVER', 'ASHBY')),
  -- Provider-specific board identifier the adapter needs (Greenhouse board token, Lever
  -- site/company slug, Ashby job-board name) — never inferred by AI, always supplied by whoever
  -- configures the source (docs/JOB_DISCOVERY.md "Source registry management").
  source_identifier text not null,
  careers_url text,

  enabled boolean not null default true,
  crawl_interval_hours integer not null default 24,

  last_crawled_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  -- Bounded, sanitized message only — never a raw provider body/stack trace/secret. Enforced in
  -- application code (recordJobSourceCrawlFailure); the length check below is a second,
  -- independent backstop at the database level.
  last_error text,
  consecutive_failures integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_sources_company_name_not_blank check (length(trim(company_name)) > 0),
  constraint job_sources_source_identifier_not_blank check (length(trim(source_identifier)) > 0),
  constraint job_sources_crawl_interval_positive check (crawl_interval_hours > 0),
  constraint job_sources_consecutive_failures_nonnegative check (consecutive_failures >= 0),
  constraint job_sources_last_error_bounded check (last_error is null or length(last_error) <= 2000),

  -- The uniqueness requirement from docs/JOB_DISCOVERY.md: the same ATS board can never be
  -- configured twice. (source_type, source_identifier) is the provider-level identity — two
  -- different companies can never legitimately share one board token/site slug.
  constraint job_sources_source_type_identifier_key unique (source_type, source_identifier)
);

create trigger job_sources_set_updated_at
  before update on public.job_sources
  for each row execute function public.set_updated_at();

-- Read access pattern: job_sources carries operational data (crawl health, error text) with no
-- current user-facing surface (no /discover UI in this phase) and no reason for any ordinary
-- session to read it. Narrowest practical posture: RLS enabled, zero policies for anon/
-- authenticated — every access goes through the service-role ingestion path, which bypasses RLS
-- as a role property (same reasoning CLAUDE.md/DATA_MODEL.md already document for
-- upsert_application_from_extension and the Phase 5A functions). Revisit if a future phase adds
-- an admin UI that needs authenticated reads.
alter table public.job_sources enable row level security;

-- ================================================================================================
-- PART 2 — job_catalog: the mutable, global, canonical catalog of currently-known postings.
-- ================================================================================================

create table public.job_catalog (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.job_sources(id) on delete cascade,
  -- Provider-native job identifier — the strongest identity this phase has. Deliberately a plain
  -- text column, not further constrained: Greenhouse ids are numeric, Lever/Ashby ids are UUIDs.
  source_job_id text not null,

  company_name text not null,

  title text not null,
  -- Deterministic comparison/search representation (docs/JOB_DISCOVERY.md "Normalization") — not
  -- a predicted role family, not AI-generated.
  normalized_title text not null,

  location_text text,
  normalized_location text,
  city text,
  state_region text,
  country text,

  workplace_type text check (workplace_type in ('REMOTE', 'HYBRID', 'ONSITE')),
  employment_type text,

  description text,
  responsibilities text,
  qualifications text,

  salary_min numeric,
  salary_max numeric,
  salary_currency text,

  apply_url text not null,
  source_url text,
  canonical_apply_url text,

  -- Deterministic, conservative fingerprint over normalized company/title/location/canonical URL
  -- (docs/JOB_DISCOVERY.md "Cross-source dedupe") — a pure helper output for later duplicate
  -- *analysis*, never used to auto-merge two provider records in this phase.
  dedupe_fingerprint text,

  posted_at timestamptz,
  source_updated_at timestamptz,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  content_updated_at timestamptz not null default now(),

  consecutive_misses integer not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'POSSIBLY_CLOSED', 'CLOSED')),
  closed_at timestamptz,

  -- "v1:" + sha256hex of the canonicalized meaningful content — see
  -- packages/shared/src/lib/job-catalog-content-hash.ts. Excludes last_seen_at/crawl
  -- timestamps/database ids/created_at/updated_at by construction.
  content_hash text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_catalog_company_name_not_blank check (length(trim(company_name)) > 0),
  constraint job_catalog_title_not_blank check (length(trim(title)) > 0),
  constraint job_catalog_normalized_title_not_blank check (length(trim(normalized_title)) > 0),
  constraint job_catalog_apply_url_not_blank check (length(trim(apply_url)) > 0),
  constraint job_catalog_source_job_id_not_blank check (length(trim(source_job_id)) > 0),
  constraint job_catalog_content_hash_not_blank check (length(trim(content_hash)) > 0),
  constraint job_catalog_salary_min_nonnegative check (salary_min is null or salary_min >= 0),
  constraint job_catalog_salary_max_nonnegative check (salary_max is null or salary_max >= 0),
  constraint job_catalog_salary_range check (
    salary_min is null or salary_max is null or salary_min <= salary_max
  ),
  constraint job_catalog_consecutive_misses_nonnegative check (consecutive_misses >= 0),
  -- closed_at is set if and only if status = CLOSED (docs/JOB_DISCOVERY.md "Closed-job
  -- lifecycle") — database-enforced, not just an application-layer convention.
  constraint job_catalog_closed_at_matches_status check (
    (status = 'CLOSED' and closed_at is not null) or (status <> 'CLOSED' and closed_at is null)
  ),

  -- The one authoritative identity constraint (docs/JOB_DISCOVERY.md "Job identity"): the same
  -- provider job can never create duplicate rows across repeated ingestion. Deliberately NOT
  -- company+title (two legitimate openings can share a title) and NOT canonical_apply_url
  -- (different jobs can share a generic apply page).
  constraint job_catalog_source_job_key unique (source_id, source_job_id)
);

-- Indexes, each backing a specific access pattern documented in docs/JOB_DISCOVERY.md:
-- - source_id_status: "active jobs for source X" during reconciliation.
-- - status: global status filtering (e.g. a future /discover default view).
-- - last_seen_at / posted_at: freshness-ordered reads.
-- - content_hash: duplicate-content analysis (D7+); partial, since most rows never repeat a hash.
-- - dedupe_fingerprint: future cross-source duplicate analysis (D4+); partial, since the column
--   is only populated when a fingerprint was computable.
create index job_catalog_source_id_status_idx on public.job_catalog (source_id, status);
create index job_catalog_status_idx on public.job_catalog (status);
create index job_catalog_last_seen_at_idx on public.job_catalog (last_seen_at);
create index job_catalog_posted_at_idx on public.job_catalog (posted_at);
create index job_catalog_content_hash_idx on public.job_catalog (content_hash);
create index job_catalog_dedupe_fingerprint_idx
  on public.job_catalog (dedupe_fingerprint) where dedupe_fingerprint is not null;

create trigger job_catalog_set_updated_at
  before update on public.job_catalog
  for each row execute function public.set_updated_at();

alter table public.job_catalog enable row level security;

-- Read access pattern: unlike job_sources, job_catalog is exactly the data a future /discover
-- surface (D5, not this phase) will need to read, and it carries nothing sensitive — no user_id,
-- no private content, just public job-posting facts. Enabling authenticated SELECT now avoids a
-- follow-up migration purely to add a read policy once D5 lands, and costs nothing (there is no
-- write policy for authenticated, so this grants read-only access to shared platform data, not a
-- mutation path). anon gets no policy at all — no public /discover route exists yet either.
create policy "select job_catalog as authenticated" on public.job_catalog
  for select
  to authenticated
  using (true);

-- No insert/update/delete policy for anon or authenticated on either table, and no policy at all
-- for job_sources — every write happens exclusively through the service-role admin client
-- (packages/discovery's orchestrator, packages/database's job-sources.ts/job-catalog.ts query
-- functions), which bypasses RLS as a role property. This is the same posture CLAUDE.md already
-- requires for privileged global operations: RLS is the backstop, and the service-role code path
-- independently scopes every write to the source/job it's actually touching (never trusts a
-- client-supplied id) — see docs/JOB_DISCOVERY.md "Security / write boundary".
