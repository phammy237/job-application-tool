-- Career OS — D7: Jobright GitHub source expansion.
--
-- Widens the existing job_sources/job_catalog model (migration 0029) to admit a fourth provider
-- — JOBRIGHT_GITHUB — without inventing any new tables, catalog, or ranking path. Confirmed via
-- a live query against the linked project before writing this migration: source_type is a plain
-- CHECK constraint, not a Postgres enum, so this is a genuinely additive widen (docs/JOB_DISCOVERY.md
-- calls this out as the intended extension point in job-source.ts's own comment). Everything
-- downstream of job_catalog (normalization, feature extraction, Match/Coverage, eligibility,
-- lifecycle reconciliation) is already provider-agnostic and needs zero schema changes here.

-- ================================================================================================
-- PART 1 — job_sources: admit JOBRIGHT_GITHUB, add an ETag cache column for the adapter.
-- ================================================================================================

alter table public.job_sources
  drop constraint job_sources_source_type_check;
alter table public.job_sources
  add constraint job_sources_source_type_check
  check (source_type in ('GREENHOUSE', 'LEVER', 'ASHBY', 'JOBRIGHT_GITHUB'));

-- GitHub's Contents API rate-limits unauthenticated requests (60/hr per IP) and supports
-- conditional requests — caching the last response's ETag lets the next sync send
-- `If-None-Match` and skip re-parsing/re-diffing 100 unchanged README rows on a 304. Nullable,
-- provider-agnostic column (any future adapter needing the same pattern can reuse it); unused by
-- the three existing ATS adapters.
alter table public.job_sources
  add column if not exists etag text;

-- job_snapshots.source_type (migration 0032) has its own separate CHECK constraint — the D6
-- handoff path (start-application/route.ts) writes job_sources.source_type straight into a
-- snapshot's source_type field, so a Jobright-sourced handoff would otherwise fail this
-- constraint at write time. Same widen pattern as PART 1, and the same precedent migration 0032
-- itself used to add ASHBY here.
alter table public.job_snapshots
  drop constraint job_snapshots_source_type_check;
alter table public.job_snapshots
  add constraint job_snapshots_source_type_check
  check (source_type in ('GENERIC', 'GREENHOUSE', 'LEVER', 'WORKDAY', 'ASHBY', 'JOBRIGHT_GITHUB'));

-- ================================================================================================
-- PART 2 — job_catalog: cross-source observation provenance (D7 §8 — cross-source dedupe).
-- ================================================================================================

-- `dedupe_fingerprint` (migration 0029) is explicitly analysis-only and never auto-merges two
-- provider records. D7 needs real suppression (a job Jobright re-lists from a company that
-- already has a native Greenhouse/Lever/Ashby source must never show as a second card) while
-- still never destroying the Jobright observation. Design: when a new Jobright candidate matches
-- an existing ACTIVE job_catalog row from a *different* source_id (by canonical apply URL, or
-- falling back to the existing dedupe fingerprint + a compatible posted date), no new job_catalog
-- row is inserted — the observation is appended here instead, and the original ATS-native row
-- remains the single source of truth for ranking/features exactly as today. A plain JSONB array
-- (never a new table) keeps this additive and keeps the existing (source_id, source_job_id)
-- identity constraint as the only authoritative one.
alter table public.job_catalog
  add column if not exists cross_source_observations jsonb not null default '[]'::jsonb;

comment on column public.job_catalog.cross_source_observations is
  'Array of {provider, sourceIdentifier, sourceJobId, sourceUrl, observedAt} objects for '
  'duplicate postings detected from another source and suppressed as a second card. Never read '
  'by ranking/feature-extraction; provenance only.';
