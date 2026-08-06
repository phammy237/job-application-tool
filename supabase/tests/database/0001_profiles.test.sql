-- RLS isolation test: profiles
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Two throwaway users. handle_new_user() (0001_init.sql) auto-creates a profiles row for
-- each via the on_auth_user_created trigger.
insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

-- Act as user A.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own auto-created profile row'
);

update public.profiles set full_name = 'User A' where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select full_name from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'User A',
  'user A can update their own profile'
);

-- Switch to user B.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s profile row (RLS filters the select)'
);

update public.profiles set full_name = 'Hijacked' where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select full_name from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'User A',
  'user B''s update of user A''s profile affects zero rows'
);

delete from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s profile affects zero rows'
);

select is(
  (select count(*)::int from public.profiles where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can still select their own profile row'
);

select * from finish();
rollback;
