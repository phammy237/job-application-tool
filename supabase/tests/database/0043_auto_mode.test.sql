-- Migration 0047 — Auto Mode (D9 Phase A): the new user_settings.auto_mode_enabled
-- column-privilege grant, the applications.auto_queued/auto_queue_status consistency check
-- constraint, cross-user isolation on both, the extended application_events_source_check
-- constraint accepting 'AUTO_QUEUE', and start_application_from_catalog_job's new defaulted
-- p_event_source parameter (both the new 'AUTO_QUEUE' path and the unchanged default-'USER'
-- backward-compat path for the pre-existing manual D6 handoff route). See
-- supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000032', 'auto-mode-user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000033', 'auto-mode-user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';

-- ============================================================================================
-- 1. The new column-privilege grant: authenticated can update their own auto_mode_enabled.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$update public.user_settings set auto_mode_enabled = true
    where user_id = 'a0000000-0000-4000-8000-000000000032'$$,
  'authenticated can flip their own auto_mode_enabled'
);

insert into pgtap_log(line) select is(
  (select auto_mode_enabled from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000032'),
  true,
  'the flip actually took effect'
);

-- ============================================================================================
-- 2. Cross-user isolation: user B's attempt to flip user A's auto_mode_enabled touches nothing.
-- ============================================================================================
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000033","role":"authenticated"}';

insert into pgtap_log(line) select lives_ok(
  $$update public.user_settings set auto_mode_enabled = false
    where user_id = 'a0000000-0000-4000-8000-000000000032'$$,
  'user B''s update statement against user A''s row does not error (RLS just matches zero rows)'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select auto_mode_enabled from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000032'),
  true,
  'user A''s auto_mode_enabled is untouched by user B''s attempt'
);

-- ============================================================================================
-- 3. applications.auto_queued/auto_queue_status consistency check constraint.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$insert into public.applications (id, user_id, company, title, auto_queued, auto_queue_status)
    values ('d0000000-0000-4000-8000-000000000032', 'a0000000-0000-4000-8000-000000000032',
      'Acme', 'Widget Engineer', true, 'PENDING_REVIEW')$$,
  'a valid auto_queued=true/auto_queue_status=PENDING_REVIEW combination is accepted'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, auto_queued, auto_queue_status)
    values ('a0000000-0000-4000-8000-000000000032', 'Acme', 'Bad Combo 1', true, 'NOT_APPLICABLE')$$,
  '23514',
  null,
  'auto_queued=true with auto_queue_status=NOT_APPLICABLE is rejected'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, auto_queued, auto_queue_status)
    values ('a0000000-0000-4000-8000-000000000032', 'Acme', 'Bad Combo 2', false, 'PENDING_REVIEW')$$,
  '23514',
  null,
  'auto_queued=false with auto_queue_status=PENDING_REVIEW is rejected'
);

-- ============================================================================================
-- 4. Cross-user isolation on the auto-queued application row itself.
-- ============================================================================================
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000033","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where id = 'd0000000-0000-4000-8000-000000000032'),
  0,
  'user B cannot see user A''s auto-queued application'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';

-- ============================================================================================
-- 5. application_events_source_check accepts the new 'AUTO_QUEUE' value and still rejects
--    anything else.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$insert into public.application_events
      (user_id, application_id, event_type, from_status, to_status, source)
    values
      ('a0000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000032',
        'STATUS_CHANGE', null, 'SAVED', 'AUTO_QUEUE')$$,
  'AUTO_QUEUE is a valid application_events.source value after migration 0047'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.application_events
      (user_id, application_id, event_type, from_status, to_status, source)
    values
      ('a0000000-0000-4000-8000-000000000032', 'd0000000-0000-4000-8000-000000000032',
        'STATUS_CHANGE', null, 'SAVED', 'NOT_A_REAL_SOURCE')$$,
  '23514',
  null,
  'an invalid source value is still rejected'
);

-- ============================================================================================
-- 6. start_application_from_catalog_job's new p_event_source parameter — service_role only.
-- ============================================================================================
set local role service_role;

insert into public.job_sources (id, company_name, source_type, source_identifier)
values ('b0000000-0000-4000-8000-000000000032', 'Globex', 'GREENHOUSE', 'globex-automode');

insert into public.job_catalog (
  id, source_id, source_job_id, company_name, title, normalized_title, apply_url, content_hash
) values
  ('c0000000-0000-4000-8000-000000000032', 'b0000000-0000-4000-8000-000000000032', 'gh-am-1',
    'Globex', 'QA Engineer', 'qa engineer', 'https://globex.example.com/apply/am-1', 'v1:amhash1'),
  ('c0000000-0000-4000-8000-000000000033', 'b0000000-0000-4000-8000-000000000032', 'gh-am-2',
    'Globex', 'SRE', 'sre', 'https://globex.example.com/apply/am-2', 'v1:amhash2');

insert into pgtap_log(line) select lives_ok(
  $$select * from public.start_application_from_catalog_job(
      p_user_id := 'a0000000-0000-4000-8000-000000000032'::uuid,
      p_job_catalog_id := 'c0000000-0000-4000-8000-000000000032'::uuid,
      p_snapshot_company := 'Globex', p_snapshot_title := 'QA Engineer',
      p_snapshot_location := 'Remote', p_snapshot_employment_type := 'Full-time',
      p_snapshot_source_url := 'https://globex.example.com/jobs/am-1',
      p_snapshot_description := 'Test things.',
      p_snapshot_required_qualifications := array[]::text[],
      p_snapshot_preferred_qualifications := array[]::text[],
      p_snapshot_responsibilities := array[]::text[], p_snapshot_skills := array[]::text[],
      p_snapshot_salary_min := null, p_snapshot_salary_max := null,
      p_snapshot_salary_currency := null, p_snapshot_locations := array['Remote']::text[],
      p_snapshot_work_mode := 'REMOTE', p_snapshot_source_type := 'GREENHOUSE',
      p_snapshot_content_fingerprint := 'v1:amsnapshot1', p_snapshot_content_truncated := false,
      p_snapshot_truncated_fields := array[]::text[],
      p_canonical_url := 'https://globex.example.com/apply/am-1',
      p_event_metadata := '{}'::jsonb,
      p_event_source := 'AUTO_QUEUE'
    )$$,
  'start_application_from_catalog_job accepts the new p_event_source parameter'
);

insert into pgtap_log(line) select is(
  (select status from public.applications
    where user_id = 'a0000000-0000-4000-8000-000000000032'
      and job_catalog_id = 'c0000000-0000-4000-8000-000000000032'),
  'SAVED',
  'the Auto Mode-created application is still SAVED, never APPLIED'
);

insert into pgtap_log(line) select is(
  (select source from public.application_events
    where application_id = (select id from public.applications
      where user_id = 'a0000000-0000-4000-8000-000000000032'
        and job_catalog_id = 'c0000000-0000-4000-8000-000000000032')
      and event_type = 'STATUS_CHANGE'),
  'AUTO_QUEUE',
  'the STATUS_CHANGE (null -> SAVED) event is tagged AUTO_QUEUE, not SYSTEM or USER'
);

insert into pgtap_log(line) select is(
  (select source from public.application_events
    where application_id = (select id from public.applications
      where user_id = 'a0000000-0000-4000-8000-000000000032'
        and job_catalog_id = 'c0000000-0000-4000-8000-000000000032')
      and event_type = 'DISCOVERY_HANDOFF'),
  'AUTO_QUEUE',
  'the DISCOVERY_HANDOFF event is also tagged AUTO_QUEUE'
);

-- Backward compatibility: a caller that omits p_event_source entirely (every call site that
-- predates this migration, e.g. the manual /discover "Start application" route) still gets the
-- exact same 'USER' it always hardcoded.
insert into pgtap_log(line) select lives_ok(
  $$select * from public.start_application_from_catalog_job(
      p_user_id := 'a0000000-0000-4000-8000-000000000032'::uuid,
      p_job_catalog_id := 'c0000000-0000-4000-8000-000000000033'::uuid,
      p_snapshot_company := 'Globex', p_snapshot_title := 'SRE',
      p_snapshot_location := 'Remote', p_snapshot_employment_type := 'Full-time',
      p_snapshot_source_url := 'https://globex.example.com/jobs/am-2',
      p_snapshot_description := 'Keep things up.',
      p_snapshot_required_qualifications := array[]::text[],
      p_snapshot_preferred_qualifications := array[]::text[],
      p_snapshot_responsibilities := array[]::text[], p_snapshot_skills := array[]::text[],
      p_snapshot_salary_min := null, p_snapshot_salary_max := null,
      p_snapshot_salary_currency := null, p_snapshot_locations := array['Remote']::text[],
      p_snapshot_work_mode := 'REMOTE', p_snapshot_source_type := 'GREENHOUSE',
      p_snapshot_content_fingerprint := 'v1:amsnapshot2', p_snapshot_content_truncated := false,
      p_snapshot_truncated_fields := array[]::text[],
      p_canonical_url := 'https://globex.example.com/apply/am-2',
      p_event_metadata := '{}'::jsonb
    )$$,
  'omitting p_event_source entirely still works (every pre-existing call site, unchanged)'
);

insert into pgtap_log(line) select is(
  (select source from public.application_events
    where application_id = (select id from public.applications
      where user_id = 'a0000000-0000-4000-8000-000000000032'
        and job_catalog_id = 'c0000000-0000-4000-8000-000000000033')
      and event_type = 'STATUS_CHANGE'),
  'USER',
  'omitting p_event_source defaults to USER, matching every call site that predates this migration'
);

-- ============================================================================================
-- 7. Non-regression: migration 0015's APPLIED-transition guard is untouched by this migration.
-- ============================================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000032","role":"authenticated"}';

insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, status, applied_at)
    values ('a0000000-0000-4000-8000-000000000032', 'Acme', 'Direct Applied Attempt', 'APPLIED', now())$$,
  'P0001',
  null,
  'authenticated still cannot directly insert an APPLIED application (0015 unaffected by 0047)'
);

reset role;

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
