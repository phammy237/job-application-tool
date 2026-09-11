-- RLS isolation, grant-authorization, ownership, immutability, and atomic-transition tests for
-- migration 0013 (submission_packets, mark_application_applied). See
-- supabase/tests/database/README.md for how to run this.

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

-- Migration 0015 (Phase 5B hardening) added a trigger that rejects any direct write setting
-- applications.status/applied_at/submission_packet_id into their APPLIED-related values unless
-- current_user = 'service_role' — a plain superuser role like `postgres` no longer bypasses it
-- (Postgres triggers fire for every role, superuser included; only an actual role-privilege check
-- like this one, or a table-level trigger disable, changes that). Every raw fixture write below
-- that touches one of those three columns must run as service_role to correctly simulate how
-- production actually reaches them (via the admin/service-role client), not as postgres.
set local role service_role;

insert into public.applications (id, user_id, company, title, status)
values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'IN_PROGRESS'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Globex', 'Frontend Engineer', 'IN_PROGRESS'),
  -- A legacy APPLIED application that predates packet support — already APPLIED, no packet.
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Initech', 'QA Engineer', 'APPLIED'),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Umbrella', 'DevOps Engineer', 'IN_PROGRESS');
update public.applications set applied_at = '2025-01-01T00:00:00Z' where id = 'e0000000-0000-4000-8000-000000000003';
reset role;
set local role postgres;

insert into public.submission_packets (id, user_id, application_id, content_fingerprint)
values ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'v1:aaa');

-- ============================================================================================
-- submission_packets: RLS (select-only), ownership, immutability
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own submission_packets row'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where id = 'f0000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot see the packet under a forged user_id filter for user B'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where id = 'f0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s submission_packets row at all'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select throws_ok(
  $$insert into public.submission_packets (user_id, application_id, content_fingerprint)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'v1:bbb')$$,
  'new row violates row-level security policy for table "submission_packets"',
  'authenticated cannot insert into submission_packets directly (no insert policy)'
);

-- No UPDATE/DELETE policy exists for authenticated at all (only "select own"), so — unlike a
-- policy that exists but evaluates false — Postgres RLS has nothing to check against for these
-- commands and the statement simply matches zero rows, silently, rather than raising an error.
-- The real assertion is therefore "the row is provably unchanged/still present", not "an
-- exception was thrown".
update public.submission_packets set content_fingerprint = 'v1:changed-by-authenticated' where id = 'f0000000-0000-4000-8000-000000000001';

insert into pgtap_log(line) select is(
  (select content_fingerprint from public.submission_packets where id = 'f0000000-0000-4000-8000-000000000001'),
  'v1:aaa',
  'authenticated cannot update submission_packets directly — the row is unaffected (no update policy at all, so RLS matches zero rows rather than erroring)'
);

delete from public.submission_packets where id = 'f0000000-0000-4000-8000-000000000001';

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where id = 'f0000000-0000-4000-8000-000000000001'),
  1,
  'authenticated cannot delete a submission_packets row — it still exists (no delete policy at all)'
);

set local role postgres;

insert into pgtap_log(line) select throws_ok(
  $$update public.submission_packets set content_fingerprint = 'v1:changed' where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'submission_packets rows are immutable and cannot be updated (id=f0000000-0000-4000-8000-000000000001)',
  'submission_packets rows are immutable even for a role that bypasses RLS entirely'
);

-- A genuinely anonymous request carries no JWT `sub` claim at all — auth.uid() must resolve to
-- null, not silently keep resolving to whichever user's claims a prior `set local` left behind
-- (request.jwt.claims is a plain session GUC, independent of `role`, so a stale claim would make
-- this test pass for the wrong reason: not "anon is denied," but "anon still looks like user A").
set local request.jwt.claims to '{}';
set local role anon;

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets),
  0,
  'anon has no access to submission_packets at all (no policy grants anon anything, and auth.uid() is null for a real anonymous request)'
);

set local role postgres;

-- ============================================================================================
-- structural integrity: one packet per application, cross-user FK rejection
-- ============================================================================================

insert into pgtap_log(line) select throws_ok(
  $$insert into public.submission_packets (user_id, application_id, content_fingerprint)
    values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'v1:second')$$,
  'duplicate key value violates unique constraint "submission_packets_application_id_key"',
  'a second packet for the same application is rejected by the unique constraint, not just application logic'
);

insert into pgtap_log(line) select throws_ok(
  format(
    $$insert into public.submission_packets (user_id, application_id, content_fingerprint)
      values ('a0000000-0000-4000-8000-000000000002', %L, 'v1:cross')$$,
    'e0000000-0000-4000-8000-000000000001'
  ),
  'insert or update on table "submission_packets" violates foreign key constraint "submission_packets_application_fkey"',
  'a packet cannot be linked to an application owned by a different user (composite FK)'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.submission_packets (user_id, application_id, job_snapshot_id, content_fingerprint)
    values ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'v1:badsnap')$$,
  'insert or update on table "submission_packets" violates foreign key constraint "submission_packets_job_snapshot_fkey"',
  'a packet cannot reference a job_snapshot that does not exist / is not owned by the same user'
);

insert into pgtap_log(line) select throws_ok(
  $$insert into public.submission_packets (answers_snapshot, user_id, application_id, content_fingerprint)
    values ('{"not":"an array"}'::jsonb, 'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'v1:badshape')$$,
  'new row for relation "submission_packets" violates check constraint "submission_packets_answers_snapshot_is_array"',
  'answers_snapshot must be a JSON array'
);

-- ============================================================================================
-- mark_application_applied: grants
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select throws_ok(
  $$select * from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:x')$$,
  'permission denied for function mark_application_applied',
  'authenticated cannot call mark_application_applied directly'
);

set local role anon;

insert into pgtap_log(line) select throws_ok(
  $$select * from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:x')$$,
  'permission denied for function mark_application_applied',
  'anon cannot call mark_application_applied either'
);

-- Called as service_role itself now, not postgres (migration 0015's trigger distinguishes them —
-- see the comment near the top of this file). This is also more representative of production
-- than the pre-0015 version of this test was: the RPC is always actually invoked via the
-- admin/service-role client, never as the bare postgres superuser.
set local role service_role;

-- ============================================================================================
-- mark_application_applied: atomic transition semantics (called as service_role, exactly how
-- production actually invokes it via the admin client)
-- ============================================================================================

-- CASE 1: first-ever transition — creates a packet, sets APPLIED, sets applied_at, links pointer.
insert into pgtap_log(line) select results_eq(
  $$select status, (applied_at is not null), (submission_packet_id is not null)
    from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002',
      '[{"fieldLabel":"Why us?"}]'::jsonb, '{"approved":1}'::jsonb, '[]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:first')$$,
  $$values ('APPLIED'::text, true, true)$$,
  'first transition: status APPLIED, applied_at set, packet linked'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where application_id = 'e0000000-0000-4000-8000-000000000002'),
  1,
  'exactly one packet exists for the application after the first transition'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events where application_id = 'e0000000-0000-4000-8000-000000000002' and event_type = 'STATUS_CHANGE'),
  1,
  'exactly one STATUS_CHANGE event was recorded for the first transition'
);

-- CASE 2: repeated mark-applied while already APPLIED — pure no-op.
insert into pgtap_log(line) select results_eq(
  $$select status, (applied_at is not null)
    from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:ignored-on-repeat')$$,
  $$values ('APPLIED'::text, true)$$,
  'repeated mark-applied on an already-APPLIED application returns the current state'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where application_id = 'e0000000-0000-4000-8000-000000000002'),
  1,
  'repeated mark-applied did not create a second packet'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events where application_id = 'e0000000-0000-4000-8000-000000000002' and event_type = 'STATUS_CHANGE'),
  1,
  'repeated mark-applied did not create a duplicate STATUS_CHANGE event'
);

-- CASE 3/4: APPLIED -> INTERVIEW -> APPLIED again reuses the same packet and preserves applied_at.
-- Capture applied_at before the round-trip.
select set_config('test.original_applied_at', (select applied_at::text from public.applications where id = 'e0000000-0000-4000-8000-000000000002'), true);
select set_config('test.original_packet_id', (select submission_packet_id::text from public.applications where id = 'e0000000-0000-4000-8000-000000000002'), true);

-- A raw status flip, deliberately bypassing changeOwnApplicationStatus's own event-recording —
-- this is only a test fixture standing in for "the application moved away from APPLIED somehow";
-- it does not itself log a STATUS_CHANGE event, unlike the real application code path.
update public.applications set status = 'INTERVIEW' where id = 'e0000000-0000-4000-8000-000000000002';

insert into pgtap_log(line) select results_eq(
  $$select status from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:second-transition')$$,
  $$values ('APPLIED'::text)$$,
  'transitioning back to APPLIED after moving away succeeds'
);

insert into pgtap_log(line) select is(
  (select applied_at::text from public.applications where id = 'e0000000-0000-4000-8000-000000000002'),
  current_setting('test.original_applied_at'),
  'applied_at is preserved (not rewritten to now()) on transitioning back to APPLIED'
);

insert into pgtap_log(line) select is(
  (select submission_packet_id::text from public.applications where id = 'e0000000-0000-4000-8000-000000000002'),
  current_setting('test.original_packet_id'),
  'the original packet is reused (not replaced) on transitioning back to APPLIED'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where application_id = 'e0000000-0000-4000-8000-000000000002'),
  1,
  'still exactly one packet after the full round-trip'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.application_events where application_id = 'e0000000-0000-4000-8000-000000000002' and event_type = 'STATUS_CHANGE'),
  2,
  'the round-trip recorded exactly the two real RPC-driven transitions (first-APPLIED, INTERVIEW->APPLIED) — the fixture''s raw APPLIED->INTERVIEW flip above does not go through this RPC and logs no event of its own, matching changeOwnApplicationStatus not being exercised here'
);

-- CASE 5: legacy APPLIED application (already APPLIED, no packet) — repeated mark-applied must
-- NOT fabricate a packet from current data.
insert into pgtap_log(line) select results_eq(
  $$select status, (submission_packet_id is null)
    from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003',
      '[{"fieldLabel":"fabricated"}]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:legacy-should-be-ignored')$$,
  $$values ('APPLIED'::text, true)$$,
  'a legacy APPLIED application with no packet stays packet-less on a repeated mark-applied call'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.submission_packets where application_id = 'e0000000-0000-4000-8000-000000000003'),
  0,
  'no packet was fabricated for the legacy APPLIED application'
);

insert into pgtap_log(line) select is(
  (select applied_at::text from public.applications where id = 'e0000000-0000-4000-8000-000000000003'),
  '2025-01-01 00:00:00+00',
  'the legacy application''s original applied_at is untouched'
);

-- Phase 5B.2: the RPC freezes whatever consistency_findings/consistency_acknowledgements content
-- it is given (the TypeScript gate is responsible for having already validated it before this
-- call) — verify a non-empty payload actually lands in the created packet, not just empty arrays
-- as every case above happened to use.
insert into pgtap_log(line) select results_eq(
  $$select status from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004',
      '[]'::jsonb, null, null,
      '[{"id":"w1","ruleId":"GPA_MISMATCH","severity":"WARNING","fieldALabel":"GPA","fieldASource":"GENERATED_ANSWER","fieldAValue":"3.2","fieldBLabel":"GPA","fieldBSource":"PROFILE_EDUCATION","fieldBValue":"3.9","description":"Mismatch"}]'::jsonb,
      '[{"findingId":"w1","acknowledgedAt":"2026-01-01T00:00:00.000Z"}]'::jsonb,
      null, null, null, 'v1:with-findings')$$,
  $$values ('APPLIED'::text)$$,
  'a transition with non-empty consistency findings/acknowledgements succeeds'
);

insert into pgtap_log(line) select is(
  (select consistency_findings ->> 'ruleId' from (
    select jsonb_array_elements(consistency_findings) as consistency_findings
    from public.submission_packets where application_id = 'e0000000-0000-4000-8000-000000000004'
  ) f),
  'GPA_MISMATCH',
  'the exact deterministic finding passed in is frozen into the created packet, not discarded or altered'
);

insert into pgtap_log(line) select is(
  (select consistency_acknowledgements -> 0 ->> 'findingId' from public.submission_packets
    where application_id = 'e0000000-0000-4000-8000-000000000004'),
  'w1',
  'the acknowledgement record (including its timestamp) is frozen into the created packet'
);

-- Confused-deputy: a caller cannot pass a p_user_id that does not actually own p_application_id
-- and still succeed.
insert into pgtap_log(line) select throws_ok(
  format(
    $$select * from public.mark_application_applied(
        %L, 'e0000000-0000-4000-8000-000000000001',
        '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:attack')$$,
    'a0000000-0000-4000-8000-000000000002'
  ),
  'application e0000000-0000-4000-8000-000000000001 not found or not owned by this user',
  'a caller cannot mark APPLIED an application owned by a different user by passing a mismatched p_user_id'
);

-- Application-not-found (nonexistent id) fails the same way.
insert into pgtap_log(line) select throws_ok(
  $$select * from public.mark_application_applied(
      'a0000000-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999',
      '[]'::jsonb, null, null, '[]'::jsonb, '[]'::jsonb, null, null, null, 'v1:missing')$$,
  'application 99999999-9999-4999-8999-999999999999 not found or not owned by this user',
  'a nonexistent application_id is rejected the same way as a cross-user one'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
