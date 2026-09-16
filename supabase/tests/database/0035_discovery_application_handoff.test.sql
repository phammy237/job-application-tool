-- Job Discovery Track D6 — discovery -> application handoff (migration 0032). Proves:
--   - applications.job_catalog_id: FK behavior, the partial unique index is a real
--     database-enforced dedup guarantee (not merely app-code convention);
--   - start_application_from_catalog_job: idempotent create-or-find (tier 1: same catalog job
--     already tracked), tier-2 convergence onto a pre-existing extension-created application at
--     the identical canonical URL (never a duplicate row), always creates status='SAVED' (never
--     APPLIED — there is no parameter for it at all), records exactly one STATUS_CHANGE +
--     one DISCOVERY_HANDOFF event on first creation and zero new events on an idempotent repeat;
--   - the function is service-role-only (revoked from public/anon/authenticated) — the same
--     D5A-established "verify grants live" discipline;
--   - cross-user isolation: two users can independently track the same global catalog job without
--     colliding, and one user's application is invisible to the other under RLS;
--   - list_own_discovery_feed's new tracked-application LEFT JOIN is correctly scoped per-user and
--     still correctly revoked from anon after being dropped+recreated by this migration;
--   - job_snapshots.source_type now accepts ASHBY.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values ('b0000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme-d6');

insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, source_url,
  canonical_apply_url, content_hash
) values (
  'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'gh-d6-1',
  'Acme', 'Backend Engineer', 'backend engineer', 'https://acme.example.com/apply/d6-1',
  'https://acme.example.com/jobs/d6-1', 'https://acme.example.com/apply/d6-1', 'v1:d6hash1'
);
-- A second catalog job used only for the "same job, two independent users" isolation check.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash
) values (
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'gh-d6-2',
  'Acme', 'Frontend Engineer', 'frontend engineer', 'https://acme.example.com/apply/d6-2', 'v1:d6hash2'
);

insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version, role_family, normalized_workplace_type, normalized_employment_type)
values
  ('c0000000-0000-4000-8000-000000000001', 'v1:d6hash1', 'd4-features-v1', 'SOFTWARE_ENGINEERING', 'REMOTE', 'FULL_TIME'),
  ('c0000000-0000-4000-8000-000000000002', 'v1:d6hash2', 'd4-features-v1', 'SOFTWARE_ENGINEERING', 'REMOTE', 'FULL_TIME');

insert into public.user_job_match_scores (
  user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 80, 70, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 60, 50, 'UNKNOWN', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1');

-- ------------------------------------------------------------------------------------------------
-- Structural existence.
-- ------------------------------------------------------------------------------------------------
insert into pgtap_log(line) select has_function('public', 'start_application_from_catalog_job', 'start_application_from_catalog_job function exists');
insert into pgtap_log(line) select has_column('public', 'applications', 'job_catalog_id', 'applications.job_catalog_id column exists');
insert into pgtap_log(line) select has_column('public', 'application_events', 'metadata', 'application_events.metadata column exists');

-- ------------------------------------------------------------------------------------------------
-- job_snapshots.source_type accepts ASHBY.
-- ------------------------------------------------------------------------------------------------
insert into pgtap_log(line) select lives_ok(
  $$ insert into public.job_snapshots (user_id, source_job_id, company, title, content_fingerprint, source_type)
     values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'v1:ashbytest', 'ASHBY') $$,
  'job_snapshots.source_type accepts ASHBY'
);
delete from public.job_snapshots where content_fingerprint = 'v1:ashbytest';

-- ------------------------------------------------------------------------------------------------
-- start_application_from_catalog_job: first call creates a new SAVED application.
-- ------------------------------------------------------------------------------------------------
-- Captured into a temp table rather than compared via results_eq directly against a table
-- lookup: within one results_eq(sql1, sql2, ...) statement, sql2 does not see writes sql1 just
-- made (confirmed live — the two are evaluated as independent cursors against the statement's own
-- snapshot) — so a "the id the RPC returned really did get persisted" check needs the two reads
-- split across separate top-level statements, which trivially see each other's already-committed-
-- within-this-transaction writes.
create temp table t_d6_first_call as
select * from public.start_application_from_catalog_job(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  'Acme', 'Backend Engineer', 'Remote', 'Full-time', 'https://acme.example.com/jobs/d6-1',
  'Build things.', array['5 years experience'], array[]::text[], array['Ship features']::text[],
  array[]::text[], null, null, null, array['Remote'], 'REMOTE', 'GREENHOUSE',
  'v1:snapfingerprint1', false, array[]::text[],
  'https://acme.example.com/apply/d6-1',
  '{"jobCatalogId":"c0000000-0000-4000-8000-000000000001","sourceType":"GREENHOUSE","matchScore":80,"coverage":70,"eligibilityStatus":"ELIGIBLE","rankingVersion":"d4-ranking-v1","featureVersion":"d4-features-v1","eligibilityVersion":"d4-eligibility-v1"}'::jsonb
);

insert into pgtap_log(line) select results_eq(
  $$ select created, application_status from t_d6_first_call $$,
  $$ values (true, 'SAVED') $$,
  'first call reports created=true, application_status=SAVED'
);
insert into pgtap_log(line) select is(
  (select application_id from t_d6_first_call),
  (select id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  'the id the RPC returned matches the id actually persisted'
);

insert into pgtap_log(line) select is(
  (select status from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  'SAVED',
  'the created application''s persisted status is exactly SAVED'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000001' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000001' and ae.event_type = 'STATUS_CHANGE'),
  1,
  'exactly one STATUS_CHANGE event was recorded on first creation'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000001' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000001' and ae.event_type = 'DISCOVERY_HANDOFF'),
  1,
  'exactly one DISCOVERY_HANDOFF event was recorded on first creation'
);
insert into pgtap_log(line) select is(
  (select (ae.metadata->>'matchScore')::numeric from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000001' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000001' and ae.event_type = 'DISCOVERY_HANDOFF'),
  80::numeric,
  'the DISCOVERY_HANDOFF event carries the supplied match score as historical metadata'
);
insert into pgtap_log(line) select isnt(
  (select job_snapshot_id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  null,
  'a job_snapshot was created and linked'
);
insert into pgtap_log(line) select is(
  (select source_job_id from public.job_snapshots where id = (
     select job_snapshot_id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'
   )),
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'the snapshot''s source_job_id honestly identifies the job_catalog row it was captured from'
);

-- ------------------------------------------------------------------------------------------------
-- Idempotency: an identical second call returns the same application, no new writes.
-- ------------------------------------------------------------------------------------------------
insert into pgtap_log(line) select results_eq(
  $$ select application_id, created from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       'Acme', 'Backend Engineer', 'Remote', 'Full-time', 'https://acme.example.com/jobs/d6-1',
       'Build things.', array['5 years experience'], array[]::text[], array['Ship features']::text[],
       array[]::text[], null, null, null, array['Remote'], 'REMOTE', 'GREENHOUSE',
       'v1:snapfingerprint1', false, array[]::text[],
       'https://acme.example.com/apply/d6-1', '{}'::jsonb
     ) $$,
  $$ values ((select id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'), false) $$,
  'a second identical call returns the same application id with created=false'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'still exactly one application row after the repeat call'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000001' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'still exactly two events (one STATUS_CHANGE, one DISCOVERY_HANDOFF) after the repeat call — the idempotent path writes nothing new'
);

-- ------------------------------------------------------------------------------------------------
-- The partial unique index is a real, database-enforced guarantee — not merely app-code
-- convention. A raw duplicate INSERT (bypassing the RPC entirely) must fail.
-- ------------------------------------------------------------------------------------------------
insert into pgtap_log(line) select throws_ok(
  $$ insert into public.applications (user_id, job_catalog_id, company, title, status)
     values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'SAVED') $$,
  '23505',
  null,
  'a raw duplicate (user_id, job_catalog_id) insert is rejected by applications_user_job_catalog_id_key'
);

-- ------------------------------------------------------------------------------------------------
-- Tier 2: converges onto a pre-existing extension-created application at the identical canonical
-- URL, rather than creating a second row for the same real-world posting.
-- ------------------------------------------------------------------------------------------------
insert into public.applications (user_id, company, title, status, canonical_url)
values ('a0000000-0000-4000-8000-000000000002', 'Acme', 'Frontend Engineer', 'IN_PROGRESS', 'https://acme.example.com/apply/d6-2');

update public.job_catalog set canonical_apply_url = 'https://acme.example.com/apply/d6-2', source_url = 'https://acme.example.com/jobs/d6-2'
  where id = 'c0000000-0000-4000-8000-000000000002';

insert into pgtap_log(line) select results_eq(
  $$ select application_id, created, application_status from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000002'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid,
       'Acme', 'Frontend Engineer', 'Remote', 'Full-time', 'https://acme.example.com/jobs/d6-2',
       'Build UI.', array[]::text[], array[]::text[], array[]::text[], array[]::text[],
       null, null, null, array['Remote'], 'REMOTE', 'GREENHOUSE',
       'v1:snapfingerprint2', false, array[]::text[],
       'https://acme.example.com/apply/d6-2', '{}'::jsonb
     ) $$,
  $$ values ((select id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000002' and canonical_url = 'https://acme.example.com/apply/d6-2'), false, 'IN_PROGRESS') $$,
  'converges onto the pre-existing extension-created application (created=false), status untouched'
);
insert into pgtap_log(line) select is(
  (select job_catalog_id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000002' and canonical_url = 'https://acme.example.com/apply/d6-2'),
  'c0000000-0000-4000-8000-000000000002'::uuid,
  'the pre-existing application was backfilled with job_catalog_id provenance'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where user_id = 'a0000000-0000-4000-8000-000000000002' and canonical_url = 'https://acme.example.com/apply/d6-2'),
  1,
  'tier-2 convergence never creates a second row for the same real-world posting'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000002' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000002' and ae.event_type = 'STATUS_CHANGE'),
  0,
  'tier-2 convergence records no STATUS_CHANGE event — the status never actually changed'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events ae join public.applications a on a.id = ae.application_id
     where a.user_id = 'a0000000-0000-4000-8000-000000000002' and a.job_catalog_id = 'c0000000-0000-4000-8000-000000000002' and ae.event_type = 'DISCOVERY_HANDOFF'),
  1,
  'tier-2 convergence still records exactly one DISCOVERY_HANDOFF provenance event'
);

-- ------------------------------------------------------------------------------------------------
-- Missing catalog job -> a clean exception, not a silently-invalid row.
-- ------------------------------------------------------------------------------------------------
insert into pgtap_log(line) select throws_ok(
  $$ select * from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000001'::uuid, '99999999-9999-4999-8999-999999999999'::uuid,
       'X', 'Y', null, null, null, null, array[]::text[], array[]::text[], array[]::text[],
       array[]::text[], null, null, null, array[]::text[], null, null,
       'v1:missing', false, array[]::text[], null, '{}'::jsonb
     ) $$,
  'job_catalog 99999999-9999-4999-8999-999999999999 not found',
  'a nonexistent job_catalog_id is rejected with a clear exception'
);

-- ------------------------------------------------------------------------------------------------
-- Grants: service-role only.
-- ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into pgtap_log(line) select throws_ok(
  $$ select * from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       'X', 'Y', null, null, null, null, array[]::text[], array[]::text[], array[]::text[],
       array[]::text[], null, null, null, array[]::text[], null, null,
       'v1:x', false, array[]::text[], null, '{}'::jsonb
     ) $$,
  '42501',
  null,
  'authenticated cannot call start_application_from_catalog_job directly'
);

set local role anon;
insert into pgtap_log(line) select throws_ok(
  $$ select * from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       'X', 'Y', null, null, null, null, array[]::text[], array[]::text[], array[]::text[],
       array[]::text[], null, null, null, array[]::text[], null, null,
       'v1:x', false, array[]::text[], null, '{}'::jsonb
     ) $$,
  '42501',
  null,
  'anon cannot call start_application_from_catalog_job'
);
insert into pgtap_log(line) select throws_ok(
  $$ select * from public.list_own_discovery_feed() $$,
  '42501',
  null,
  'anon still cannot call list_own_discovery_feed after this migration dropped+recreated it (grants re-applied correctly)'
);

-- ------------------------------------------------------------------------------------------------
-- Cross-user isolation: two users independently tracking the same global catalog job never
-- collide, and one user's application is invisible to the other.
-- ------------------------------------------------------------------------------------------------
set local role service_role;
insert into pgtap_log(line) select lives_ok(
  $$ select * from public.start_application_from_catalog_job(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid,
       'Acme', 'Frontend Engineer', null, null, null, null, array[]::text[], array[]::text[],
       array[]::text[], array[]::text[], null, null, null, array[]::text[], null, 'GREENHOUSE',
       'v1:userA-job2', false, array[]::text[], null, '{}'::jsonb
     ) $$,
  'user A can independently start their own application for a job user B is already tracking'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where job_catalog_id = 'c0000000-0000-4000-8000-000000000002'),
  2,
  'two independent applications now exist for the same catalog job, one per user'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s applications at all under RLS'
);

-- ------------------------------------------------------------------------------------------------
-- list_own_discovery_feed: tracked-application state is scoped per-user and never leaks.
-- ------------------------------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select tracked_application_id from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  (select id from public.applications where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  'user A sees their own tracked_application_id on the feed row for the tracked job'
);
insert into pgtap_log(line) select is(
  (select tracked_application_status from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  'SAVED',
  'user A sees the correct tracked_application_status'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select tracked_application_id from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  null,
  'user B sees tracked_application_id = null for a job only user A has tracked — never leaked across users'
);

-- ------------------------------------------------------------------------------------------------
-- FK behavior: deleting a job_catalog row nulls the application's provenance link but preserves
-- the application row itself (docs/JOB_DISCOVERY.md "Catalog lifecycle behavior").
-- ------------------------------------------------------------------------------------------------
set local role service_role;
delete from public.job_catalog where id = 'c0000000-0000-4000-8000-000000000002';
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where title = 'Frontend Engineer'),
  2,
  'both applications for the deleted catalog job still exist after its job_catalog row is removed'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where title = 'Frontend Engineer' and job_catalog_id is null),
  2,
  'on delete set null: their job_catalog_id provenance link is cleared, never cascading the delete to the application itself'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
