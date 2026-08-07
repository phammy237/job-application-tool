-- RLS isolation test: candidate_facts
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

insert into public.candidate_facts (user_id, category, title, normalized_value)
values ('a0000000-0000-4000-8000-000000000001', 'SKILL', 'TypeScript', 'TypeScript');

select is(
  (select count(*)::int from public.candidate_facts where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own candidate_facts row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.candidate_facts where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s candidate_facts row'
);

update public.candidate_facts set user_approved = true
  where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.candidate_facts
    where user_id = 'a0000000-0000-4000-8000-000000000001' and user_approved = true),
  0,
  'user B cannot approve (update) user A''s candidate_facts row — affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.candidate_facts where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.candidate_facts where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s candidate_facts row affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.candidate_facts (user_id, category, title, normalized_value)
values ('a0000000-0000-4000-8000-000000000002', 'SKILL', 'Go', 'Go');
select is(
  (select count(*)::int from public.candidate_facts where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own candidate_facts row'
);

select * from finish();
rollback;
