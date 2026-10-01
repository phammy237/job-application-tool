-- RLS isolation test: user_settings
-- See supabase/tests/database/README.md for how to run this.
--
-- Also covers migration 0044: the AI quota columns are server-authoritative — a user can edit
-- their own preferences but can never raise, reset, or recreate their own quota.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

update public.user_settings set theme = 'dark'
  where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select theme from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'dark',
  'user A can update their own user-editable settings (theme)'
);

-- ---- Quota columns are not user-writable (0044) ---------------------------------------------
select throws_ok(
  $$update public.user_settings set ai_request_limit = 999999
      where user_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'user A cannot raise their own ai_request_limit'
);
select throws_ok(
  $$update public.user_settings set ai_requests_this_period = 0
      where user_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'user A cannot reset their own ai_requests_this_period'
);
select throws_ok(
  $$delete from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'user A cannot delete (and so cannot recreate) their own user_settings row'
);
select throws_ok(
  $$select public.decrement_ai_request_usage('a0000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'user A cannot call decrement_ai_request_usage directly'
);
select throws_ok(
  $$select public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'user A cannot call increment_ai_request_usage directly'
);

-- ---- Cross-user isolation --------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s user_settings row'
);

update public.user_settings set theme = 'light'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select theme from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'dark',
  'user B cannot change user A''s settings — update affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_settings where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can still select their own user_settings row'
);

select * from finish();
rollback;
