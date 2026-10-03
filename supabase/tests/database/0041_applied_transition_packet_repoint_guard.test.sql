-- Migration 0045 — closes the gap in 0015's reject_direct_applied_transition() where
-- submission_packet_id could be RE-POINTED (non-null -> a different non-null value) on an
-- already-APPLIED row without the guard ever firing, since 0015 only checked the null ->
-- non-null transition. See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000021', 'repoint-guard-user@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;
insert into public.applications (id, user_id, company, title, status)
values ('e0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000021', 'Initech', 'QA Engineer', 'APPLIED');
update public.applications set applied_at = '2025-06-01T00:00:00Z' where id = 'e0000000-0000-4000-8000-000000000021';
insert into public.submission_packets (id, user_id, application_id, content_fingerprint)
values
  ('f0000000-0000-4000-8000-000000000021', 'a0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000021', 'v1:repoint-guard-fixture-a'),
  ('f0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000021', 'v1:repoint-guard-fixture-b');
update public.applications set submission_packet_id = 'f0000000-0000-4000-8000-000000000021'
  where id = 'e0000000-0000-4000-8000-000000000021';
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000021","role":"authenticated"}';

-- ============================================================================================
-- 1. Re-pointing an already-set submission_packet_id to a different packet the user owns must
--    now be rejected — the bug this migration fixes.
-- ============================================================================================
insert into pgtap_log(line) select throws_ok(
  format(
    $$update public.applications set submission_packet_id = %L
      where id = 'e0000000-0000-4000-8000-000000000021'$$,
    'f0000000-0000-4000-8000-000000000022'
  ),
  'P0001',
  null,
  'directly re-pointing an already-set submission_packet_id to a different owned packet is rejected for authenticated'
);

insert into pgtap_log(line) select is(
  (select submission_packet_id from public.applications where id = 'e0000000-0000-4000-8000-000000000021'),
  'f0000000-0000-4000-8000-000000000021'::uuid,
  'the original submission_packet_id is unchanged after the rejected re-point attempt'
);

-- ============================================================================================
-- 2. Writing the exact same value back (a no-op "change") is not treated as a transition and
--    still succeeds — the guard fires on an actual value change, never on a no-op write.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  format(
    $$update public.applications set submission_packet_id = %L
      where id = 'e0000000-0000-4000-8000-000000000021'$$,
    'f0000000-0000-4000-8000-000000000021'
  ),
  'writing back the identical submission_packet_id value still succeeds (not a real transition)'
);

-- ============================================================================================
-- 3. Editing an unrelated column on the same row is still unaffected by this change.
-- ============================================================================================
insert into pgtap_log(line) select lives_ok(
  $$update public.applications set notes = 'editing notes alongside an already-set packet id'
    where id = 'e0000000-0000-4000-8000-000000000021'$$,
  'editing an unrelated column on the row still succeeds for authenticated'
);

-- ============================================================================================
-- 4. The trusted path: service_role can still re-point submission_packet_id directly (mirrors a
--    legitimate trusted server-side correction path).
-- ============================================================================================
set local role service_role;

insert into pgtap_log(line) select lives_ok(
  format(
    $$update public.applications set submission_packet_id = %L
      where id = 'e0000000-0000-4000-8000-000000000021'$$,
    'f0000000-0000-4000-8000-000000000022'
  ),
  'service_role can re-point submission_packet_id directly'
);

reset role;

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
