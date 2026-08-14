-- RLS isolation, grant-authorization, ownership, immutability, and constraint tests for
-- migration 0010 (job_snapshots, requirement_mapping_runs, requirement_evidence_mappings, and
-- the upsert_application_from_extension grant fix). See supabase/tests/database/README.md for
-- how to run this. End-to-end RPC orchestration (snapshot capture/reuse/versioning, the
-- APPLIED-freeze behavior, and atomic promotion) is covered separately by a live-database
-- scenario script, not here — this file is everything expressible as a direct SQL assertion.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'user-a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'user-b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x', now(), now(), now());

-- Seed jobs and job_snapshots as postgres (bypasses RLS — job_snapshots has no insert policy at
-- all by design, so there is no user-facing way to seed it directly).
set local role postgres;

insert into public.jobs (id, user_id, company, title)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Globex', 'Frontend Engineer');

insert into public.job_snapshots
  (id, user_id, source_job_id, company, title, content_fingerprint)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Acme', 'Backend Engineer', 'v1:aaa'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Globex', 'Frontend Engineer', 'v1:bbb');

-- ============================================================================================
-- job_snapshots: RLS (select-only), immutability, ownership
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.job_snapshots where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own job_snapshots row'
);

select is(
  (select count(*)::int from public.job_snapshots where user_id = 'a0000000-0000-4000-8000-000000000002'),
  0,
  'user A cannot see user B''s job_snapshots row'
);

select throws_ok(
  $$insert into public.job_snapshots (user_id, source_job_id, company, title, content_fingerprint)
    values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'X', 'Y', 'v1:ccc')$$,
  'new row violates row-level security policy for table "job_snapshots"',
  'authenticated cannot insert into job_snapshots directly (no insert policy — writes only via the server-only RPC)'
);

set local role postgres;

select throws_ok(
  $$update public.job_snapshots set company = 'Changed' where id = 'c0000000-0000-4000-8000-000000000001'$$,
  'job_snapshots rows are immutable and cannot be updated (id=c0000000-0000-4000-8000-000000000001)',
  'job_snapshots rows are immutable even for a role that bypasses RLS entirely'
);

select throws_ok(
  format(
    $$insert into public.applications (user_id, job_id, company, title, status, job_snapshot_id)
      values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'X', 'Y', 'SAVED', %L)$$,
    'c0000000-0000-4000-8000-000000000002'
  ),
  'insert or update on table "applications" violates foreign key constraint "applications_job_snapshot_id_fkey"',
  'an application cannot point at a job_snapshot owned by a different user (composite FK, checked directly via raw SQL)'
);

-- ============================================================================================
-- requirement_mapping_runs: RLS, ownership FK, status/timestamp CHECK, partial unique index
-- ============================================================================================

insert into public.requirement_mapping_runs
  (id, user_id, job_snapshot_id, status, provider, model, prompt_version, completed_at)
values (
  'd0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001', 'CURRENT', 'anthropic', 'claude-sonnet-5',
  'requirement-evidence-v1', now()
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.requirement_mapping_runs where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own requirement_mapping_runs row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.requirement_mapping_runs where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s requirement_mapping_runs row'
);

select throws_ok(
  $$insert into public.requirement_mapping_runs (user_id, job_snapshot_id, status, provider, model, prompt_version)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'PENDING', 'anthropic', 'claude-sonnet-5', 'v1')$$,
  'new row violates row-level security policy for table "requirement_mapping_runs"',
  'authenticated cannot insert into requirement_mapping_runs directly'
);

set local role postgres;

select throws_ok(
  format(
    $$insert into public.requirement_mapping_runs (user_id, job_snapshot_id, status, provider, model, prompt_version)
      values ('a0000000-0000-4000-8000-000000000001', %L, 'PENDING', 'anthropic', 'claude-sonnet-5', 'v1')$$,
    'c0000000-0000-4000-8000-000000000002'
  ),
  'insert or update on table "requirement_mapping_runs" violates foreign key constraint "requirement_mapping_runs_job_snapshot_id_fkey"',
  'a run cannot point at a job_snapshot owned by a different user (composite FK)'
);

select throws_ok(
  $$insert into public.requirement_mapping_runs (user_id, job_snapshot_id, status, provider, model, prompt_version, completed_at)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'PENDING', 'anthropic', 'claude-sonnet-5', 'v1', now())$$,
  'new row for relation "requirement_mapping_runs" violates check constraint "requirement_mapping_runs_status_timestamps"',
  'PENDING with completed_at set is rejected by the status/timestamp CHECK constraint'
);

select throws_ok(
  $$insert into public.requirement_mapping_runs (user_id, job_snapshot_id, status, provider, model, prompt_version, failed_at)
    values ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'CURRENT', 'anthropic', 'claude-sonnet-5', 'v1', now())$$,
  'new row for relation "requirement_mapping_runs" violates check constraint "requirement_mapping_runs_status_timestamps"',
  'CURRENT with failed_at set is rejected by the status/timestamp CHECK constraint'
);

select throws_ok(
  format(
    $$insert into public.requirement_mapping_runs (user_id, job_snapshot_id, status, provider, model, prompt_version, completed_at)
      values ('a0000000-0000-4000-8000-000000000001', %L, 'CURRENT', 'anthropic', 'claude-sonnet-5', 'v1', now())$$,
    'c0000000-0000-4000-8000-000000000001'
  ),
  'duplicate key value violates unique constraint "requirement_mapping_runs_one_current_per_snapshot"',
  'a snapshot cannot have two CURRENT runs at once (partial unique index)'
);

-- ============================================================================================
-- requirement_evidence_mappings: RLS, ownership FK, MISSING/INFERRED CHECKs, immutability, dedup
-- ============================================================================================

insert into public.requirement_evidence_mappings
  (id, user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
values (
  'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001', '5+ years backend experience', 'fp-1', 'REQUIRED', 'MISSING',
  '[]'::jsonb, 'No matching approved fact.', 0.5, true
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.requirement_evidence_mappings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'user A can select their own requirement_evidence_mappings row'
);

set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.requirement_evidence_mappings where user_id = 'a0000000-0000-4000-8000-000000000001'),
  0,
  'user B cannot see user A''s requirement_evidence_mappings row'
);

select throws_ok(
  $$insert into public.requirement_evidence_mappings
      (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
    values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'x', 'fp-x', 'REQUIRED', 'MISSING', '[]'::jsonb, 'e', 0.5, true)$$,
  'new row violates row-level security policy for table "requirement_evidence_mappings"',
  'authenticated cannot insert into requirement_evidence_mappings directly'
);

set local role postgres;

select throws_ok(
  $$insert into public.requirement_evidence_mappings
      (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
    values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'MISSING with facts', 'fp-2', 'REQUIRED', 'MISSING', '[{"factId":"11111111-1111-4111-8111-111111111111","sourceTable":"skills","factUpdatedAt":"2026-01-01T00:00:00Z"}]'::jsonb, 'e', 0.5, true)$$,
  'new row for relation "requirement_evidence_mappings" violates check constraint "requirement_evidence_mappings_missing_has_no_facts"',
  'MISSING with a non-empty matched_facts is rejected'
);

select throws_ok(
  $$insert into public.requirement_evidence_mappings
      (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
    values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'DIRECT with no facts', 'fp-3', 'REQUIRED', 'DIRECT', '[]'::jsonb, 'e', 0.5, true)$$,
  'new row for relation "requirement_evidence_mappings" violates check constraint "requirement_evidence_mappings_missing_has_no_facts"',
  'a non-MISSING relationship with an empty matched_facts is rejected'
);

select throws_ok(
  $$insert into public.requirement_evidence_mappings
      (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
    values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'INFERRED unconfirmed', 'fp-4', 'REQUIRED', 'INFERRED', '[{"factId":"11111111-1111-4111-8111-111111111111","sourceTable":"skills","factUpdatedAt":"2026-01-01T00:00:00Z"}]'::jsonb, 'e', 0.5, false)$$,
  'new row for relation "requirement_evidence_mappings" violates check constraint "requirement_evidence_mappings_inferred_requires_confirmation"',
  'INFERRED with requires_user_confirmation=false is rejected'
);

select throws_ok(
  $$insert into public.requirement_evidence_mappings
      (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
    values ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'dup', 'fp-1', 'REQUIRED', 'MISSING', '[]'::jsonb, 'e', 0.5, true)$$,
  'duplicate key value violates unique constraint "requirement_evidence_mappings_run_fingerprint_key"',
  'a duplicate requirement_fingerprint within the same run is rejected'
);

select throws_ok(
  format(
    $$insert into public.requirement_evidence_mappings
        (user_id, run_id, requirement_text, requirement_fingerprint, required_or_preferred, relationship, matched_facts, explanation, confidence, requires_user_confirmation)
      values ('a0000000-0000-4000-8000-000000000001', %L, 'x', 'fp-cross', 'REQUIRED', 'MISSING', '[]'::jsonb, 'e', 0.5, true)$$,
    'd0000000-0000-4000-8000-000000000002'
  ),
  'insert or update on table "requirement_evidence_mappings" violates foreign key constraint "requirement_evidence_mappings_run_id_fkey"',
  'a mapping cannot point at a run owned by a different user (composite FK) — run d...002 does not exist, proving the FK is enforced regardless'
);

select throws_ok(
  $$update public.requirement_evidence_mappings set confidence = 0.1 where id = 'e0000000-0000-4000-8000-000000000001'$$,
  'requirement_evidence_mappings rows are immutable and cannot be updated (id=e0000000-0000-4000-8000-000000000001)',
  'requirement_evidence_mappings rows are immutable even for a role that bypasses RLS entirely'
);

-- ============================================================================================
-- Grants: the Phase 4 vulnerability fix, and every new Phase 5A function, are unreachable by
-- authenticated/anon — server-only (migration 0010 §1 and round-4 addendum §1/§2).
-- ============================================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select * from public.upsert_application_from_extension(
      'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'X', 'Y', null,
      'SAVED', null, null, null, null, '{}'::jsonb, '[]'::jsonb)$$,
  'permission denied for function upsert_application_from_extension',
  'authenticated cannot call upsert_application_from_extension directly — the Phase 4 confused-deputy fix'
);

select throws_ok(
  $$select public.create_pending_requirement_mapping_run(
      'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'anthropic', 'claude-sonnet-5', 'v1', 0)$$,
  'permission denied for function create_pending_requirement_mapping_run',
  'authenticated cannot call create_pending_requirement_mapping_run directly'
);

select throws_ok(
  $$select public.mark_requirement_mapping_run_failed(
      'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'provider_error')$$,
  'permission denied for function mark_requirement_mapping_run_failed',
  'authenticated cannot call mark_requirement_mapping_run_failed directly'
);

select throws_ok(
  $$select * from public.promote_requirement_mapping_run(
      'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '[]'::jsonb)$$,
  'permission denied for function promote_requirement_mapping_run',
  'authenticated cannot call promote_requirement_mapping_run directly'
);

select throws_ok(
  $$select public._upsert_job_snapshot(
      'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'X', 'Y', null, null, null, null,
      null, '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], null, null, null, '{}'::text[], null, null, null,
      null, 'v1:xyz', false, '{}'::text[])$$,
  'permission denied for function _upsert_job_snapshot',
  'authenticated cannot call the internal _upsert_job_snapshot helper directly'
);

select throws_ok(
  $$select * from public._approved_fact_versions('a0000000-0000-4000-8000-000000000001')$$,
  'permission denied for function _approved_fact_versions',
  'authenticated cannot call the internal _approved_fact_versions helper directly'
);

set local role anon;

select throws_ok(
  $$select * from public.upsert_application_from_extension(
      'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'X', 'Y', null,
      'SAVED', null, null, null, null, '{}'::jsonb, '[]'::jsonb)$$,
  'permission denied for function upsert_application_from_extension',
  'anon cannot call upsert_application_from_extension either'
);

select throws_ok(
  $$select * from public.promote_requirement_mapping_run(
      'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '[]'::jsonb)$$,
  'permission denied for function promote_requirement_mapping_run',
  'anon cannot call promote_requirement_mapping_run either'
);

select * from finish();
rollback;
