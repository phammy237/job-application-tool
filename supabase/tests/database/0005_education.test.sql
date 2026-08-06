-- RLS isolation test: education
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

insert into public.education (user_id, school)
values ('a0000000-0000-4000-8000-000000000001', 'University of Florida');

select is(
  (select count(*)::int from public.education where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can insert and select their own education row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.education where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s education row'
);

update public.education set school = 'Hijacked' where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.education
    where user_id = 'a0000000-0000-4000-8000-000000000001' and school = 'Hijacked'),
  0,
  'user B''s update of user A''s education affects zero rows'
);

delete from public.education where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.education where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user B''s delete of user A''s education affects zero rows'
);

insert into public.education (user_id, school)
values ('a0000000-0000-4000-8000-000000000002', 'Some Other School');
select is(
  (select count(*)::int from public.education where user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'user B can insert and select their own education row'
);

select * from finish();
rollback;
