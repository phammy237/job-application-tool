-- Job Discovery Track D4 — job_catalog_features / discovery_scoring_profiles /
-- discovery_eligibility_profiles / user_job_match_scores (migration 0030). Proves:
--   - job_catalog_features: authenticated-readable (global), service-role-write-only, same
--     posture as job_catalog itself;
--   - discovery_scoring_profiles / discovery_eligibility_profiles: standard four-policy
--     cross-user RLS isolation (this repo's usual pattern for user-owned tables);
--   - user_job_match_scores: authenticated-select-only scoped to the caller, service-role-write
--     only, same posture as job_snapshots;
--   - uniqueness constraints, CHECK constraints, and FK cascades from migration 0030.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values ('b0000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme-d4');

insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash
) values (
  'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'gh-d4-1',
  'Acme', 'Backend Engineer', 'backend engineer', 'https://acme.example.com/apply/d4-1', 'v1:d4hash1'
);

insert into public.job_catalog_features (id, job_catalog_id, content_hash_at_extraction, feature_version)
values ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'v1:d4hash1', 'd4-features-v1');

insert into public.discovery_scoring_profiles (id, user_id)
values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.discovery_eligibility_profiles (id, user_id, graduation_year)
values ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 2028);
insert into public.user_job_match_scores (
  id, user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values (
  'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001', 87.78, 90, 'ELIGIBLE',
  'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'
);

-- ------------------------------------------------------------------------------------------------
-- Structural existence.
-- ------------------------------------------------------------------------------------------------
select has_table('public', 'job_catalog_features', 'job_catalog_features table exists');
select has_table('public', 'discovery_scoring_profiles', 'discovery_scoring_profiles table exists');
select has_table('public', 'discovery_eligibility_profiles', 'discovery_eligibility_profiles table exists');
select has_table('public', 'user_job_match_scores', 'user_job_match_scores table exists');

-- ------------------------------------------------------------------------------------------------
-- job_catalog_features: authenticated can read (global), cannot write.
-- ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.job_catalog_features),
  1,
  'an authenticated user CAN read job_catalog_features (global, non-sensitive)'
);
select throws_ok(
  $$ insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version)
     values ('c0000000-0000-4000-8000-000000000001', 'v1:x', 'd4-features-v1') $$,
  '42501',
  null,
  'an authenticated user cannot insert into job_catalog_features'
);

-- ------------------------------------------------------------------------------------------------
-- discovery_scoring_profiles / discovery_eligibility_profiles: standard cross-user RLS.
-- ------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.discovery_scoring_profiles),
  1,
  'user A can see their own scoring profile'
);
select is(
  (select preset from public.discovery_scoring_profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'BALANCED',
  'the default preset is BALANCED'
);
select lives_ok(
  $$ update public.discovery_scoring_profiles set preset = 'CUSTOM'
     where user_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'user A can update their own scoring profile'
);
select is(
  (select graduation_year from public.discovery_eligibility_profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2028,
  'user A can read their own eligibility profile'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.discovery_scoring_profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s scoring profile'
);
select is(
  (select count(*)::int from public.discovery_eligibility_profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s eligibility profile'
);
select lives_ok(
  $$ update public.discovery_scoring_profiles set preset = 'LOCATION_FIRST'
     where user_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'user B''s update of user A''s scoring profile does not error (RLS silently matches 0 rows)'
);

set local role service_role;
select is(
  (select preset from public.discovery_scoring_profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'CUSTOM',
  'user B''s update above did not actually change user A''s scoring profile'
);

-- User B can create and see their own scoring profile independently.
insert into public.discovery_scoring_profiles (id, user_id)
values ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.discovery_scoring_profiles where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can see their own, independently-created scoring profile'
);

-- ------------------------------------------------------------------------------------------------
-- user_job_match_scores: select-only, scoped to the caller.
-- ------------------------------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_job_match_scores),
  1,
  'user A can read their own match score'
);
select throws_ok(
  $$ insert into public.user_job_match_scores (
       user_id, job_catalog_id, match_score, coverage, eligibility_status,
       ranking_version, feature_version, eligibility_version
     ) values (
       'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       100, 100, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'
     ) $$,
  '42501',
  null,
  'an authenticated user cannot insert into user_job_match_scores'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_job_match_scores where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s match score'
);

set local role service_role;

-- ------------------------------------------------------------------------------------------------
-- Uniqueness constraints.
-- ------------------------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version)
     values ('c0000000-0000-4000-8000-000000000001', 'v1:dup', 'd4-features-v1') $$,
  '23505',
  null,
  'duplicate job_catalog_id on job_catalog_features is rejected'
);
select throws_ok(
  $$ insert into public.discovery_scoring_profiles (user_id) values ('a0000000-0000-4000-8000-000000000001') $$,
  '23505',
  null,
  'duplicate user_id on discovery_scoring_profiles is rejected'
);
select throws_ok(
  $$ insert into public.discovery_eligibility_profiles (user_id) values ('a0000000-0000-4000-8000-000000000001') $$,
  '23505',
  null,
  'duplicate user_id on discovery_eligibility_profiles is rejected'
);
select throws_ok(
  $$ insert into public.user_job_match_scores (
       user_id, job_catalog_id, match_score, coverage, eligibility_status,
       ranking_version, feature_version, eligibility_version
     ) values (
       'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       50, 50, 'UNKNOWN', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'
     ) $$,
  '23505',
  null,
  'duplicate (user_id, job_catalog_id) on user_job_match_scores is rejected'
);

-- ------------------------------------------------------------------------------------------------
-- CHECK constraints.
-- ------------------------------------------------------------------------------------------------
select throws_ok(
  $$ update public.job_catalog_features set role_family = 'NOT_A_REAL_FAMILY'
     where job_catalog_id = 'c0000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'an unsupported role_family value is rejected by the CHECK constraint'
);
select throws_ok(
  $$ update public.user_job_match_scores set eligibility_status = 'MAYBE'
     where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'an unsupported eligibility_status value is rejected by the CHECK constraint'
);
select throws_ok(
  $$ update public.user_job_match_scores set match_score = 150
     where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'match_score > 100 is rejected by the CHECK constraint'
);
select throws_ok(
  $$ update public.discovery_eligibility_profiles set graduation_year = 1500
     where user_id = 'a0000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'a graduation_year outside the sane [2000, 2100] range is rejected by the CHECK constraint'
);

-- ------------------------------------------------------------------------------------------------
-- FK cascade.
-- ------------------------------------------------------------------------------------------------
delete from public.job_catalog where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.job_catalog_features where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a job_catalog row cascades to delete its job_catalog_features row'
);
select is(
  (select count(*)::int from public.user_job_match_scores where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  0,
  'deleting a job_catalog row cascades to delete its user_job_match_scores rows'
);

-- Note: `auth.users(id) on delete cascade` FK cascade behavior is not independently exercised
-- here (service_role lacks DELETE on auth.users in this environment, and no other file in this
-- suite deletes from auth.users directly either) — it's the same well-established FK pattern
-- every other user-owned table in this codebase already relies on, not something unique to D4.

select * from finish();
rollback;
