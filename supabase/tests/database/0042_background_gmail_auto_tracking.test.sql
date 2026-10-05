-- Migration 0046 — background Gmail auto-tracking: the new column-privilege grant
-- (background_gmail_tracking_enabled), confirmation that the pre-existing APPLIED-transition
-- guard (migration 0015) still blocks a direct authenticated insert/update even with the new
-- auto_tracked column present, that service_role can still perform the one sanctioned exception
-- this migration adds (createAutoTrackedApplicationFromEmail), and that the extended
-- confirmation_status check constraint accepts 'AUTO_CREATED'. See
-- supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000031', 'bg-tracking-user@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000031","role":"authenticated"}';

-- ============================================================================================
-- 1. The new column-privilege grant: authenticated can update background_gmail_tracking_enabled.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$update public.user_settings set background_gmail_tracking_enabled = true
    where user_id = 'a0000000-0000-4000-8000-000000000031'$$,
  'authenticated can flip their own background_gmail_tracking_enabled'
);

insert into pgtap_log(line) select is(
  (select background_gmail_tracking_enabled from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000031'),
  true,
  'the flip actually took effect'
);

-- ============================================================================================
-- 2. Regression: 0044's quota-column lockdown is unaffected by this migration.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$update public.user_settings set ai_request_limit = 999999
    where user_id = 'a0000000-0000-4000-8000-000000000031'$$,
  '42501',
  null,
  'authenticated still cannot raise their own ai_request_limit (0044 unaffected by 0046)'
);

-- ============================================================================================
-- 3. The pre-existing APPLIED-transition guard (0015) still blocks a direct authenticated
--    insert, even with the new auto_tracked column present and set true.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, status, applied_at, auto_tracked)
    values ('a0000000-0000-4000-8000-000000000031', 'Acme', 'Backend Engineer', 'APPLIED', now(), true)$$,
  'P0001',
  null,
  'authenticated cannot directly insert an auto_tracked APPLIED row — 0015''s guard still applies'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where company = 'Acme' and auto_tracked = true),
  0,
  'no auto_tracked row was created by the rejected direct-insert attempt'
);

-- ============================================================================================
-- 4. service_role can perform the one sanctioned exception this migration adds (mirrors
--    createAutoTrackedApplicationFromEmail).
-- ============================================================================================
set local role service_role;

insert into pgtap_log(line) select lives_ok(
  $$insert into public.applications (user_id, company, title, status, applied_at, auto_tracked)
    values ('a0000000-0000-4000-8000-000000000031', 'Globex', 'QA Engineer', 'APPLIED', '2026-02-01T00:00:00Z', true)$$,
  'service_role can insert an auto_tracked APPLIED row directly'
);

insert into pgtap_log(line) select is(
  (select auto_tracked from public.applications where company = 'Globex'),
  true,
  'the inserted row is correctly flagged auto_tracked'
);

-- ============================================================================================
-- 5. The extended email_signals confirmation_status check constraint accepts 'AUTO_CREATED'.
-- ============================================================================================
insert into public.email_connections (id, user_id, email_address, encrypted_refresh_token)
values ('f0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000031', 'bg-tracking-user@test.local', 'encrypted');

insert into pgtap_log(line) select lives_ok(
  $$insert into public.email_signals
      (user_id, email_connection_id, provider_message_id, confirmation_status)
    values
      ('a0000000-0000-4000-8000-000000000031', 'f0000000-0000-4000-8000-000000000031', 'msg-auto-created-1', 'AUTO_CREATED')$$,
  'AUTO_CREATED is a valid confirmation_status value after migration 0046'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.email_signals
      (user_id, email_connection_id, provider_message_id, confirmation_status)
    values
      ('a0000000-0000-4000-8000-000000000031', 'f0000000-0000-4000-8000-000000000031', 'msg-invalid-1', 'NOT_A_REAL_STATUS')$$,
  '23514',
  null,
  'an invalid confirmation_status value is still rejected'
);

reset role;

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
