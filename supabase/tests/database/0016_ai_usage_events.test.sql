-- RLS isolation test: ai_usage_events
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

insert into public.ai_usage_events
  (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
values (
  'a0000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  1,
  'deterministic',
  'BASIC_PROFILE',
  'field_suggestion',
  'accepted'
);

select is(
  (select count(*)::int from public.ai_usage_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own ai_usage_events row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.ai_usage_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s ai_usage_events row'
);

update public.ai_usage_events set outcome = 'rejected'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.ai_usage_events
    where user_id = 'a0000000-0000-4000-8000-000000000001' and outcome = 'rejected'),
  0,
  'user B''s update of user A''s ai_usage_events row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.ai_usage_events where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.ai_usage_events where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s ai_usage_events row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.ai_usage_events
  (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
values (
  'a0000000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  1,
  'normal',
  'EXPERIENCE',
  'field_suggestion',
  'accepted'
);
select is(
  (select count(*)::int from public.ai_usage_events where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own ai_usage_events row'
);

select * from finish();
rollback;
