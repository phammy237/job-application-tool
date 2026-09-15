-- RLS + invariant tests: resume_versions.company_research_snapshot_id (migration 0028, Phase 7H)
-- — the immutable link from a saved tailored résumé version to the company-research snapshot (if
-- any) that informed it, and save_reviewed_tailored_resume's new optional parameter for it.
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;

-- User A: a MASTER resume with one structured version, a job snapshot, and an in-progress
-- application whose working résumé is that master version — same fixture shape as
-- 0029_resume_tailoring_save.test.sql.
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');
select public.create_resume_version(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'Master v1',
  'STRUCTURED_V1', '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb
);

insert into public.job_snapshots (id, user_id, source_job_id, company, title, content_fingerprint)
values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'Acme', 'Engineer', 'fp-1');

insert into public.applications (id, user_id, company, title, status, job_snapshot_id, working_resume_version_id)
values (
  'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Engineer', 'IN_PROGRESS',
  'e0000000-0000-4000-8000-000000000001',
  (select id from public.resume_versions where resume_id = 'b0000000-0000-4000-8000-000000000001')
);

-- User A: two company-research snapshots — one will be referenced by a saved version (and so
-- becomes undeletable), the other stays unreferenced (and so stays deletable).
select public.create_company_research_snapshot(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  'Acme', 'Engineer', 'e0000000-0000-4000-8000-000000000001'::uuid,
  '[{"id":"d0000000-0000-4000-8000-000000000001","url":"https://acme.com","title":"Acme","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
  '[{"id":"f0000000-0000-4000-8000-000000000001","category":"PRODUCT","claim":"Acme is expanding its platform team","sourceIds":["d0000000-0000-4000-8000-000000000001"]}]'::jsonb
);
select public.create_company_research_snapshot(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  'Acme', 'Engineer', 'e0000000-0000-4000-8000-000000000001'::uuid,
  '[{"id":"d0000000-0000-4000-8000-000000000002","url":"https://acme.com/2","title":"Acme 2","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
  '[{"id":"f0000000-0000-4000-8000-000000000002","category":"PRODUCT","claim":"Acme launched a new product","sourceIds":["d0000000-0000-4000-8000-000000000002"]}]'::jsonb
);

create temp table snaps as
  select id, row_number() over (order by created_at asc) as rn
  from public.company_research_snapshots
  where company_name = 'Acme';
grant select on snaps to service_role, authenticated;

-- User B: their own application and their own company-research snapshot, for cross-user rejection.
insert into public.applications (id, user_id, company, title, status)
values ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Beta', 'Role', 'IN_PROGRESS');
select public.create_company_research_snapshot(
  'a0000000-0000-4000-8000-000000000002'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid,
  'Beta', 'Role', null,
  '[{"id":"d0000000-0000-4000-8000-000000000003","url":"https://beta.com","title":"Beta","sourceType":"OFFICIAL_WEBSITE"}]'::jsonb,
  '[{"id":"f0000000-0000-4000-8000-000000000003","category":"PRODUCT","claim":"Beta claim","sourceIds":["d0000000-0000-4000-8000-000000000003"]}]'::jsonb
);
create temp table snap_b as
  select id from public.company_research_snapshots where company_name = 'Beta';
grant select on snap_b to service_role;

-- ------------------------------------------------------------------------------------------------
-- Backward compatibility: omitting the new parameter still works and leaves the column null.
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
  (select rv.company_research_snapshot_id from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  null::uuid,
  'omitting p_company_research_snapshot_id leaves the column null (unchanged pre-7H behavior)'
);

-- ------------------------------------------------------------------------------------------------
-- Cross-user rejection: user A cannot reference user B's snapshot.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  format(
    $$ select public.save_reviewed_tailored_resume(
         'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
         (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
         'e0000000-0000-4000-8000-000000000001'::uuid,
         (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')),
         null, null, 'v-bad', '{}'::jsonb, %L
       ) $$,
    (select id from snap_b)
  ),
  'company_research_snapshot_not_found',
  'user A cannot reference user B''s company-research snapshot'
);

-- ------------------------------------------------------------------------------------------------
-- Happy path: an explicit, owned snapshot id is recorded on the new version.
-- ------------------------------------------------------------------------------------------------

select public.save_reviewed_tailored_resume(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')),
  null, null, 'A''s Resume -- Acme -- Engineer',
  '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb,
  (select id from snaps where rn = 1)
);

select is(
  (select rv.company_research_snapshot_id from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  (select id from snaps where rn = 1),
  'an explicit owned snapshot id is recorded on the newly-saved version'
);

-- ------------------------------------------------------------------------------------------------
-- R1 remains valid even after R2-equivalent snapshots exist — snapshot identity, not latestness
-- (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §9). Saving again with the SAME snapshot id (snap 1)
-- while a newer snapshot (snap 2) already exists must not be rejected or silently repointed.
-- ------------------------------------------------------------------------------------------------

select public.save_reviewed_tailored_resume(
  'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
  (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001')),
  null, null, 'A''s Resume -- Acme -- Engineer',
  '{"schemaVersion":1,"header":{"fullName":"A","email":null,"phone":null,"location":null,"links":{}},"education":[],"experience":[],"projects":[],"leadership":[],"skills":[],"renderOverride":null}'::jsonb,
  (select id from snaps where rn = 1)
);

select is(
  (select rv.company_research_snapshot_id from public.resume_versions rv
     join public.applications a on a.working_resume_version_id = rv.id
     where a.id = 'c0000000-0000-4000-8000-000000000001'),
  (select id from snaps where rn = 1),
  'a later save can still reference the same (now not-latest) snapshot — identity, not latestness'
);
select is(
  (select rv.company_research_snapshot_id from public.resume_versions rv
     where rv.resume_id = (select resume_id from public.resume_versions where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'))
       and rv.version_number = 2),
  (select id from snaps where rn = 1),
  'the earlier version (v2) still carries its own original snapshot reference, untouched'
);

-- ------------------------------------------------------------------------------------------------
-- Immutability: resume_versions remains fully immutable — a direct UPDATE attempt against the new
-- column is rejected by the pre-existing blanket immutability trigger (migration 0020), the same
-- as every other column on this table.
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  format(
    $$ update public.resume_versions set company_research_snapshot_id = %L
         where id = (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001') $$,
    (select id from snaps where rn = 2)
  ),
  'resume_versions rows are immutable and cannot be updated (id=' || (
    select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'
  ) || ')',
  'a direct UPDATE of company_research_snapshot_id is rejected — resume_versions stays fully immutable'
);

-- ------------------------------------------------------------------------------------------------
-- FK RESTRICT: once a resume_version references a snapshot, that snapshot cannot be deleted —
-- a deliberate narrowing of Phase 7G's "owner can always delete their own snapshot" semantics
-- (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §43, this migration's own doc comment).
-- ------------------------------------------------------------------------------------------------

select throws_ok(
  format(
    $$ delete from public.company_research_snapshots where id = %L $$,
    (select id from snaps where rn = 1)
  ),
  '23503',
  null,
  'deleting a company-research snapshot referenced by a saved résumé version is blocked (FK RESTRICT)'
);

-- The UNREFERENCED snapshot (snap 2) can still be deleted — Phase 7G's ordinary delete semantics
-- are unchanged for a snapshot nothing has ever saved a résumé version against.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.company_research_snapshots where id = (select id from snaps where rn = 2);

select is(
  (select count(*)::int from public.company_research_snapshots where id = (select id from snaps where rn = 2)),
  0,
  'an unreferenced snapshot can still be deleted by its owner, exactly as in Phase 7G'
);
select is(
  (select count(*)::int from public.company_research_snapshots where id = (select id from snaps where rn = 1)),
  1,
  'the referenced snapshot is still there — the blocked delete above did not partially apply'
);

set local role service_role;

-- ------------------------------------------------------------------------------------------------
-- Cross-user isolation on the new column: user B cannot see any of user A's resume_versions rows
-- (ordinary table-level RLS, unaffected by adding a nullable column).
-- ------------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.resume_versions where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see any of user A''s resume_versions rows, including the new provenance column'
);

-- Direct authenticated calls to the RPC (with the new param) are still rejected — service_role
-- only, unchanged posture from before this migration.
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format(
    $$ select public.save_reviewed_tailored_resume(
         'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid,
         (select working_resume_version_id from public.applications where id = 'c0000000-0000-4000-8000-000000000001'),
         'e0000000-0000-4000-8000-000000000001'::uuid,
         null, 'Should Not Work', null, 'v1', '{}'::jsonb, %L
       ) $$,
    (select id from snaps where rn = 1)
  ),
  '42501',
  null,
  'an authenticated user still cannot call save_reviewed_tailored_resume directly, even with the new param'
);

select * from finish();
rollback;
