-- RLS isolation test: experiences
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

insert into public.experiences (user_id, company, title)
values ('a0000000-0000-4000-8000-000000000001', 'Acme', 'Engineer');

select is(
  (select count(*)::int from public.experiences where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own experience row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.experiences where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s experience row'
);

update public.experiences set company = 'Hijacked' where user_id = 'a0000000-0000-4000-8000-000000000001';

-- Verify as user A: user B's own select of A's row is blocked either way, so re-checking as B
-- would prove nothing about whether the write itself was blocked.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.experiences
    where user_id = 'a0000000-0000-4000-8000-000000000001' and company = 'Hijacked'),
  0,
  'user B''s update of user A''s experience affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.experiences where user_id = 'a0000000-0000-4000-8000-000000000001';

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.experiences where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s experience affects zero rows'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.experiences (user_id, company, title)
values ('a0000000-0000-4000-8000-000000000002', 'Globex', 'Engineer');
select is(
  (select count(*)::int from public.experiences where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own experience row'
);

select * from finish();
rollback;
