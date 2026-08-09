-- Functional correctness test: increment_ai_request_usage RPC
-- Cross-user isolation of user_settings itself is already covered by
-- 0011_user_settings.test.sql; this file only exercises the atomic check-and-increment logic
-- added in supabase/migrations/0004_increment_ai_request_usage.sql. True concurrent-safety
-- (the actual flagged risk in docs/SECURITY_AND_PRIVACY.md) needs two simultaneous
-- connections, which single-connection pgTAP can't produce — see the standalone Node
-- concurrency smoke script for that.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- handle_new_user() (0001_init.sql) auto-creates a user_settings row for each new auth.users row.
insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.user_settings
  set ai_request_limit = 3, ai_requests_this_period = 0, ai_request_period_started_at = now()
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Three calls under a limit of 3 should all be allowed, ending at a count of 3.
select public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001');
select public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001');
select is(
  (select allowed from public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001')),
  true,
  'third call under the limit of 3 is allowed'
);
select is(
  (select ai_requests_this_period from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000001'),
  3,
  'three allowed calls incremented the counter to exactly 3'
);

-- A fourth call at the limit is blocked and must not increment further.
select is(
  (select allowed from public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001')),
  false,
  'fourth call at the limit of 3 is blocked'
);
select is(
  (select ai_requests_this_period from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000001'),
  3,
  'a blocked call does not increment the counter — never double-counted'
);

-- Rolling the period start into the past should reset the counter on the next call.
update public.user_settings
  set ai_request_period_started_at = now() - interval '31 days'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

select is(
  (select row(allowed, ai_requests_this_period)
    from public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000001')),
  row(true, 1),
  'an expired period resets the counter to 0 before incrementing to 1, and the call is allowed'
);

select * from finish();
rollback;
