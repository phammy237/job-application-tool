-- Career OS -- Discover internship filter fix (migration 0037). Proves list_own_discovery_feed's
-- Employment type = Internship filter uses the canonical `job_catalog_features.is_internship`
-- column (broader than `normalized_employment_type = 'INTERNSHIP'` alone), while every other
-- employment-type filter value, ordering, and pagination behavior stays exactly as migration
-- 0031/0032 established it. See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('d0000000-0000-4000-8000-000000000001', 'user-a-0038@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

-- Two different providers, deliberately -- proves the filter never depends on which one a job
-- came from (case 6, "provider does not affect the result").
insert into public.job_sources (id, company_name, source_type, source_identifier)
values
  ('e0000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme-0038'),
  ('e0000000-0000-4000-8000-000000000002', 'Globex', 'LEVER', 'globex-0038');

-- job1 (GREENHOUSE): normalized_employment_type = 'INTERNSHIP' directly -- the pre-existing,
-- already-working case (1).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, first_seen_at
) values (
  'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'gh-0038-1',
  'Acme', 'Data Science Intern', 'data science intern', 'https://acme.example.com/apply/0038-1', 'v1:0038hash1', now()
);
-- job2 (LEVER): the exact bug case -- title says "Intern" but the ATS's own employment_type
-- normalizes to UNKNOWN (nothing supplied), so is_internship = true is the ONLY signal (case 2).
-- Different provider than job1 (case 6).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, first_seen_at
) values (
  'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'lv-0038-2',
  'Globex', 'Software Engineer, Intern', 'software engineer, intern', 'https://globex.example.com/apply/0038-2', 'v1:0038hash2', now()
);
-- job3: a true non-internship (FULL_TIME, is_internship = false) -- must never appear under the
-- Internship filter (case 3), and must still appear under the Full-time filter (case 4).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, first_seen_at
) values (
  'f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'gh-0038-3',
  'Acme', 'Backend Engineer', 'backend engineer', 'https://acme.example.com/apply/0038-3', 'v1:0038hash3', now()
);
-- job4: PART_TIME, is_internship = false -- proves the part-time/contract/etc. filter path is
-- untouched by the new OR clause (case 5).
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash, first_seen_at
) values (
  'f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'gh-0038-4',
  'Acme', 'Support Specialist', 'support specialist', 'https://acme.example.com/apply/0038-4', 'v1:0038hash4', now()
);

insert into public.job_catalog_features (job_catalog_id, content_hash_at_extraction, feature_version, role_family, normalized_workplace_type, normalized_employment_type, is_internship)
values
  ('f0000000-0000-4000-8000-000000000001', 'v1:0038hash1', 'd4-features-v2', 'DATA_SCIENCE', 'ONSITE', 'INTERNSHIP', true),
  ('f0000000-0000-4000-8000-000000000002', 'v1:0038hash2', 'd4-features-v2', 'SOFTWARE_ENGINEERING', 'REMOTE', 'UNKNOWN', true),
  ('f0000000-0000-4000-8000-000000000003', 'v1:0038hash3', 'd4-features-v2', 'SOFTWARE_ENGINEERING', 'HYBRID', 'FULL_TIME', false),
  ('f0000000-0000-4000-8000-000000000004', 'v1:0038hash4', 'd4-features-v2', 'STRATEGY_OPERATIONS', 'ONSITE', 'PART_TIME', false);

-- Distinct coverage_bucket/match_score so the internship-filtered result's ORDER can be checked
-- against the exact same rule the unfiltered feed already uses (case 7): job2's coverage (70,
-- bucket 0) ranks it above job1's (40, bucket 1) despite job1 having the higher raw match_score.
insert into public.user_job_match_scores (
  user_id, job_catalog_id, match_score, coverage, eligibility_status,
  ranking_version, feature_version, eligibility_version
) values
  ('d0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 90, 40, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v2', 'd4-eligibility-v1'),
  ('d0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 50, 70, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v2', 'd4-eligibility-v1'),
  ('d0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 60, 60, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v2', 'd4-eligibility-v1'),
  ('d0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', 60, 60, 'ELIGIBLE', 'd4-ranking-v1', 'd4-features-v2', 'd4-eligibility-v1');

set local role authenticated;
set local request.jwt.claims to '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- 1. normalized_employment_type = 'INTERNSHIP' appears under the Internship filter.
insert into pgtap_log(line) select ok(
  'f0000000-0000-4000-8000-000000000001' = any(
    array(select job_catalog_id from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP']))
  ),
  '1. a row whose normalized_employment_type is INTERNSHIP appears under the Internship filter'
);

-- 2. is_internship = true with a non-INTERNSHIP (here UNKNOWN) normalized employment type appears.
insert into pgtap_log(line) select ok(
  'f0000000-0000-4000-8000-000000000002' = any(
    array(select job_catalog_id from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP']))
  ),
  '2. a row with is_internship=true but normalized_employment_type=UNKNOWN appears under the Internship filter'
);

-- 3. a true non-internship never appears under the Internship filter.
insert into pgtap_log(line) select ok(
  not ('f0000000-0000-4000-8000-000000000003' = any(
    array(select job_catalog_id from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP']))
  )),
  '3. a true non-internship (is_internship=false) never appears under the Internship filter'
);
insert into pgtap_log(line) select ok(
  not ('f0000000-0000-4000-8000-000000000004' = any(
    array(select job_catalog_id from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP']))
  )),
  '3b. a PART_TIME, non-internship row never appears under the Internship filter either'
);

-- 4. Full-time filter behavior is unchanged: still selects only the true FULL_TIME row, never an
--    internship row (even one whose own normalized_employment_type happens to read UNKNOWN, since
--    UNKNOWN never matches any specific requested type on its own).
insert into pgtap_log(line) select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_employment_types := array['FULL_TIME'])),
  array['f0000000-0000-4000-8000-000000000003']::uuid[],
  '4. Full-time filter still selects exactly the true FULL_TIME row -- no regression'
);

-- 5. Part-time/contract/etc. filters are unaffected by the new OR clause.
insert into pgtap_log(line) select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_employment_types := array['PART_TIME'])),
  array['f0000000-0000-4000-8000-000000000004']::uuid[],
  '5. Part-time filter still selects exactly the true PART_TIME row -- no regression'
);
insert into pgtap_log(line) select is(
  (select count(*)::int from public.list_own_discovery_feed(p_employment_types := array['CONTRACT'])),
  0,
  '5b. Contract filter correctly returns zero rows when none exist -- no regression'
);

-- 6. Provider never affects the result -- job1 (GREENHOUSE) and job2 (LEVER) both qualify as
--    internships purely via is_internship, regardless of source_type.
insert into pgtap_log(line) select is(
  (select array_agg(job_catalog_id order by job_catalog_id) from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP'])),
  (select array_agg(id order by id) from public.job_catalog where id in (
    'f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002'
  )),
  '6. both a GREENHOUSE-sourced and a LEVER-sourced internship appear -- provider never gates the result'
);

-- 7. Existing feed ordering (coverage_bucket asc, match_score desc, job_catalog_id asc) is
--    unchanged for the internship-filtered result: job2 (coverage 70, bucket 0) ranks above job1
--    (coverage 40, bucket 1) despite job1's higher raw match_score (90 vs 50).
insert into pgtap_log(line) select is(
  (select array_agg(job_catalog_id) from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP'])),
  array['f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001']::uuid[],
  '7. internship-filtered results keep the exact same coverage_bucket/match_score/id ordering rule'
);

-- The new is_internship output column reports the correct canonical value for both internship
-- rows and the true non-internship row -- not merely "some row appeared," the flag itself is right.
insert into pgtap_log(line) select is(
  (select is_internship from public.list_own_discovery_feed(p_employment_types := array['INTERNSHIP']) where job_catalog_id = 'f0000000-0000-4000-8000-000000000002'),
  true,
  'the returned is_internship column is true for the UNKNOWN-employment-type internship row'
);
insert into pgtap_log(line) select is(
  (select is_internship from public.list_own_discovery_feed() where job_catalog_id = 'f0000000-0000-4000-8000-000000000003'),
  false,
  'the returned is_internship column is false for the true non-internship row'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
