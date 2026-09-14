-- RLS + invariant tests: save_reviewed_tailored_resume (migration 0024, Phase 7F) — the one
-- atomic operation that persists a reviewed AI résumé-tailoring draft.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

-- User A: a MASTER resume with one structured version, a job snapshot, and an in-progress
-- application whose working résumé is that master version.
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');
select public.create_resume_version(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'Master v1',
  'STRUCTURED_V1', '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb
);

insert into public.job_snapshots (id, user_id, source_job_id, company, title, content_fingerprint)
values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Acme', 'Engineer', 'fp-1');
insert into public.job_snapshots (id, user_id, source_job_id, company, title, content_fingerprint)
values ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Other Co', 'Role', 'fp-2');

insert into public.applications (id, user_id, company, title, status, job_snapshot_id, working_resume_version_id)
values (
  'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 'IN_PROGRESS',
  'e0000000-0000-4000-8000-000000000001',
  (select id from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001')
);

-- User B: an application, for cross-user tests.
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'User B Master', 'MASTER');
insert into public.applications (id, user_id, company, title, status)
values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Beta', 'Role', 'IN_PROGRESS');

-- ------------------------------------------------------------------------------------------------
-- Direct authenticated calls are rejected — service_role only, same posture as create_resume_version.
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
       'e0000000-0000-4000-8000-000000000001'::uuid,
       null, 'Should Not Work', null, 'v1', '{}'::jsonb
     ) $$,
  '42501',
  null,
  'an authenticated user cannot call save_reviewed_tailored_resume directly'
);

set local role service_role;

-- ------------------------------------------------------------------------------------------------
-- Cross-user rejection: another user's application, another user's target resume.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid,
       null, null, null, 'X', null, 'v1', '{}'::jsonb
     ) $$,
  'application_not_found',
  'user A cannot save against user B''s application'
);

select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
       'e0000000-0000-4000-8000-000000000001'::uuid,
       'b0000000-0000-4000-8000-000000000002'::uuid, null, null, 'v1', '{}'::jsonb
     ) $$,
  'resume_not_found',
  'user A cannot save into user B''s logical resume'
);

-- ------------------------------------------------------------------------------------------------
-- Staleness guards.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001'::uuid,
       null, 'Tailored', 'b0000000-0000-4000-8000-000000000001'::uuid, 'v1', '{}'::jsonb
     ) $$,
  'stale_base_resume',
  'a mismatched expected working résumé version is rejected as stale_base_resume'
);

select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
       'e0000000-0000-4000-8000-000000000002'::uuid,
       null, 'Tailored', 'b0000000-0000-4000-8000-000000000001'::uuid, 'v1', '{}'::jsonb
     ) $$,
  'stale_job_context',
  'a mismatched expected job snapshot is rejected as stale_job_context'
);

-- ------------------------------------------------------------------------------------------------
-- MASTER-base save: creates a new TAILORED resume, v1, correct lineage, working pointer updated,
-- master left completely unchanged.
-- ------------------------------------------------------------------------------------------------

select public.save_reviewed_tailored_resume(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  null, 'A''s Resume -- Acme -- Engineer', 'b0000000-0000-4000-8000-000000000001'::uuid,
  'A''s Resume -- Acme -- Engineer',
  '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb
);

select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'TAILORED'),
  1,
  'a MASTER-base save creates exactly one new TAILORED resume'
);
select is(
  (select r.parent_resume_id from public.resumes r
     join public.applications a on a.working_resume_version_id in (select id from public.resume_versions where resume_id = r.id)
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'the new TAILORED resume''s parent is the MASTER it was tailored from'
);
select is(
  (select rv.version_number from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'the new TAILORED resume''s first version is v1'
);
select is(
  (select count(*)::int from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'the master resume itself gains no new version — still exactly the one it started with'
);

-- ------------------------------------------------------------------------------------------------
-- TAILORED-base save: next version of the SAME logical resume, not a new one.
-- ------------------------------------------------------------------------------------------------

select public.save_reviewed_tailored_resume(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')),
  null, null,
  'A''s Resume -- Acme -- Engineer',
  '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb
);

select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'TAILORED'),
  1,
  'a TAILORED-base save reuses the same logical resume — still exactly one TAILORED resume'
);
select is(
  (select rv.version_number from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'a TAILORED-base save creates version 2 of the same resume'
);

-- ------------------------------------------------------------------------------------------------
-- Submission-history protection: freezing v2 into a packet, then saving again, never touches it.
-- ------------------------------------------------------------------------------------------------

select public.mark_application_applied(
  p_user_id := 'a0000000-0000-4000-8000-000000000001'::uuid,
  p_application_id := 'c0000000-0000-4000-8000-000000000001'::uuid,
  p_answers_snapshot := '[]'::jsonb,
  p_autofill_summary := null,
  p_unresolved_fields := null,
  p_consistency_findings := '[]'::jsonb,
  p_consistency_acknowledgements := '[]'::jsonb,
  p_job_snapshot_id := 'e0000000-0000-4000-8000-000000000001'::uuid,
  p_resume_id := null,
  p_requirement_mapping_run_id := null,
  p_content_fingerprint := 'v1:test',
  p_resume_version_id := (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')
);

select public.save_reviewed_tailored_resume(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')),
  null, null,
  'A''s Resume -- Acme -- Engineer',
  '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb
);

select is(
  (select rv.version_number from public.submission_packets sp
     join public.resume_versions rv on rv.id = sp.resume_version_id
     where sp.application_id = 'c0000000-0000-4000-8000-000000000001'),
  2,
  'the submitted packet still points at the v2 that was actually submitted'
);
select is(
  (select rv.version_number from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  3,
  'saving again after submission advances the WORKING pointer to v3 without touching the packet'
);

-- ------------------------------------------------------------------------------------------------
-- Concurrency: a second save still carrying the now-stale (pre-v3) expected base is rejected —
-- it must never silently create v4 from a stale review (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §50).
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  $$ select public.save_reviewed_tailored_resume(
       'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
       (select id from public.resume_versions
          where resume_id = (select id from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'TAILORED')
          and version_number = 2),
       'e0000000-0000-4000-8000-000000000001'::uuid,
       (select id from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'TAILORED'),
       null, null, 'stale attempt', '{}'::jsonb
     ) $$,
  'stale_base_resume',
  'a second save still targeting the now-superseded v2 base is rejected, never creating a v4'
);
select is(
  (select max(version_number) from public.resume_versions
     where resume_id = (select id from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001' and kind = 'TAILORED')),
  3,
  'the stale second attempt left version numbering at 3 — no v4 was created'
);

-- ------------------------------------------------------------------------------------------------
-- Cross-user isolation: user B never sees user A's new tailored resume or its versions.
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.resumes where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see any of user A''s resumes, including the newly-created tailored one'
);

select * from finish();
rollback;
