-- RLS + invariant tests: application <-> resume attachment (migration 0021, Phase 7B) —
-- working_resume_version_id, submission_packets.resume_version_id, and the extended
-- mark_application_applied freeze behavior.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'User B Master', 'MASTER');

select public.create_resume_version('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'v1');
select public.create_resume_version('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'v2');
select public.create_resume_version('a0000000-0000-4000-8000-000000000002'::uuid, 'b0000000-0000-4000-8000-000000000002'::uuid, 'user-b-v1');

insert into public.applications (id, user_id, company, title, status)
values ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 'IN_PROGRESS');

-- ------------------------------------------------------------------------------------------------
-- Working résumé selection: cross-user selection is structurally impossible.
-- ------------------------------------------------------------------------------------------------

-- Attempted as service_role (bypasses RLS entirely) rather than `authenticated`: as `authenticated`
-- acting as user A, the subquery selecting user B's resume_versions row is itself blocked by
-- RLS and evaluates to NULL, which would trivially "succeed" (an application with no working
-- résumé) and prove nothing about the FK. Testing under service_role instead proves the real
-- structural guarantee: the composite FK rejects a cross-user id even for a role that could
-- otherwise see and reference it.
set local role service_role;
select throws_ok(
  $$ update public.applications set working_resume_version_id =
     (select id from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000002' limit 1)
     where id = 'c0000000-0000-4000-8000-000000000001' $$,
  '23503',
  null,
  'an application cannot select another user''s resume version as its working résumé'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.applications
  set working_resume_version_id = (
    select id from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1
  )
  where id = 'c0000000-0000-4000-8000-000000000001';

select is(
  (select working_resume_version_id is not null from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  true,
  'the owner can select their own resume version as the working résumé'
);

-- ------------------------------------------------------------------------------------------------
-- First mark-applied freezes the current working version into the packet.
-- ------------------------------------------------------------------------------------------------

set local role service_role;

select public.mark_application_applied(
  p_user_id := 'a0000000-0000-4000-8000-000000000001'::uuid,
  p_application_id := 'c0000000-0000-4000-8000-000000000001'::uuid,
  p_answers_snapshot := '[]'::jsonb,
  p_autofill_summary := null,
  p_unresolved_fields := null,
  p_consistency_findings := '[]'::jsonb,
  p_consistency_acknowledgements := '[]'::jsonb,
  p_job_snapshot_id := null,
  p_resume_id := null,
  p_requirement_mapping_run_id := null,
  p_content_fingerprint := 'v1:test-fingerprint-1',
  p_resume_version_id := (
    select id from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1
  )
);

select is(
  (select rv.version_number from public.submission_packets sp
     join public.resume_versions rv on rv.id = sp.resume_version_id
     where sp.application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the first mark-applied freezes the application''s working résumé version (v1) into the packet'
);

-- ------------------------------------------------------------------------------------------------
-- Changing the working version after submission never alters the frozen packet.
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
update public.applications
  set working_resume_version_id = (
    select id from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2
  )
  where id = 'c0000000-0000-4000-8000-000000000001';

select is(
  (select rv.version_number from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'the working résumé version can freely change after submission'
);
select is(
  (select rv.version_number from public.submission_packets sp
     join public.resume_versions rv on rv.id = sp.resume_version_id
     where sp.application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the already-frozen packet still points at v1 — unaffected by the later working-version change'
);

-- ------------------------------------------------------------------------------------------------
-- Repeat mark-applied (idempotent) never swaps the frozen version, even though working is now v2.
-- ------------------------------------------------------------------------------------------------

set local role service_role;
select public.mark_application_applied(
  p_user_id := 'a0000000-0000-4000-8000-000000000001'::uuid,
  p_application_id := 'c0000000-0000-4000-8000-000000000001'::uuid,
  p_answers_snapshot := '[]'::jsonb,
  p_autofill_summary := null,
  p_unresolved_fields := null,
  p_consistency_findings := '[]'::jsonb,
  p_consistency_acknowledgements := '[]'::jsonb,
  p_job_snapshot_id := null,
  p_resume_id := null,
  p_requirement_mapping_run_id := null,
  p_content_fingerprint := 'v1:test-fingerprint-2-ignored',
  p_resume_version_id := (
    select id from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2
  )
);

select is(
  (select count(*)::int from public.submission_packets where application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'a repeated mark-applied call never creates a second packet'
);
select is(
  (select rv.version_number from public.submission_packets sp
     join public.resume_versions rv on rv.id = sp.resume_version_id
     where sp.application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'a repeated mark-applied call never swaps the frozen résumé version, even when passed a different one'
);

-- ------------------------------------------------------------------------------------------------
-- Revert/restore behavior: a direct service_role status move away from and back to APPLIED
-- (what revertApplicationEvent actually does) never creates a new packet or changes the frozen
-- résumé version — only mark_application_applied ever writes submission_packets.
-- ------------------------------------------------------------------------------------------------

update public.applications set status = 'INTERVIEW' where id = 'c0000000-0000-4000-8000-000000000001';
update public.applications set status = 'APPLIED' where id = 'c0000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.submission_packets where application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'restoring APPLIED directly (the revert path) never creates a second packet'
);
select is(
  (select rv.version_number from public.submission_packets sp
     join public.resume_versions rv on rv.id = sp.resume_version_id
     where sp.application_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'restoring APPLIED directly never changes the frozen résumé version'
);

-- ------------------------------------------------------------------------------------------------
-- A version referenced by a submission packet can never be deleted; a never-submitted one can.
-- ------------------------------------------------------------------------------------------------

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ delete from public.resume_versions
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1 $$,
  '23503',
  null,
  'a resume version referenced by a submission packet cannot be deleted'
);

delete from public.resume_versions
  where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2;
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'a never-submitted resume version can be deleted even after another version of the same resume was submitted'
);

-- Deleting the parent resume is blocked too, transitively, while any version is submitted.
select throws_ok(
  $$ delete from public.resumes where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '23503',
  null,
  'deleting a resume with a submitted version anywhere in its history is blocked'
);

-- ------------------------------------------------------------------------------------------------
-- Legacy compatibility: a packet with no resume_version_id (pre-migration-0021 shape) is still a
-- valid, selectable row — never backfilled or fabricated.
-- ------------------------------------------------------------------------------------------------

set local role service_role;
insert into public.applications (id, user_id, company, title, status, applied_at)
values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'LegacyCo', 'Role', 'APPLIED', now());
insert into public.submission_packets (id, user_id, application_id, answers_snapshot, content_fingerprint)
values ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', '[]'::jsonb, 'v1:legacy');

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select resume_version_id from public.submission_packets where id = 'd0000000-0000-4000-8000-000000000001'),
  null,
  'a legacy packet with no resume_version_id remains valid and null — never backfilled'
);

select * from finish();
rollback;
