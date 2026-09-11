-- Migration 0015 (Phase 5B hardening) — direct-database-write regression coverage. Unlike
-- 0019_submission_packets.test.sql, which exercises the TypeScript-facing surface
-- (mark_application_applied's own semantics), this file specifically simulates the exact class
-- of attack the adversarial review found: an authenticated user calling PostgREST/Postgres
-- directly with their own valid session role, never going through mark_application_applied at
-- all. See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000011', 'guard-user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;
insert into public.applications (id, user_id, company, title, status)
values
  ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000011', 'Acme', 'Backend Engineer', 'SAVED'),
  ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000011', 'Globex', 'Frontend Engineer', 'SAVED'),
  ('e0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000011', 'Initech', 'QA Engineer', 'APPLIED');
update public.applications set applied_at = '2025-06-01T00:00:00Z' where id = 'e0000000-0000-4000-8000-000000000013';
insert into public.submission_packets (id, user_id, application_id, content_fingerprint)
values ('f0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000013', 'v1:guard-fixture');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000011","role":"authenticated"}';

-- ============================================================================================
-- 1. Direct authenticated INSERT with status='APPLIED' must fail.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, status)
    values ('a0000000-0000-4000-8000-000000000011', 'Bypass Co', 'Eng', 'APPLIED')$$,
  'P0001',
  null,
  'a direct authenticated INSERT with status=APPLIED is rejected'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.applications where company = 'Bypass Co'),
  0,
  'no row was created by the rejected direct-INSERT APPLIED attempt'
);

-- ============================================================================================
-- 2. Ordinary non-APPLIED writes are completely unaffected.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$insert into public.applications (user_id, company, title, status)
    values ('a0000000-0000-4000-8000-000000000011', 'Ordinary Co', 'Eng', 'SAVED')$$,
  'an ordinary authenticated INSERT with status=SAVED still succeeds'
);

insert into pgtap_log(line) select lives_ok(
  $$update public.applications set notes = 'a normal note'
    where id = 'e0000000-0000-4000-8000-000000000011'$$,
  'an ordinary authenticated UPDATE (notes) on a non-APPLIED row still succeeds'
);

-- ============================================================================================
-- 3. Direct authenticated UPDATE from a non-APPLIED status into APPLIED must fail — the row
--    must remain provably untouched, not partially applied.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$update public.applications set status = 'APPLIED'
    where id = 'e0000000-0000-4000-8000-000000000011'$$,
  'P0001',
  null,
  'a direct authenticated UPDATE from SAVED to APPLIED is rejected'
);

insert into pgtap_log(line) select is(
  (select status from public.applications where id = 'e0000000-0000-4000-8000-000000000011'),
  'SAVED',
  'the application remains SAVED after the rejected direct-UPDATE APPLIED attempt'
);

-- ============================================================================================
-- 4. Setting applied_at or submission_packet_id directly, without even touching status, must
--    also fail — these are exactly the columns a fabricated "legacy applied" row would need.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  $$update public.applications set applied_at = now()
    where id = 'e0000000-0000-4000-8000-000000000012'$$,
  'P0001',
  null,
  'directly setting applied_at (without touching status) is rejected for authenticated'
);

insert into pgtap_log(line) select throws_ok(
  format(
    $$update public.applications set submission_packet_id = %L
      where id = 'e0000000-0000-4000-8000-000000000012'$$,
    'f0000000-0000-4000-8000-000000000011'
  ),
  'P0001',
  null,
  'directly setting submission_packet_id is rejected for authenticated, even referencing a real packet the user owns'
);

insert into pgtap_log(line) select is(
  (select (applied_at is null and submission_packet_id is null)
    from public.applications where id = 'e0000000-0000-4000-8000-000000000012'),
  true,
  'the target row''s applied_at/submission_packet_id remain null after both rejected attempts'
);

-- ============================================================================================
-- 5. Editing an unrelated column on an application that is ALREADY APPLIED must still succeed —
--    the guard only fires on a transition INTO the APPLIED-related values, never on every write
--    to an already-APPLIED row (this is the false-positive case the guard must avoid).
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$update public.applications set notes = 'editing notes on an already-applied row'
    where id = 'e0000000-0000-4000-8000-000000000013'$$,
  'editing notes on an already-APPLIED row still succeeds for authenticated (no new transition attempted)'
);

-- ============================================================================================
-- 6. Moving AWAY from APPLIED to a later status (INTERVIEW/OFFER/REJECTED etc.) is unaffected —
--    the guard is directional, only into APPLIED, never out of it.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$update public.applications set status = 'INTERVIEW'
    where id = 'e0000000-0000-4000-8000-000000000013'$$,
  'moving an already-APPLIED application to INTERVIEW still succeeds for authenticated'
);

-- ============================================================================================
-- 7. anon is rejected the same way as authenticated (not merely relying on auth.uid() = user_id
--    already failing first — anon should never reach far enough to test that, but confirm the
--    guard itself does not depend on being an authenticated user specifically).
-- ============================================================================================
set local request.jwt.claims to '{}';
set local role anon;

insert into pgtap_log(line) select throws_ok(
  $$insert into public.applications (user_id, company, title, status)
    values ('a0000000-0000-4000-8000-000000000011', 'Anon Bypass Co', 'Eng', 'APPLIED')$$,
  null,
  null,
  'anon cannot directly INSERT status=APPLIED either (rejected by RLS and/or the guard)'
);

reset role;

-- ============================================================================================
-- 8. The trusted path: service_role (how mark_application_applied and the revert path both
--    actually execute) can still perform every one of the writes authenticated was just denied.
-- ============================================================================================
set local role service_role;

insert into pgtap_log(line) select lives_ok(
  $$update public.applications set status = 'APPLIED', applied_at = now(), submission_packet_id = null
    where id = 'e0000000-0000-4000-8000-000000000011'$$,
  'service_role can transition an application into APPLIED directly (mirrors mark_application_applied''s own internal UPDATE)'
);

insert into pgtap_log(line) select lives_ok(
  $$update public.applications set status = 'APPLIED'
    where id = 'e0000000-0000-4000-8000-000000000012'$$,
  'service_role can restore status to APPLIED on a row whose applied_at/submission_packet_id are still null (mirrors a legitimate historical revert, or a legacy pre-packet row)'
);

insert into pgtap_log(line) select lives_ok(
  $$insert into public.applications (user_id, company, title, status)
    values ('a0000000-0000-4000-8000-000000000011', 'Legacy Fixture Co', 'Eng', 'APPLIED')$$,
  'service_role can INSERT a row already at status=APPLIED directly (mirrors truly legacy pre-Phase-5B.1 data, or test fixture setup)'
);

-- ============================================================================================
-- 9. End to end: mark_application_applied itself (not just a raw UPDATE mimicking it) still
--    fully succeeds when invoked the way production actually invokes it.
-- ============================================================================================
insert into pgtap_log(line) select results_eq(
  $$select status from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000012',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:guard-e2e')$$,
  $$values ('APPLIED'::text)$$,
  'mark_application_applied itself still succeeds end-to-end when called as service_role, unaffected by the new guard'
);

reset role;

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
