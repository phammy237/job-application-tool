-- Job Discovery Track D1 — job_sources / job_catalog (migration 0029). These are deliberately
-- GLOBAL, platform-owned tables with no user_id column — there is no "cross-user isolation" to
-- prove the way every other table in this suite proves it. What this file proves instead, per
-- CLAUDE.md's multi-tenancy rule and docs/JOB_DISCOVERY.md "Security / write boundary":
--   - anon has no write access to either table, and no read access to job_sources;
--   - an ordinary authenticated user cannot mutate either table, and can only read job_catalog
--     (never job_sources);
--   - service_role (the only real writer) can insert/update/delete both;
--   - the structural invariants from docs/JOB_DISCOVERY.md §4/§5/§6/§14 are database-enforced,
--     not just convention: uniqueness, the FK cascade, every CHECK constraint.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier, careers_url)
values ('b0000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme', 'https://acme.example.com/careers');

insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash
) values (
  'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'gh-1',
  'Acme', 'Backend Engineer', 'backend engineer', 'https://acme.example.com/apply/1', 'v1:hash1'
);

-- ------------------------------------------------------------------------------------------------
-- Structural existence.
-- ------------------------------------------------------------------------------------------------
select has_table('public', 'job_sources', 'job_sources table exists');
select has_table('public', 'job_catalog', 'job_catalog table exists');

-- ------------------------------------------------------------------------------------------------
-- anon: no read access to job_sources, no read access to job_catalog, no write access to either.
-- ------------------------------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*)::int from public.job_sources),
  0,
  'anon cannot read job_sources (no RLS policy for anon)'
);
select is(
  (select count(*)::int from public.job_catalog),
  0,
  'anon cannot read job_catalog (no RLS policy for anon)'
);
select throws_ok(
  $$ insert into public.job_sources (company_name, source_type, source_identifier)
     values ('Evil Co', 'GREENHOUSE', 'evil') $$,
  '42501',
  null,
  'anon cannot insert into job_sources'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-2', 'Acme', 'Evil', 'evil', 'https://x', 'v1:x') $$,
  '42501',
  null,
  'anon cannot insert into job_catalog'
);

-- ------------------------------------------------------------------------------------------------
-- authenticated: can read job_catalog, cannot read job_sources, cannot mutate either.
-- ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.job_catalog),
  1,
  'an ordinary authenticated user CAN read job_catalog (global, non-sensitive platform data)'
);
select is(
  (select count(*)::int from public.job_sources),
  0,
  'an ordinary authenticated user cannot read job_sources'
);
select throws_ok(
  $$ insert into public.job_sources (company_name, source_type, source_identifier)
     values ('Evil Co', 'GREENHOUSE', 'evil2') $$,
  '42501',
  null,
  'an authenticated user cannot insert into job_sources'
);
-- update/delete by authenticated are NOT expected to raise an error here (no RLS policy exists
-- for authenticated on either table, so the update/delete's own row-visibility filter matches
-- zero rows — RLS silently filters UPDATE/DELETE the same way it silently filters SELECT; only
-- INSERT's WITH CHECK failure raises an explicit error). So each is proven by running as
-- authenticated, then re-checking as service_role that nothing actually changed.
select lives_ok(
  $$ update public.job_sources set enabled = false
     where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'an authenticated user''s update of job_sources does not error (RLS silently matches 0 rows)'
);
select lives_ok(
  $$ delete from public.job_sources where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'an authenticated user''s delete of job_sources does not error (RLS silently matches 0 rows)'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-3', 'Acme', 'Evil', 'evil', 'https://x', 'v1:x') $$,
  '42501',
  null,
  'an authenticated user cannot insert into job_catalog'
);
select lives_ok(
  $$ update public.job_catalog set title = 'Hacked'
     where id = 'c0000000-0000-4000-8000-000000000001' $$,
  'an authenticated user''s update of job_catalog does not error (RLS silently matches 0 rows)'
);
select lives_ok(
  $$ delete from public.job_catalog where id = 'c0000000-0000-4000-8000-000000000001' $$,
  'an authenticated user''s delete of job_catalog does not error (RLS silently matches 0 rows)'
);

set local role service_role;

select is(
  (select enabled from public.job_sources where id = 'b0000000-0000-4000-8000-000000000001'),
  true,
  'the authenticated update above did not actually change job_sources.enabled'
);
select is(
  (select count(*)::int from public.job_sources where id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'the authenticated delete above did not actually remove the job_sources row'
);
select is(
  (select title from public.job_catalog where id = 'c0000000-0000-4000-8000-000000000001'),
  'Backend Engineer',
  'the authenticated update above did not actually change job_catalog.title'
);
select is(
  (select count(*)::int from public.job_catalog where id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the authenticated delete above did not actually remove the job_catalog row'
);

-- ------------------------------------------------------------------------------------------------
-- service_role: the only real writer — can insert/update/delete both tables.
-- ------------------------------------------------------------------------------------------------
select lives_ok(
  $$ update public.job_sources set enabled = false where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'service_role can update job_sources'
);
select lives_ok(
  $$ update public.job_catalog set consecutive_misses = 1, status = 'POSSIBLY_CLOSED'
     where id = 'c0000000-0000-4000-8000-000000000001' $$,
  'service_role can update job_catalog'
);

-- ------------------------------------------------------------------------------------------------
-- Uniqueness: (source_type, source_identifier) on job_sources.
-- ------------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.job_sources (company_name, source_type, source_identifier)
     values ('Acme Duplicate', 'GREENHOUSE', 'acme') $$,
  '23505',
  null,
  'duplicate (source_type, source_identifier) on job_sources is rejected'
);

-- ------------------------------------------------------------------------------------------------
-- Uniqueness: (source_id, source_job_id) on job_catalog — the real job-identity constraint.
-- ------------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-1', 'Acme', 'Duplicate', 'duplicate', 'https://acme.example.com/apply/1', 'v1:dup') $$,
  '23505',
  null,
  'duplicate (source_id, source_job_id) on job_catalog is rejected'
);

-- ------------------------------------------------------------------------------------------------
-- CHECK constraints.
-- ------------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.job_sources (company_name, source_type, source_identifier)
     values ('Bad', 'WORKDAY', 'bad') $$,
  '23514',
  null,
  'an unsupported source_type (e.g. WORKDAY) is rejected by the CHECK constraint'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, status)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-4', 'Acme', 'Bad', 'bad', 'https://x', 'v1:x', 'PENDING') $$,
  '23514',
  null,
  'an unsupported status value is rejected by the CHECK constraint'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, status)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-5', 'Acme', 'Bad', 'bad', 'https://x', 'v1:x', 'CLOSED') $$,
  '23514',
  null,
  'status = CLOSED without closed_at set is rejected (closed_at must accompany CLOSED)'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, closed_at)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-6', 'Acme', 'Bad', 'bad', 'https://x', 'v1:x', now()) $$,
  '23514',
  null,
  'closed_at set while status is ACTIVE (the default) is rejected'
);
select throws_ok(
  $$ insert into public.job_catalog (source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, salary_min, salary_max)
     values ('b0000000-0000-4000-8000-000000000001', 'gh-7', 'Acme', 'Bad', 'bad', 'https://x', 'v1:x', 200000, 100000) $$,
  '23514',
  null,
  'salary_min > salary_max is rejected'
);

-- ------------------------------------------------------------------------------------------------
-- updated_at trigger is attached (reused set_updated_at function) — not tested by asserting a
-- changed timestamp value, since `now()` is constant for the whole duration of this test's own
-- transaction (a real, known Postgres behavior, not a trigger bug) and would make any such
-- assertion spuriously fail regardless of whether the trigger actually fires.
-- ------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_trigger
     where tgname = 'job_sources_set_updated_at' and tgrelid = 'public.job_sources'::regclass),
  1,
  'job_sources has its updated_at trigger attached'
);
select is(
  (select count(*)::int from pg_trigger
     where tgname = 'job_catalog_set_updated_at' and tgrelid = 'public.job_catalog'::regclass),
  1,
  'job_catalog has its updated_at trigger attached'
);

-- ------------------------------------------------------------------------------------------------
-- FK cascade: deleting a job_sources row cascades to its job_catalog rows.
-- ------------------------------------------------------------------------------------------------
delete from public.job_sources where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.job_catalog where source_id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a job_sources row cascades to delete its job_catalog rows'
);

select * from finish();
rollback;
