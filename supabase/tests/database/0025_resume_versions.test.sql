-- RLS + invariant tests: resume_versions (migration 0020, Phase 7A) — immutable snapshots,
-- created only via the service-role-only create_resume_version RPC.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');

-- create_resume_version is service_role-only, called via the admin client from a server action
-- in real usage — a direct `authenticated` call is rejected by the function grant itself.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.create_resume_version('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'v1') $$,
  '42501',
  null,
  'an authenticated user cannot call create_resume_version directly'
);

set local role service_role;
select public.create_resume_version('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'v1');
select public.create_resume_version('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'v2');

select is(
  (select array_agg(version_number order by version_number) from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  array[1, 2],
  'sequential calls to create_resume_version produce 1, then 2 — never client-supplied'
);

-- Safe numbering's second, independent guarantee: a raw duplicate-number insert is rejected even
-- bypassing the RPC entirely.
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 'duplicate') $$,
  '23505',
  null,
  'a duplicate (resume_id, version_number) pair is rejected'
);

-- METADATA_ONLY rows may never carry a payload.
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name, snapshot_payload)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 3, 'v3', '{"x":1}'::jsonb) $$,
  '23514',
  null,
  'a METADATA_ONLY version cannot carry a snapshot_payload'
);

-- select own, as the real authenticated owner.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  2,
  'the owner can select their own resume_versions rows'
);

-- Immutability — tested as a role that bypasses RLS entirely (same posture as job_snapshots'
-- own immutability test, 0017_job_snapshots_and_requirement_evidence.test.sql): under
-- `authenticated`, there is no UPDATE policy on resume_versions at all, so RLS silently matches
-- zero rows before the trigger ever fires — that's real protection too, but proves RLS blocks it,
-- not that the row itself is immutable. `set local role postgres` bypasses RLS so the UPDATE
-- actually reaches the row and the block-update trigger gets to raise its own exception.
set local role postgres;
select throws_ok(
  $$ update public.resume_versions set display_name = 'renamed' where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1 $$,
  'resume_versions rows are immutable and cannot be updated (id=' || (
    select id::text from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1
  ) || ')',
  'a resume_versions row is immutable even for a role that bypasses RLS entirely'
);
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Cross-user isolation.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s resume_versions rows'
);

-- User B's delete targeting user A's row is not an error — RLS filters it to zero rows, same
-- posture as every other table's delete policy in this codebase.
delete from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2;

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  2,
  'user B''s delete attempt affects zero of user A''s rows'
);

-- Deletion IS allowed for the owner when the version was never submitted (see migration 0021's
-- test file for the "cannot delete a submitted version" case, which needs a submission_packets
-- row to exist).
delete from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2;
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'the owner can delete their own never-submitted resume_versions row'
);

-- Deleting the parent resume cascades to its (remaining, never-submitted) versions.
delete from public.resumes where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'deleting the parent resume cascades to its remaining never-submitted versions'
);

select * from finish();
rollback;
