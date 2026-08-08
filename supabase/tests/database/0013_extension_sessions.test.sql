-- RLS isolation test: extension_sessions
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.extension_sessions (user_id, token_hash, device_label, expires_at)
values ('a0000000-0000-4000-8000-000000000001', 'hash-a', 'Chrome on MacBook', now() + interval '30 days');

select is(
  (select count(*)::int from public.extension_sessions where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own extension_sessions row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.extension_sessions where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s extension_sessions row'
);

update public.extension_sessions set device_label = 'Hijacked'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.extension_sessions
    where user_id = 'a0000000-0000-4000-8000-000000000001' and device_label = 'Hijacked'),
  0,
  'user B''s update of user A''s extension_sessions row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.extension_sessions where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.extension_sessions where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s extension_sessions row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.extension_sessions (user_id, token_hash, device_label, expires_at)
values ('a0000000-0000-4000-8000-000000000002', 'hash-b', 'Chrome on Windows', now() + interval '30 days');
select is(
  (select count(*)::int from public.extension_sessions where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own extension_sessions row'
);

-- token_hash is globally unique (it's the lookup key for the bearer-token auth flow), even
-- across different users — a hash collision here would let one user's token resolve to
-- another user's session.
select throws_ok(
  $$ insert into public.extension_sessions (user_id, token_hash, expires_at)
     values ('a0000000-0000-4000-8000-000000000002', 'hash-a', now() + interval '30 days') $$,
  23505,
  null,
  'token_hash is unique even across different users'' rows'
);

select * from finish();
rollback;
