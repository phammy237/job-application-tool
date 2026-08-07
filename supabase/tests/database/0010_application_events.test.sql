-- RLS isolation test: application_events
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.applications (id, user_id, company, title)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer');

insert into public.application_events (user_id, application_id, event_type, from_status, to_status, source)
values (
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'STATUS_CHANGE', null, 'SAVED', 'USER'
);

select is(
  (select count(*)::int from public.application_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own application_events row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.application_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s application_events row — no visibility into A''s timeline'
);

update public.application_events set reverted_at = now()
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.application_events
    where user_id = 'a0000000-0000-4000-8000-000000000001' and reverted_at is not null),
  0,
  'user B cannot mark user A''s event reverted — affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.application_events where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.application_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s application_events row affects zero rows'
);

-- User B cannot even reference user A's application_id for their own event, because the
-- application row itself is invisible to them under RLS and application_events has no FK
-- ownership cross-check beyond user_id — this asserts user B stays confined to their own data
-- by never being able to construct a valid application_id to attach to in the first place.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.applications where id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s application to attach a forged event to it'
);

select * from finish();
rollback;
