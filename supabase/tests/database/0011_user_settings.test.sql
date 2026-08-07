-- RLS isolation test: user_settings
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- handle_new_user() (0001_init.sql) auto-creates a user_settings row for each new auth.users row.
insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own auto-created user_settings row'
);

update public.user_settings set ai_request_limit = 999
  where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select ai_request_limit from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  999,
  'user A can update their own user_settings'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s user_settings row'
);

update public.user_settings set ai_request_limit = 1
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select ai_request_limit from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  999,
  'user B cannot lower user A''s ai_request_limit — update affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can still select their own user_settings row'
);

select * from finish();
rollback;
