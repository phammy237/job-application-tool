-- Functional correctness test: decrement_ai_request_usage RPC (migration
-- 0033_ai_request_usage_accounting_fix.sql) — the refund half of the real-incident fix
-- (docs/AI_GROUNDING.md §7): a provider_error means Claude/the search provider was never
-- meaningfully reached, so the unit increment_ai_request_usage pre-emptively reserved should be
-- given back, never permanently spent.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
create temp table pgtap_log (seq serial, line text);
grant select, insert on pgtap_log to authenticated, anon, service_role;
grant usage on sequence pgtap_log_seq_seq to authenticated, anon, service_role;

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

update public.user_settings
  set ai_request_limit = 3, ai_requests_this_period = 2, ai_request_period_started_at = now()
  where user_id = 'a0000000-0000-4000-8000-000000000002';

-- Ordinary refund: decrements exactly by one.
select public.decrement_ai_request_usage('a0000000-0000-4000-8000-000000000002');
insert into pgtap_log(line) select is(
  (select ai_requests_this_period from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'decrement_ai_request_usage reduces the counter by exactly one'
);

-- A refund correctly un-blocks a subsequent request that would otherwise have been denied.
select public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000002');
select public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000002');
insert into pgtap_log(line) select is(
  (select allowed from public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000002')),
  false,
  'back at the limit of 3, a fourth call is blocked again — refund is not a permanent bonus'
);
select public.decrement_ai_request_usage('a0000000-0000-4000-8000-000000000002');
insert into pgtap_log(line) select is(
  (select allowed from public.increment_ai_request_usage('a0000000-0000-4000-8000-000000000002')),
  true,
  'after refunding the one unit the blocked call spent nothing on, the next real call is allowed again'
);

-- Floors at 0 — never goes negative even if called more times than reserved (defense-in-depth,
-- not expected in normal operation since every call site pairs exactly one reserve/refund).
update public.user_settings
  set ai_requests_this_period = 0
  where user_id = 'a0000000-0000-4000-8000-000000000002';
select public.decrement_ai_request_usage('a0000000-0000-4000-8000-000000000002');
insert into pgtap_log(line) select is(
  (select ai_requests_this_period from public.user_settings
    where user_id = 'a0000000-0000-4000-8000-000000000002'),
  0,
  'decrementing below zero floors at zero rather than going negative'
);

-- Grants match increment_ai_request_usage's posture — callable by authenticated (every
-- packages/ai generator runs with the caller's own session) and service_role, not by anon.
insert into pgtap_log(line) select ok(
  has_function_privilege('authenticated', 'public.decrement_ai_request_usage(uuid)', 'execute'),
  'authenticated can call decrement_ai_request_usage'
);
insert into pgtap_log(line) select ok(
  has_function_privilege('service_role', 'public.decrement_ai_request_usage(uuid)', 'execute'),
  'service_role can call decrement_ai_request_usage'
);

insert into pgtap_log(line) select * from finish();
select string_agg(line, chr(10) order by seq) as report from pgtap_log;
rollback;
