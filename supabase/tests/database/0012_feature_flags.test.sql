-- RLS test: feature_flags
--
-- Different shape from the other files: feature_flags is not user-owned
-- (docs/DATA_MODEL.md). It should be readable by any authenticated (and anon) session, but
-- never writable by a regular authenticated user — only migrations / the service-role key
-- change it. See supabase/tests/database/README.md for how to run this.
--
-- Note on expected behavior: with RLS enabled and no policy for a given command, INSERT
-- fails outright (there's no way to "match zero rows" for a row that doesn't exist yet), but
-- UPDATE/DELETE simply match zero rows and succeed as a no-op — that's why the assertions
-- below differ by command.

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select ok(
  (select count(*)::int from public.feature_flags where key = 'public_signups_enabled') = 1,
  'an authenticated user can read the seeded public_signups_enabled flag'
);

select throws_ok(
  $$ insert into public.feature_flags (key, enabled) values ('malicious_flag', true) $$,
  42501,
  null,
  'an authenticated user cannot insert a new feature flag (no insert policy exists)'
);

update public.feature_flags set enabled = true where key = 'public_signups_enabled';
select is(
  (select enabled from public.feature_flags where key = 'public_signups_enabled'),
  false,
  'an authenticated user cannot flip public_signups_enabled — update matches zero rows (no update policy exists)'
);

delete from public.feature_flags where key = 'public_signups_enabled';
select is(
  (select count(*)::int from public.feature_flags where key = 'public_signups_enabled'),
  1,
  'an authenticated user cannot delete a feature flag — delete matches zero rows (no delete policy exists)'
);

select * from finish();
rollback;
