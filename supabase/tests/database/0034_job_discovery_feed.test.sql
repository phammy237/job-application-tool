-- Job Discovery Track D5A — /discover feed support (migration 0031). Proves:
--   - the generated `user_job_match_scores.coverage_bucket` column classifies coverage into the
--     documented HIGH(0)/MODERATE(1)/LOW(2) tiers exactly (packages/shared's
--     `getCoverageBucket` mirrors this same rule — see that file for the threshold rationale);
--   - `list_own_discovery_feed()` returns only the calling user's own scores (SECURITY INVOKER +
--     `auth.uid()` scoping, never leaking another user's row even though the function itself runs
--     with the caller's own privileges, not elevated ones), applies every documented filter
--     correctly, orders by coverage_bucket asc / match_score desc / job_catalog_id asc, and
--     paginates via limit/offset without erroring past the end of the result set;
--   - `list_discovery_location_tokens()` returns the distinct, sorted set of location tokens, and
--     its own return signature carries no per-user column at all (so it cannot leak per-user data
--     even in principle, not merely "we didn't pass a user filter");
--   - both functions are revoked from `anon`/`public` and only granted to `authenticated`;
--   - both functions are SECURITY INVOKER at the pg_proc catalog level (not merely in the SQL
--     source text) and have no `user_id`/`p_user_*`-shaped parameter a caller could tamper with —
--     identity comes only from `auth.uid()`, never a client-supplied argument;
--   - row level security is actually enabled (`pg_class.relrowsecurity`) on `user_job_match_scores`.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values ('b0000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme-d5a');

-- job1: HIGH coverage (90), moderate match (50), recent, SOFTWARE_ENGINEERING/REMOTE/FULL_TIME,
--       tagged with a location token, title/company chosen to exercise the search filter.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'gh-d5a-1',
  'Acme', 'Backend Engineer', 'backend engineer', 'https://acme.example.com/apply/d5a-1', 'v1:d5ahash1',
  now()
);
-- job2: HIGH coverage (65), highest match (80), recent, SOFTWARE_ENGINEERING/HYBRID/FULL_TIME.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'gh-d5a-2',
  'Acme', 'Senior Engineer', 'senior engineer', 'https://acme.example.com/apply/d5a-2', 'v1:d5ahash2',
  now()
);
-- job3: LOW coverage (20), highest raw match (100), old (out of any short freshness window),
--       DATA_SCIENCE/ONSITE/INTERNSHIP, different company (search-by-company target).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'gh-d5a-3',
  'Globex', 'Data Science Intern', 'data science intern', 'https://globex.example.com/apply/d5a-3', 'v1:d5ahash3',
  now() - interval '10 days'
);
-- job4: MODERATE coverage (45) — exists only to prove the middle bucket classifies correctly;
--       excluded from every other assertion below by construction (no match score references it
--       in a filter that would pull it into a result set unexpectedly... it does appear in the
--       unfiltered default-order call, see below).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash,
  first_seen_at
) values (
  'c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'gh-d5a-4',
  'Acme', 'Product Manager', 'product manager', 'https://acme.example.com/apply/d5a-4', 'v1:d5ahash4',
  now()
);

insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version, role_family, normalized_workplace_type, normalized_employment_type, location_tokens)
values
  ('c0000000-0000-4000-8000-000000000001', 'v1:d5ahash1', 'd4-features-v1', 'SOFTWARE_ENGINEERING', 'REMOTE', 'FULL_TIME', array['NEW_YORK_NY']),
  ('c0000000-0000-4000-8000-000000000002', 'v1:d5ahash2', 'd4-features-v1', 'SOFTWARE_ENGINEERING', 'HYBRID', 'FULL_TIME', array[]::text[]),
  ('c0000000-0000-4000-8000-000000000003', 'v1:d5ahash3', 'd4-features-v1', 'DATA_SCIENCE', 'ONSITE', 'INTERNSHIP', array[]::text[]),
  ('c0000000-0000-4000-8000-000000000004', 'v1:d5ahash4', 'd4-features-v1', 'PRODUCT_MANAGEMENT', 'ONSITE', 'FULL_TIME', array[]::text[]);

insert into public.user_job_match_scores (
  user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 50, 90, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 80, 65, 'UNKNOWN', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 100, 20, 'CONFLICT', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004', 10, 45, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1');

-- User B has their own, independent score on job1 — used below to prove the RPC never leaks
-- user A's row to user B even for a job both users have a score on.
insert into public.user_job_match_scores (
  user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values (
  'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 5, 5, 'UNKNOWN', 'd4-ranking-v1', 'd4-features-v1', 'd4-eligibility-v1'
);

-- ------------------------------------------------------------------------------------------------
-- Structural existence.
-- ------------------------------------------------------------------------------------------------
select has_function('public', 'list_own_discovery_feed', 'list_own_discovery_feed function exists');
select has_function('public', 'list_discovery_location_tokens', 'list_discovery_location_tokens function exists');

-- ------------------------------------------------------------------------------------------------
-- Structural security guarantees — checked against the actual pg_catalog state, not just the
-- migration's own SQL text (a permanent regression guard requested during D5A security review:
-- these would fail if a future edit silently changed either function to SECURITY DEFINER, added a
-- client-suppliable user-id override parameter, disabled RLS on user_job_match_scores, or widened
-- list_discovery_location_tokens' return shape to carry a per-user column).
-- ------------------------------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc where proname = 'list_own_discovery_feed' and pronamespace = 'public'::regnamespace),
  false,
  'list_own_discovery_feed is SECURITY INVOKER (prosecdef = false) at the pg_proc catalog level'
);
select is(
  (select prosecdef from pg_proc where proname = 'list_discovery_location_tokens' and pronamespace = 'public'::regnamespace),
  false,
  'list_discovery_location_tokens is SECURITY INVOKER (prosecdef = false) at the pg_proc catalog level'
);
select is(
  (select relrowsecurity from pg_class where relname = 'user_job_match_scores' and relnamespace = 'public'::regnamespace),
  true,
  'row level security is actually enabled on user_job_match_scores'
);
select is(
  (select count(*)::int from pg_proc p
     where p.proname = 'list_own_discovery_feed' and p.pronamespace = 'public'::regnamespace
       and (pg_get_function_arguments(p.oid) ilike '%user_id%' or pg_get_function_arguments(p.oid) ilike '%p_user%')),
  0,
  'list_own_discovery_feed has no user-id-shaped parameter a caller could tamper with — identity comes only from auth.uid()'
);
select is(
  (select pg_get_function_result(oid) from pg_proc where proname = 'list_discovery_location_tokens' and pronamespace = 'public'::regnamespace),
  'TABLE(location_token text)',
  'list_discovery_location_tokens returns only a bare location_token column — no user_id, no score, nothing per-user'
);

-- ------------------------------------------------------------------------------------------------
-- coverage_bucket generated column.
-- ------------------------------------------------------------------------------------------------
select is(
  (select coverage_bucket from public.user_job_match_scores
     where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  0::smallint,
  'coverage 90 (>= 60) classifies as bucket 0 (HIGH)'
);
select is(
  (select coverage_bucket from public.user_job_match_scores
     where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000004'),
  1::smallint,
  'coverage 45 (30-59) classifies as bucket 1 (MODERATE)'
);
select is(
  (select coverage_bucket from public.user_job_match_scores
     where user_id = 'a0000000-0000-4000-8000-000000000001' and job_catalog_id = 'c0000000-0000-4000-8000-000000000003'),
  2::smallint,
  'coverage 20 (< 30) classifies as bucket 2 (LOW)'
);

-- ------------------------------------------------------------------------------------------------
-- list_own_discovery_feed: default order and filters, as user A.
-- ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed()),
  array[
    'c0000000-0000-4000-8000-000000000002', -- bucket 0, match 80
    'c0000000-0000-4000-8000-000000000001', -- bucket 0, match 50
    'c0000000-0000-4000-8000-000000000004', -- bucket 1, match 10
    'c0000000-0000-4000-8000-000000000003'  -- bucket 2, match 100 (last despite the highest match)
  ]::uuid[],
  'default order is coverage_bucket asc, then match_score desc within each bucket'
);

select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_role_families := array['SOFTWARE_ENGINEERING'])),
  array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001']::uuid[],
  'role_family filter narrows to SOFTWARE_ENGINEERING, order preserved'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_workplace_types := array['ONSITE'])),
  array['c0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003']::uuid[],
  'workplace filter narrows to ONSITE'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP'])),
  array['c0000000-0000-4000-8000-000000000003']::uuid[],
  'employment type filter narrows to INTERNSHIP'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_min_match := 70)),
  array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003']::uuid[],
  'min_match filter keeps only match_score >= 70, default order still applies'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_min_coverage := 50)),
  array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001']::uuid[],
  'min_coverage filter keeps only coverage >= 50'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_search := 'intern')),
  array['c0000000-0000-4000-8000-000000000003']::uuid[],
  'search matches on title (case-insensitive substring)'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_search := 'Globex')),
  array['c0000000-0000-4000-8000-000000000003']::uuid[],
  'search matches on company_name too'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_location_token := 'NEW_YORK_NY')),
  array['c0000000-0000-4000-8000-000000000001']::uuid[],
  'location_token filter matches jobs whose location_tokens array contains the token'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_freshness_days := 1)),
  array['c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004']::uuid[],
  'freshness filter excludes the 10-day-old job3'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_eligibility_statuses := array['UNKNOWN'])),
  array['c0000000-0000-4000-8000-000000000002']::uuid[],
  'eligibility_status filter selects the UNKNOWN case correctly'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_eligibility_statuses := array['CONFLICT'])),
  array['c0000000-0000-4000-8000-000000000003']::uuid[],
  'eligibility_status filter selects the CONFLICT case correctly'
);

-- Pagination: limit+1-style callers slice client-side, but the RPC's own limit/offset must be
-- exact and never error past the end of the result set.
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_limit := 1, p_offset := 0)),
  array['c0000000-0000-4000-8000-000000000002']::uuid[],
  'limit 1 offset 0 returns just the first row'
);
select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_limit := 1, p_offset := 1)),
  array['c0000000-0000-4000-8000-000000000001']::uuid[],
  'limit 1 offset 1 returns just the second row'
);
select is(
  (select count(*)::int from public.list_own_discovery_feed(p_limit := 10, p_offset := 10)),
  0,
  'an offset past the end of the result set returns zero rows, not an error'
);

-- ------------------------------------------------------------------------------------------------
-- Cross-user isolation: SECURITY INVOKER + auth.uid() scoping, never leaking user A's row to B.
-- ------------------------------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.list_own_discovery_feed()),
  1,
  'user B only ever sees their own single match score row, even on a job user A also has a score on'
);
select is(
  (select match_score from public.list_own_discovery_feed() where job_catalog_id = 'c0000000-0000-4000-8000-000000000001'),
  5::numeric,
  'the one row user B sees for job1 is user B''s own match_score (5), never user A''s (50)'
);

-- ------------------------------------------------------------------------------------------------
-- list_discovery_location_tokens: distinct, sorted, global (not user-scoped).
--
-- Not asserted as an exact set: this function reads the real, already-populated job_catalog_
-- features table (this test's own transaction sees it too, on top of whatever this fixture
-- inserted), so the live catalog's own tokens are legitimately present alongside NEW_YORK_NY —
-- exactly the live-data behavior this function is supposed to have.
-- ------------------------------------------------------------------------------------------------
select ok(
  'NEW_YORK_NY' = any(array(select location_token from public.list_discovery_location_tokens())),
  'list_discovery_location_tokens includes this fixture''s NEW_YORK_NY token'
);
select is(
  (select array(select location_token from public.list_discovery_location_tokens())),
  (select array_agg(distinct token order by token) from (
     select unnest(location_tokens) as token from public.job_catalog_features
     where cardinality(location_tokens) > 0
   ) t),
  'list_discovery_location_tokens returns exactly the distinct, sorted set of tokens (no duplicates, no omissions)'
);

-- ------------------------------------------------------------------------------------------------
-- Both functions are revoked from anon/public, granted only to authenticated.
-- ------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.list_own_discovery_feed() $$,
  '42501',
  null,
  'anon cannot call list_own_discovery_feed'
);
select throws_ok(
  $$ select * from public.list_discovery_location_tokens() $$,
  '42501',
  null,
  'anon cannot call list_discovery_location_tokens'
);

select * from finish();
rollback;
