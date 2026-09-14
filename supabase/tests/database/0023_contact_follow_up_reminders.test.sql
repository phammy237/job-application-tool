-- RLS/ownership tests for migration 0019 (contacts.follow_up_at — Phase 6C networking follow-up
-- reminders). See supabase/tests/database/README.md for how to run this and the general
-- pattern. No new table/RLS policy is added by that migration — this file exists to verify the
-- existing `contacts` RLS policies really do cover the new column, not merely assumed.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

insert into public.contacts (id, user_id, display_name, source, follow_up_at)
values
  -- User A: one contact with a past-due reminder, one with a future reminder, one with none.
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Jane Due', 'MANUAL', now() - interval '1 day'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Bob Recruiter', 'MANUAL', now() - interval '1 day'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Alex Future', 'MANUAL', now() + interval '5 days'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Sam NoReminder', 'MANUAL', null);

-- ============================================================================================
-- RLS isolation + ownership on the new column
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into pgtap_log(line) select is(
  (select follow_up_at is not null from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  true,
  'user A can select their own contact''s follow_up_at'
);

insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot see user B''s contact at all'
);

-- Verified as user B afterward, not user A: user A's own select of user B's row is already
-- blocked by the select policy regardless of whether the write succeeded, so re-checking as A
-- can't distinguish "write blocked" from "read blocked" (see supabase/tests/database/README.md).
update public.contacts set follow_up_at = now() + interval '10 days' where id = 'c0000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into pgtap_log(line) select is(
  (select follow_up_at < now() from public.contacts where id = 'c0000000-0000-4000-8000-000000000002'),
  true,
  'user A cannot set a follow-up reminder on user B''s contact — row is unaffected (still past-due, not the attempted future date)'
);
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.contacts set follow_up_at = now() + interval '3 days' where id = 'c0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is(
  (select follow_up_at > now() from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  true,
  'user A can reschedule their own contact''s follow-up reminder to a future date'
);

update public.contacts set follow_up_at = null where id = 'c0000000-0000-4000-8000-000000000001';
insert into pgtap_log(line) select is(
  (select follow_up_at from public.contacts where id = 'c0000000-0000-4000-8000-000000000001'),
  null,
  'user A can clear their own contact''s follow-up reminder ("mark follow-up done")'
);

set local request.jwt.claims to '{}';
set local role anon;
insert into pgtap_log(line) select is(
  (select count(*)::int from public.contacts where follow_up_at is not null),
  0,
  'anon has no read access to any contact, follow_up_at included'
);

set local role postgres;
select set_config('test.pre_anon_follow_up_at', (select follow_up_at::text from public.contacts where id = 'c0000000-0000-4000-8000-000000000003'), true);
set local role anon;
update public.contacts set follow_up_at = now() where id = 'c0000000-0000-4000-8000-000000000003';
set local role postgres;

insert into pgtap_log(line) select is(
  (select follow_up_at::text from public.contacts where id = 'c0000000-0000-4000-8000-000000000003'),
  current_setting('test.pre_anon_follow_up_at'),
  'anon cannot set a follow-up reminder — no anon policy exists, so RLS silently matches zero rows and the value is unaffected'
);

-- ============================================================================================
-- "due" query semantics — future excluded, null excluded, past/exactly-now included
-- ============================================================================================

insert into pgtap_log(line) select is(
  (
    select count(*)::int from public.contacts
    where user_id = 'a0000000-0000-4000-8000-000000000001'
      and follow_up_at is not null
      and follow_up_at <= now()
  ),
  0,
  'sanity: user A has no due reminder right now (A''s only remaining reminder is c...003, 5 days future)'
);

update public.contacts set follow_up_at = now() - interval '1 hour' where id = 'c0000000-0000-4000-8000-000000000003';

insert into pgtap_log(line) select is(
  (
    select array_agg(id order by follow_up_at)::text from public.contacts
    where user_id = 'a0000000-0000-4000-8000-000000000001'
      and follow_up_at is not null
      and follow_up_at <= now()
  ),
  '{c0000000-0000-4000-8000-000000000003}',
  'the due-reminder filter finds exactly the one past-due contact, scoped to user A'
);

insert into pgtap_log(line) select is(
  (
    select count(*)::int from public.contacts
    where user_id = 'a0000000-0000-4000-8000-000000000001'
      and follow_up_at is not null
      and follow_up_at <= now()
      and id = 'c0000000-0000-4000-8000-000000000004'
  ),
  0,
  'a contact with no reminder (null) is never treated as due'
);

-- ============================================================================================
-- structural integrity
-- ============================================================================================

insert into pgtap_log(line) select is(
  (select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts' and column_name = 'follow_up_at'),
  'follow_up_at',
  'contacts.follow_up_at exists'
);

insert into pgtap_log(line) select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts' and column_name = 'follow_up_at'),
  'YES',
  'contacts.follow_up_at is nullable — no explicit reminder is the default, valid state'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
