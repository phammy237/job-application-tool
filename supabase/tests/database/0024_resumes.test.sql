-- RLS + invariant tests: resumes (migration 0020, Phase 7A) — logical résumé identity.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');

select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own resume row'
);

-- One MASTER per user, database-enforced.
select throws_ok(
  $$ insert into public.resumes (user_id, name, kind) values ('a0000000-0000-4000-8000-000000000001', 'Second Master', 'MASTER') $$,
  '23505',
  null,
  'a second MASTER resume for the same user is rejected by the partial unique index'
);

-- A TAILORED resume may point at the MASTER.
insert into public.resumes (id, user_id, name, kind, parent_resume_id)
values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Tailored — Acme', 'TAILORED', 'b0000000-0000-4000-8000-000000000001');

select is(
  (select parent_resume_id::text from public.resumes where id = 'b0000000-0000-4000-8000-000000000002'),
  'b0000000-0000-4000-8000-000000000001',
  'a TAILORED resume can descend from the MASTER'
);

-- A resume cannot descend from a non-MASTER resume (trigger-enforced lineage).
select throws_ok(
  $$ insert into public.resumes (user_id, name, kind, parent_resume_id)
     values ('a0000000-0000-4000-8000-000000000001', 'Tailored — Bad Lineage', 'TAILORED', 'b0000000-0000-4000-8000-000000000002') $$,
  null,
  null,
  'a resume cannot descend from a TAILORED (non-MASTER) resume'
);

-- A MASTER resume cannot itself carry a parent.
select throws_ok(
  $$ insert into public.resumes (user_id, name, kind, parent_resume_id)
     values ('a0000000-0000-4000-8000-000000000001', 'Second Master Attempt', 'MASTER', 'b0000000-0000-4000-8000-000000000001') $$,
  null,
  null,
  'a MASTER resume cannot carry a parent_resume_id'
);

-- Cross-user isolation.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s resume rows'
);

-- A cross-user parent_resume_id is structurally impossible (composite FK).
select throws_ok(
  $$ insert into public.resumes (user_id, name, kind, parent_resume_id)
     values ('a0000000-0000-4000-8000-000000000002', 'Cross-user Tailored', 'TAILORED', 'b0000000-0000-4000-8000-000000000001') $$,
  null,
  null,
  'a resume cannot reference another user''s resume as its parent'
);

update public.resumes set name = 'hijacked' where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and name = 'hijacked'),
  0,
  'user B''s update of user A''s resume affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2,
  'user B''s delete of user A''s resumes affects zero rows'
);

-- Rename is an ordinary update.
update public.resumes set name = 'Master Resume (renamed)' where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select name from public.resumes where id = 'b0000000-0000-4000-8000-000000000001'),
  'Master Resume (renamed)',
  'the owner can rename their own resume'
);

-- Deleting the master sets the tailored resume's parent_resume_id to null, not user_id.
delete from public.resumes where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select parent_resume_id from public.resumes where id = 'b0000000-0000-4000-8000-000000000002'),
  null,
  'deleting a MASTER resume nulls its children''s parent_resume_id (column-scoped SET NULL)'
);
select is(
  (select user_id::text from public.resumes where id = 'b0000000-0000-4000-8000-000000000002'),
  'a0000000-0000-4000-8000-000000000001',
  'deleting a MASTER resume never nulls a child row''s user_id'
);

select * from finish();
rollback;
