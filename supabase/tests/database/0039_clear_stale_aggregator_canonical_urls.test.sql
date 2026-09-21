-- Career OS -- historical cleanup migration 0041 (clear stale aggregator canonical_apply_url
-- values). Migration 0041 already ran once against an empty table during this database's own
-- setup, before this test file's rows exist -- so this test re-issues the identical UPDATE
-- statement against freshly-seeded rows to prove its WHERE clause is correct and safe. See
-- supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values
  ('e1000000-0000-4000-8000-000000000001', 'Acme', 'GREENHOUSE', 'acme-0041'),
  ('e1000000-0000-4000-8000-000000000002', 'Jobright Interns', 'JOBRIGHT_GITHUB', 'jobright/interns-0041');

-- job1 (ATS-native): canonical_apply_url on an accepted ATS host -- must never be touched.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title,
  apply_url, canonical_apply_url, content_hash, first_seen_at
) values (
  'f1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'gh-0041-1',
  'Acme', 'Backend Engineer', 'backend engineer',
  'https://boards.greenhouse.io/acme/jobs/1', 'https://boards.greenhouse.io/acme/jobs/1', 'v1:0041hash1', now()
);

-- job2 (Jobright, never resolved): the exact bug -- canonical_apply_url still the Jobright detail
-- URL. Must be cleared to null; source_url/apply_url/resolution_status must be untouched.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title,
  apply_url, source_url, canonical_apply_url, resolution_status, content_hash, first_seen_at
) values (
  'f1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'jr-0041-2',
  'Globex', 'Software Engineering Intern', 'software engineering intern',
  'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
  'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
  'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa?utm_campaign=x',
  'RESOLVED_REVIEW', 'v1:0041hash2', now()
);

-- job3 (Jobright, HIGH-resolved): canonical_apply_url already the real employer ATS URL -- must
-- never be touched, and resolution_status must stay RESOLVED_HIGH_CONFIDENCE.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title,
  apply_url, source_url, canonical_apply_url, resolution_status, content_hash, first_seen_at
) values (
  'f1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000002', 'jr-0041-3',
  'Initech', 'Data Science Intern', 'data science intern',
  'https://jobright.ai/jobs/info/bbbbbbbbbbbbbbbbbbbbbbbb',
  'https://jobright.ai/jobs/info/bbbbbbbbbbbbbbbbbbbbbbbb',
  'https://jobs.lever.co/initech/xyz',
  'RESOLVED_HIGH_CONFIDENCE', 'v1:0041hash3', now()
);

-- job4 (Jobright, never resolved): canonical_apply_url already null -- unaffected trivially.
insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title,
  apply_url, source_url, canonical_apply_url, resolution_status, content_hash, first_seen_at
) values (
  'f1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000002', 'jr-0041-4',
  'Umbrella', 'Product Intern', 'product intern',
  'https://jobright.ai/jobs/info/cccccccccccccccccccccccc',
  'https://jobright.ai/jobs/info/cccccccccccccccccccccccc',
  null, 'NOT_ATTEMPTED', 'v1:0041hash4', now()
);

-- Re-issue migration 0041's exact UPDATE (it already ran once, before these rows existed).
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

-- 1. ATS-native row is untouched.
insert into pgtap_log(line) select is(
  (select canonical_apply_url from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000001'),
  'https://boards.greenhouse.io/acme/jobs/1',
  '1. an ATS-native canonical_apply_url is never altered'
);

-- 2. Historical stale Jobright row: cleared.
insert into pgtap_log(line) select is(
  (select canonical_apply_url from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000002'),
  null,
  '2. a stale Jobright canonical_apply_url is cleared to null'
);

-- 2b. ...but source_url/apply_url/resolution_status (provenance and resolution metadata) survive.
insert into pgtap_log(line) select is(
  (select row(source_url, apply_url, resolution_status) from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000002'),
  row('https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa', 'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa', 'RESOLVED_REVIEW'),
  '2b. source_url/apply_url/resolution_status are preserved for the cleaned row'
);

-- 3. HIGH-resolved Jobright row is untouched.
insert into pgtap_log(line) select is(
  (select canonical_apply_url from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000003'),
  'https://jobs.lever.co/initech/xyz',
  '3. a HIGH-resolved Jobright row''s employer canonical_apply_url is never cleared'
);
insert into pgtap_log(line) select is(
  (select resolution_status from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000003'),
  'RESOLVED_HIGH_CONFIDENCE',
  '3b. resolution_status is never altered by this cleanup'
);

-- 4. Already-null row stays null (no error, no spurious write).
insert into pgtap_log(line) select is(
  (select canonical_apply_url from public.job_catalog where id = 'f1000000-0000-4000-8000-000000000004'),
  null,
  '4. an already-null canonical_apply_url is unaffected'
);

-- 5. Idempotent: re-running the exact same UPDATE again matches (and therefore alters) zero rows.
insert into pgtap_log(line) select is(
  (
    with affected as (
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
        )
      returning 1
    )
    select count(*)::int from affected
  ),
  0,
  '5. rerunning the same cleanup a second time affects zero rows -- idempotent'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
