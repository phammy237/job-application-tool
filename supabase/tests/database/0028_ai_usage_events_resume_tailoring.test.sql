-- Constraint-widening test: ai_usage_events.task_type accepts 'resume_tailoring' (migration
-- 0023, Phase 7E) while every previously-allowed value keeps working. RLS isolation for this
-- table is already covered by supabase/tests/database/0016_ai_usage_events.test.sql — this file
-- only exercises the CHECK constraint itself, so it doesn't repeat that coverage.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- The new value is now accepted.
insert into public.ai_usage_events
  (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
values (
  'a0000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  1,
  'normal',
  null,
  'resume_tailoring',
  'accepted'
);
select is(
  (select count(*)::int from public.ai_usage_events
    where user_id = 'a0000000-0000-4000-8000-000000000001' and task_type = 'resume_tailoring'),
  1,
  'task_type accepts the new resume_tailoring value'
);

-- Every value that was already allowed before this migration still is (widening never drops one).
insert into public.ai_usage_events
  (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
values
  ('a0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 1, 'normal', null, 'interview_prep', 'accepted'),
  ('a0000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 1, 'deterministic', 'BASIC_PROFILE', 'field_suggestion', 'accepted');
select is(
  (select count(*)::int from public.ai_usage_events
    where user_id = 'a0000000-0000-4000-8000-000000000001'
    and task_type in ('interview_prep', 'field_suggestion')),
  2,
  'every previously-allowed task_type value still inserts successfully'
);

-- An unrecognized value is still rejected, same as before — the widening is additive, not a
-- removal of the check entirely.
select throws_ok(
  $$insert into public.ai_usage_events
      (user_id, generation_run_id, attempt_number, ladder, field_classification, task_type, outcome)
    values (
      'a0000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 1, 'normal', null,
      'not_a_real_task_type', 'accepted'
    )$$,
  '23514',
  null,
  'an unrecognized task_type value is still rejected by the CHECK constraint'
);

select * from finish();
rollback;
