-- Invariant tests: resume_versions STRUCTURED_V1 (migration 0022, Phase 7C).
-- See supabase/tests/database/README.md for how to run this.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

set local role service_role;
insert into public.resumes (id, user_id, name, kind)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Master Resume', 'MASTER');

-- A STRUCTURED_V1 version with a real object payload succeeds.
select public.create_resume_version(
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'v1',
  'STRUCTURED_V1',
  '{"schemaVersion":1,"header":{"fullName":"Ada"}}'::jsonb
);

select is(
  (select snapshot_format from public.resume_versions
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1),
  'STRUCTURED_V1',
  'a STRUCTURED_V1 version can be created with a real payload'
);
select is(
  (select snapshot_payload->>'schemaVersion' from public.resume_versions
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1),
  '1',
  'the structured payload is stored faithfully'
);

-- A plain METADATA_ONLY version (Phase 7A default) still works unchanged.
select public.create_resume_version(
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'v2 metadata only'
);
select is(
  (select snapshot_format from public.resume_versions
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2),
  'METADATA_ONLY',
  'a METADATA_ONLY version can still be created with no payload arguments (unchanged Phase 7A default)'
);
select is(
  (select snapshot_payload from public.resume_versions
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 2),
  null,
  'the v1 METADATA_ONLY version remains unchanged and payload-free after a later STRUCTURED_V1 version exists'
);

-- STRUCTURED_V1 requires a non-null payload.
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 3, 'bad', 'STRUCTURED_V1', null) $$,
  '23514',
  null,
  'a STRUCTURED_V1 version with a null payload is rejected'
);

-- STRUCTURED_V1 payload must be a JSON object, not e.g. an array.
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 3, 'bad', 'STRUCTURED_V1', '[1,2,3]'::jsonb) $$,
  '23514',
  null,
  'a STRUCTURED_V1 version whose payload is not a JSON object is rejected'
);

-- METADATA_ONLY still cannot carry a payload (unchanged Phase 7A invariant).
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 3, 'bad', 'METADATA_ONLY', '{"x":1}'::jsonb) $$,
  '23514',
  null,
  'a METADATA_ONLY version still cannot carry a snapshot_payload'
);

-- An unrecognized format is still rejected outright.
select throws_ok(
  $$ insert into public.resume_versions (user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload)
     values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 3, 'bad', 'LATEX_V1', '{"x":1}'::jsonb) $$,
  '23514',
  null,
  'an unrecognized snapshot_format (e.g. LATEX_V1, not yet real) is rejected'
);

-- Immutability still holds for a STRUCTURED_V1 row.
set local role postgres;
select throws_ok(
  $$ update public.resume_versions set display_name = 'renamed'
     where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1 $$,
  'resume_versions rows are immutable and cannot be updated (id=' || (
    select id::text from public.resume_versions
    where resume_id = 'b0000000-0000-4000-8000-000000000001' and version_number = 1
  ) || ')',
  'a STRUCTURED_V1 resume_versions row is immutable, same as METADATA_ONLY'
);

select * from finish();
rollback;
