-- Career OS -- one-time cleanup: clear stale aggregator canonical_apply_url values left over from
-- a bug in D7.1's own rollout.
--
-- Root cause: packages/discovery/src/normalize.ts unconditionally set canonical_apply_url from
-- the adapter's own raw applyUrl for every source, including JOBRIGHT_GITHUB -- whose applyUrl is
-- always Jobright's own detail page (jobright.ai/jobs/info/<id>), never a real apply destination.
-- Every Jobright-sourced job_catalog row -- both brand-new rows created after D7.1 shipped, and
-- previously-resolved rows whose canonical_apply_url got silently overwritten back to the
-- Jobright URL the next time upsertDiscoveredJobsForSource ran a content-changed resync -- could
-- therefore end up with canonical_apply_url pointing at jobright.ai, contradicting D7.1's own
-- stated invariant (migration 0039: "canonical_apply_url... NULL until HIGH-confidence employer
-- resolution"). The application-code fix accompanies this migration (normalize.ts now never lets
-- a REJECTED_AGGREGATOR host become canonical_apply_url; upsertDiscoveredJobsForSource now never
-- lets a routine resync null out an already-resolved canonical_apply_url). This migration is the
-- one-time historical correction for rows already written with the bug.
--
-- Scoped strictly by canonical_apply_url's own host -- never by source/provider/resolution_status
-- -- matching the exact REJECTED_AGGREGATOR_BASE_DOMAINS list in
-- packages/shared/src/lib/classify-job-posting-host.ts. An ATS-native row's canonical_apply_url is
-- never on one of these hosts, so this can never touch one; a HIGH-resolved Jobright row's
-- canonical_apply_url is (by definition of HIGH resolution) an accepted employer/ATS host, so this
-- can never touch one either. Only canonical_apply_url is written -- source_url, apply_url, and
-- every resolution_* bookkeeping column are left exactly as they were, so a downgraded row is
-- still picked up by the ordinary resolution retry path (resolution_status stays whatever it was:
-- NOT_ATTEMPTED/RESOLVED_REVIEW/UNRESOLVED all already leave canonical_apply_url alone per
-- migration 0039, so clearing it here is consistent with, not a departure from, their own meaning).
--
-- Safe to rerun: the WHERE clause only ever matches rows still carrying a rejected-aggregator
-- host, so a second run always affects zero rows.
update public.job_catalog
set canonical_apply_url = null
where canonical_apply_url is not null
  and (
    canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*jobright\.ai(/|$|\?)'
    or canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com(/|$|\?)'
    or canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*indeed\.com(/|$|\?)'
    or canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*glassdoor\.com(/|$|\?)'
    or canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*ziprecruiter\.com(/|$|\?)'
    or canonical_apply_url ~* '^https?://([a-z0-9-]+\.)*simplify\.jobs(/|$|\?)'
  );
