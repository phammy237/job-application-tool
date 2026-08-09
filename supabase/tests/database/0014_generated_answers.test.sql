-- RLS isolation test: generated_answers
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

insert into public.generated_answers (user_id, field_label, field_classification, answer, confidence)
values (
  'a0000000-0000-4000-8000-000000000001',
  'Why do you want to work here?',
  'FREE_RESPONSE',
  'Draft answer text.',
  0.75
);

select is(
  (select count(*)::int from public.generated_answers where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own generated_answers row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.generated_answers where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s generated_answers row'
);

update public.generated_answers set user_decision = 'APPROVED'
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.generated_answers
    where user_id = 'a0000000-0000-4000-8000-000000000001' and user_decision = 'APPROVED'),
  0,
  'user B cannot approve (update) user A''s generated_answers row — affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.generated_answers where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.generated_answers where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s generated_answers row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.generated_answers (user_id, field_label, field_classification, answer, confidence)
values (
  'a0000000-0000-4000-8000-000000000002',
  'Describe a challenging project.',
  'EXPERIENCE',
  'Draft answer text.',
  0.6
);
select is(
  (select count(*)::int from public.generated_answers where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own generated_answers row'
);

select * from finish();
rollback;
