-- Job Discovery Track quality gate (migration 0043) — list_own_discovery_feed must never surface
-- a job_catalog row whose status is no longer ACTIVE, even when a stale user_job_match_scores row
-- still exists for it (upsertUserJobMatchScoresBatch only ever inserts/updates ACTIVE jobs; it
-- never deletes a score row for a job that has since closed — see migration 0043's own comment).
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000010', 'user-quality-gate@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values ('b0000000-0000-4000-8000-000000000010', 'Acme', 'GREENHOUSE', 'acme-quality-gate');

-- job1: ACTIVE — must remain visible.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  status, first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000010', 'gh-qg-1',
  'Acme', 'Active Engineer', 'active engineer', 'https://acme.example.com/apply/qg-1', 'v1:qghash1',
  'ACTIVE', now()
);
-- job2: CLOSED — a stale match score exists from before it closed; must be excluded.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  status, closed_at, first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000010', 'gh-qg-2',
  'Acme', 'Closed Engineer', 'closed engineer', 'https://acme.example.com/apply/qg-2', 'v1:qghash2',
  'CLOSED', now(), now()
);
-- job3: POSSIBLY_CLOSED — one missed crawl; also excluded (uncertain-closed must not be actively
-- recommended as a fresh opportunity — migration 0043's documented, deliberately conservative
-- choice).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  status, first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000010', 'gh-qg-3',
  'Acme', 'Maybe Closed Engineer', 'maybe closed engineer', 'https://acme.example.com/apply/qg-3',
  'v1:qghash3', 'POSSIBLY_CLOSED', now()
);
-- job4: MERGED — the D7.1 dedupe path already deletes its match scores as part of merging, but
-- this proves the feed query is also independently safe even if a score row somehow still exists
-- (belt-and-suspenders, not relying solely on the merge path's own cleanup).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  status, first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000010', 'gh-qg-4',
  'Acme', 'Merged Engineer', 'merged engineer', 'https://acme.example.com/apply/qg-4', 'v1:qghash4',
  'MERGED', now()
);

insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version)
values
  ('c0000000-0000-4000-8000-000000000010', 'v1:qghash1', 'd4-features-v1'),
  ('c0000000-0000-4000-8000-000000000011', 'v1:qghash2', 'd4-features-v1'),
  ('c0000000-0000-4000-8000-000000000012', 'v1:qghash3', 'd4-features-v1'),
  ('c0000000-0000-4000-8000-000000000013', 'v1:qghash4', 'd4-features-v1');

insert into public.user_job_match_scores (
  user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000010', 50, 90, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000011', 90, 95, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000012', 90, 95, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000013', 90, 95, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000010","role":"authenticated"}';

select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed()),
  array['c0000000-0000-4000-8000-000000000010']::uuid[],
  'only the ACTIVE job is visible, despite every other job having a (higher!) stale match score'
);
select is(
  (select count(*)::int from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000011'),
  0,
  'a CLOSED job with a stale match score never appears in the feed'
);
select is(
  (select count(*)::int from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000012'),
  0,
  'a POSSIBLY_CLOSED job never appears in the feed'
);
select is(
  (select count(*)::int from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000013'),
  0,
  'a MERGED job never appears in the feed'
);
select is(
  (select count(*)::int from public.list_own_discovery_feed(p_min_match := 0)),
  1,
  'the status filter applies even with every other filter left at its most permissive'
);

select * from finish();
rollback;
