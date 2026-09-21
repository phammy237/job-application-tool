-- Career OS -- D7.1: Official Employer Posting Resolution for Jobright-discovered jobs.
--
-- D7 made Jobright's GitHub READMEs a real discovery source, but the only URL Jobright itself
-- supplies is its own detail page (jobright.ai/jobs/info/<id>). Real use showed that's a bad
-- APPLY destination -- the user has no Jobright account and can hit a login wall trying to apply.
-- New invariant: Jobright = discovery provenance; the employer's own career page / ATS posting =
-- the preferred apply destination.
--
-- No new "canonical URL" concept is needed -- job_catalog.canonical_apply_url (migration 0029)
-- already means "where to apply" and every ATS adapter already populates it correctly. This
-- migration adds only:
--   1. Backend-only bookkeeping columns for the resolution PROCESS itself (never read by ranking,
--      feature extraction, or the UI -- the UI answers "is this resolved" by classifying
--      canonical_apply_url's own host, not by reading these columns).
--   2. A new job_catalog.status value, 'MERGED': when an existing Jobright job_catalog row is
--      later found to duplicate an ATS-native row already in the catalog, the Jobright row is
--      retained (provenance, never deleted) but must never again be reopened by its own source's
--      normal resync (the existing freshness/reopen paths in upsertDiscoveredJobsForSource
--      unconditionally write status: 'ACTIVE' whenever a previously-seen source_job_id reappears
--      -- reusing CLOSED for this would get silently reopened the very next sync, since the
--      Jobright README entry hasn't actually disappeared, just been matched elsewhere).

alter table public.job_catalog
  drop constraint job_catalog_status_check;
alter table public.job_catalog
  add constraint job_catalog_status_check
  check (status in ('ACTIVE', 'POSSIBLY_CLOSED', 'CLOSED', 'MERGED'));

alter table public.job_catalog
  add column if not exists resolution_status text not null default 'NOT_ATTEMPTED'
    check (resolution_status in ('NOT_ATTEMPTED', 'RESOLVED_HIGH_CONFIDENCE', 'RESOLVED_REVIEW', 'UNRESOLVED')),
  add column if not exists resolution_strategy text null
    check (resolution_strategy in ('CATALOG_MATCH', 'SEARCH')),
  add column if not exists resolution_confidence numeric null,
  add column if not exists resolution_candidate_url text null,
  add column if not exists resolution_attempt_count integer not null default 0,
  add column if not exists resolution_last_attempt_at timestamptz null,
  add column if not exists resolution_link_check_failures integer not null default 0;

comment on column public.job_catalog.resolution_status is
  'D7.1 -- official-posting-resolution bookkeeping only. NOT_ATTEMPTED (default, every existing '
  'ATS-native row stays here forever -- resolution only ever runs for Jobright-sourced rows), '
  'RESOLVED_HIGH_CONFIDENCE (canonical_apply_url safely auto-populated), RESOLVED_REVIEW '
  '(candidate stored in resolution_candidate_url, canonical_apply_url deliberately left '
  'untouched), UNRESOLVED (no confident match found). Never read by ranking, feature extraction, '
  'or the UI.';
comment on column public.job_catalog.resolution_strategy is
  'CATALOG_MATCH (resolved via an existing ATS-native catalog row -- see cross-source-dedupe.ts) '
  'or SEARCH (resolved via the external search validator). Null until a resolution attempt runs.';
comment on column public.job_catalog.resolution_candidate_url is
  'A RESOLVED_REVIEW candidate URL only -- never copied into canonical_apply_url automatically. '
  'Null for every other resolution_status.';
comment on column public.job_catalog.resolution_link_check_failures is
  'D7.1 revalidation -- consecutive liveness-check failures for a SEARCH-resolved '
  'canonical_apply_url. A single transient failure is never equated with job closure; only '
  'repeated failures downgrade resolution_status back to UNRESOLVED and clear '
  'canonical_apply_url back to null (never back to the Jobright source URL).';
