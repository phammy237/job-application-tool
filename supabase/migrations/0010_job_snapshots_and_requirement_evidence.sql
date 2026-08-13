-- Career OS — Phase 5A: job snapshots + requirement-evidence mapping, plus a mandatory
-- Phase 4 security fix that must land before any Phase 5A code goes live.
--
-- This migration does NOT touch 0001-0009. upsert_application_from_extension keeps its exact
-- signature and body from 0009 — only its grants change (see Part 1). Every new object below is
-- additive: new tables, new columns, new functions with new names.

-- ================================================================================================
-- PART 1 — Phase 4 security fix: close the upsert_application_from_extension confused-deputy gap
--
-- upsert_application_from_extension is `security invoker`, trusts p_user_id as a plain parameter,
-- and re-verifies only "does p_job_id belong to p_user_id" — never "is the caller actually
-- p_user_id." Granted to `authenticated` (0009), an authenticated user could call it directly via
-- supabase.rpc(...) with p_user_id set to any OTHER user whose job_id they can guess/learn, and
-- the ownership check would pass (it really is that victim's job), letting the caller create or
-- mutate an application as that victim.
--
-- Repository-wide audit (grep for "upsert_application_from_extension" / "upsertApplicationFromExtension"
-- across the whole tree) found exactly one real call path: apps/web/app/api/applications/route.ts's
-- POST handler, which derives userId from getUserIdFromExtensionToken(request) (a verified
-- extension_sessions lookup by hashed bearer token — never a client-supplied field) and calls this
-- RPC through createAdminClient() (service_role). No browser code, no extension code (the
-- extension has no @supabase/supabase-js dependency at all and only ever does an authenticated
-- HTTP fetch to /api/applications), and no test fixture calls it as `authenticated`. There is no
-- legitimate authenticated direct caller to preserve.
-- ================================================================================================

revoke all on function public.upsert_application_from_extension from public;
revoke all on function public.upsert_application_from_extension from anon;
revoke all on function public.upsert_application_from_extension from authenticated;
grant execute on function public.upsert_application_from_extension to service_role;

-- ================================================================================================
-- PART 2 — job_snapshots
--
-- Immutable, append-only, versioned (a new row per distinct content_fingerprint, never an
-- in-place edit). Outlives the `jobs` row it was captured from — source_job_id is deliberately a
-- plain, non-FK column (see the trigger note below for why an active FK is incompatible with
-- immutability), NOT NULL because every real capture path already starts from a verified,
-- existing jobs row.
-- ================================================================================================

create table public.job_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_job_id uuid not null,
  company text not null,
  title text not null,
  location text,
  employment_type text,
  source_url text,
  external_id text,
  description text,
  required_qualifications text[] not null default '{}',
  preferred_qualifications text[] not null default '{}',
  responsibilities text[] not null default '{}',
  skills text[] not null default '{}',
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  locations text[] not null default '{}',
  work_mode text check (work_mode in ('REMOTE', 'HYBRID', 'ONSITE')),
  remote_location_restrictions text,
  work_authorization_language text,
  source_type text check (source_type in ('GENERIC', 'GREENHOUSE', 'LEVER', 'WORKDAY')),
  content_fingerprint text not null,
  content_truncated boolean not null default false,
  truncated_fields text[] not null default '{}',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint job_snapshots_company_not_blank check (length(trim(company)) > 0),
  constraint job_snapshots_title_not_blank check (length(trim(title)) > 0),
  constraint job_snapshots_salary_min_nonnegative check (salary_min is null or salary_min >= 0),
  constraint job_snapshots_salary_max_nonnegative check (salary_max is null or salary_max >= 0),
  constraint job_snapshots_salary_range check (
    salary_min is null or salary_max is null or salary_min <= salary_max
  ),

  -- Required for the composite FKs in Part 4/5 (a multi-tenant FK must reference a unique
  -- (user_id, id) pair, not just id alone).
  constraint job_snapshots_user_id_id_key unique (user_id, id)
);

create unique index job_snapshots_user_job_fingerprint_key
  on public.job_snapshots (user_id, source_job_id, content_fingerprint);
create index job_snapshots_user_id_idx on public.job_snapshots (user_id);
create index job_snapshots_source_job_id_idx on public.job_snapshots (source_job_id);

-- Immutability, enforced at the database level against every writer (normal authenticated
-- clients, service-role application code, and any accidental future query) — not just "no
-- updated_at column." A blanket BEFORE UPDATE trigger fires regardless of RLS bypass, since
-- triggers are a separate enforcement layer from RLS. DELETE is intentionally NOT blocked the
-- same way: blocking it would also break the legitimate auth.users -> job_snapshots cascade on
-- account deletion (a real DELETE statement issued internally by FK enforcement). The actual
-- delete guarantee is: no RLS delete policy for `authenticated` (below), and no Phase 5A code
-- path issues a direct delete — the only delete that ever happens is the account-deletion
-- cascade, which runs via service-role and is unaffected by the RLS restriction.
create function public.reject_immutable_row_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable and cannot be updated (id=%)', TG_TABLE_NAME, old.id;
end;
$$;

create trigger job_snapshots_block_update
  before update on public.job_snapshots
  for each row execute function public.reject_immutable_row_mutation();

alter table public.job_snapshots enable row level security;

-- Deliberate deviation from this repo's usual four-policy pattern (see DATA_MODEL.md's RLS
-- policy pattern section): select-only for `authenticated`. There is intentionally no insert
-- policy — an authenticated insert policy would let a user POST directly to
-- /rest/v1/job_snapshots via PostgREST, bypassing sanitization, fingerprinting, and the
-- immutable-capture rules entirely. All writes happen exclusively through
-- upsert_application_with_snapshot (Part 6), which is service_role-only (Part 1's pattern) and
-- bypasses RLS as a role property, so it needs no RLS grant to function.
create policy "select own job_snapshots" on public.job_snapshots
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 3 — applications.job_snapshot_id
-- ================================================================================================

alter table public.applications add column job_snapshot_id uuid;

-- Composite FK so a cross-owner link (application owned by A pointing at a snapshot owned by B)
-- is structurally impossible, not just checked in application/RPC code. Postgres 15+'s
-- column-scoped ON DELETE SET NULL (job_snapshot_id) nulls only that column — a plain composite
-- SET NULL would null every column in the FK, including user_id, which must never happen.
-- Confirmed via `supabase projects list` before writing this: the linked project runs Postgres
-- 17.6, well past the 15+ requirement.
alter table public.applications
  add constraint applications_job_snapshot_id_fkey
  foreign key (user_id, job_snapshot_id)
  references public.job_snapshots (user_id, id)
  on delete set null (job_snapshot_id);

create index applications_job_snapshot_id_idx on public.applications (job_snapshot_id);

-- ================================================================================================
-- PART 4 — requirement_mapping_runs
--
-- One row per generation attempt. Exactly one CURRENT run per snapshot is enforced by a partial
-- unique index, not application logic. Unlike job_snapshots, this table has a genuine, bounded,
-- RPC-mediated mutation lifecycle (PENDING -> CURRENT/FAILED, CURRENT -> SUPERSEDED) — no blanket
-- update-blocking trigger here, only the RLS restriction (below).
-- ================================================================================================

create table public.requirement_mapping_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_snapshot_id uuid not null,
  status text not null check (status in ('PENDING', 'CURRENT', 'SUPERSEDED', 'FAILED')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  retrieval_fact_count int not null default 0,
  failure_category text check (failure_category in (
    'provider_error', 'validation_failed', 'refusal', 'rate_limited'
  )),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,

  -- Rules out every nonsensical status/timestamp combination the round-4 review flagged
  -- (PENDING+completed_at, CURRENT+failed_at, FAILED+completed_at, SUPERSEDED without
  -- completed_at) at the database level, not just by convention.
  constraint requirement_mapping_runs_status_timestamps check (
    (status = 'PENDING'    and completed_at is null     and failed_at is null) or
    (status = 'CURRENT'    and completed_at is not null and failed_at is null) or
    (status = 'SUPERSEDED' and completed_at is not null and failed_at is null) or
    (status = 'FAILED'     and completed_at is null     and failed_at is not null)
  ),

  constraint requirement_mapping_runs_user_id_id_key unique (user_id, id),
  constraint requirement_mapping_runs_job_snapshot_id_fkey
    foreign key (user_id, job_snapshot_id) references public.job_snapshots (user_id, id)
    on delete cascade
);

-- Database-enforced: at most one CURRENT run per snapshot. Concurrent promotions serialize on a
-- row lock (see promote_requirement_mapping_run below); this index is the second, independent
-- guarantee that survives even a locking bug.
create unique index requirement_mapping_runs_one_current_per_snapshot
  on public.requirement_mapping_runs (job_snapshot_id) where status = 'CURRENT';
create index requirement_mapping_runs_user_id_idx on public.requirement_mapping_runs (user_id);
create index requirement_mapping_runs_snapshot_id_idx
  on public.requirement_mapping_runs (job_snapshot_id);

alter table public.requirement_mapping_runs enable row level security;

-- Same deliberate deviation as job_snapshots: select-only for `authenticated`. Direct inserts
-- would let a user fabricate a CURRENT run (and, combined with an insert policy on mappings,
-- fabricate evidence that skipped AI-contract validation entirely). All lifecycle transitions
-- happen through the three server-only functions in Part 6.
create policy "select own requirement_mapping_runs" on public.requirement_mapping_runs
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 5 — requirement_evidence_mappings
--
-- Immutable once written (a run's whole mapping set is inserted once, atomically, and never
-- touched again — supersession happens on the run, not on individual mapping rows). Same
-- immutability treatment as job_snapshots.
-- ================================================================================================

create table public.requirement_evidence_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  requirement_text text not null check (length(requirement_text) <= 500),
  requirement_fingerprint text not null check (length(requirement_fingerprint) > 0),
  requirement_category text check (requirement_category in (
    'SKILL', 'EXPERIENCE', 'EDUCATION', 'CERTIFICATION', 'WORK_AUTHORIZATION', 'LOCATION',
    'LANGUAGE', 'OTHER'
  )),
  required_or_preferred text not null check (required_or_preferred in ('REQUIRED', 'PREFERRED')),
  relationship text not null check (relationship in ('DIRECT', 'EQUIVALENT', 'INFERRED', 'MISSING')),
  -- [{ "factId": uuid, "sourceTable": one of the 5 fact tables, "factUpdatedAt": timestamptz }, ...]
  -- Server-derived provenance only — the model never sees or produces this shape; see Part 6's
  -- promote_requirement_mapping_run for the structural validation applied before insert.
  matched_facts jsonb not null default '[]',
  explanation text not null check (length(explanation) <= 400),
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  requires_user_confirmation boolean not null default true,
  created_at timestamptz not null default now(),

  constraint requirement_evidence_mappings_missing_has_no_facts check (
    (relationship = 'MISSING' and matched_facts = '[]'::jsonb)
    or (relationship <> 'MISSING' and jsonb_array_length(matched_facts) >= 1)
  ),
  constraint requirement_evidence_mappings_inferred_requires_confirmation check (
    relationship <> 'INFERRED' or requires_user_confirmation = true
  ),

  constraint requirement_evidence_mappings_run_id_fkey
    foreign key (user_id, run_id) references public.requirement_mapping_runs (user_id, id)
    on delete cascade,

  -- Dedup within a run — the app layer computes and rejects duplicate requirement_fingerprints
  -- before ever calling promote_requirement_mapping_run; this constraint is the structural
  -- backstop, not the primary detection mechanism.
  constraint requirement_evidence_mappings_run_fingerprint_key unique (run_id, requirement_fingerprint)
);

create index requirement_evidence_mappings_run_id_idx on public.requirement_evidence_mappings (run_id);
create index requirement_evidence_mappings_user_id_idx on public.requirement_evidence_mappings (user_id);

create trigger requirement_evidence_mappings_block_update
  before update on public.requirement_evidence_mappings
  for each row execute function public.reject_immutable_row_mutation();

alter table public.requirement_evidence_mappings enable row level security;

create policy "select own requirement_evidence_mappings" on public.requirement_evidence_mappings
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 6 — ai_usage_events: additive widening so Phase 5A can become this table's first real
-- caller (it has had no live call site since Phase 3 — see recordAiUsageEvent's own doc comment).
-- ================================================================================================

alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in ('field_suggestion', 'requirement_mapping'));

alter table public.ai_usage_events alter column field_classification drop not null;

alter table public.ai_usage_events add column prompt_version text;

-- ================================================================================================
-- PART 7 — internal helpers (never exposed via PostgREST — no grant to any application role)
-- ================================================================================================

create function public._upsert_job_snapshot(
  p_user_id uuid,
  p_source_job_id uuid,
  p_company text,
  p_title text,
  p_location text,
  p_employment_type text,
  p_source_url text,
  p_external_id text,
  p_description text,
  p_required_qualifications text[],
  p_preferred_qualifications text[],
  p_responsibilities text[],
  p_skills text[],
  p_salary_min numeric,
  p_salary_max numeric,
  p_salary_currency text,
  p_locations text[],
  p_work_mode text,
  p_remote_location_restrictions text,
  p_work_authorization_language text,
  p_source_type text,
  p_content_fingerprint text,
  p_content_truncated boolean,
  p_truncated_fields text[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 5 then
      raise exception '_upsert_job_snapshot: too many unique_violation retries for user %', p_user_id;
    end if;

    select id into v_id from public.job_snapshots
      where user_id = p_user_id
        and source_job_id = p_source_job_id
        and content_fingerprint = p_content_fingerprint;

    if v_id is not null then
      return v_id;
    end if;

    begin
      insert into public.job_snapshots (
        user_id, source_job_id, company, title, location, employment_type, source_url,
        external_id, description, required_qualifications, preferred_qualifications,
        responsibilities, skills, salary_min, salary_max, salary_currency, locations,
        work_mode, remote_location_restrictions, work_authorization_language, source_type,
        content_fingerprint, content_truncated, truncated_fields
      ) values (
        p_user_id, p_source_job_id, p_company, p_title, p_location, p_employment_type,
        p_source_url, p_external_id, p_description, p_required_qualifications,
        p_preferred_qualifications, p_responsibilities, p_skills, p_salary_min, p_salary_max,
        p_salary_currency, p_locations, p_work_mode, p_remote_location_restrictions,
        p_work_authorization_language, p_source_type, p_content_fingerprint,
        p_content_truncated, p_truncated_fields
      )
      returning id into v_id;

      return v_id;
    exception when unique_violation then
      -- A concurrent identical-content save won the race between this call's SELECT and
      -- INSERT — loop back around; the re-run SELECT will find the row it just committed.
      continue;
    end;
  end loop;
end;
$$;

revoke all on function public._upsert_job_snapshot from public;
revoke all on function public._upsert_job_snapshot from anon;
revoke all on function public._upsert_job_snapshot from authenticated;

-- SQL-side twin of packages/database's listOwnApprovedFactsForGeneration, scoped to exactly what
-- promote_requirement_mapping_run needs to re-verify a matched fact reference: does
-- (source_table, fact_id) exist, belong to this user, and remain approved. Kept minimal — the
-- richer read-path resolution (four distinct states) stays in TypeScript, not duplicated here.
create function public._approved_fact_versions(p_user_id uuid)
returns table (source_table text, fact_id uuid, updated_at timestamptz)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  select 'candidate_facts', id, updated_at from public.candidate_facts
    where user_id = p_user_id and user_approved and approved_for_applications
  union all
  select 'experiences', id, updated_at from public.experiences
    where user_id = p_user_id and user_approved and approved_for_applications
  union all
  select 'education', id, updated_at from public.education
    where user_id = p_user_id and user_approved and approved_for_applications
  union all
  select 'projects', id, updated_at from public.projects
    where user_id = p_user_id and user_approved and approved_for_applications
  union all
  select 'skills', id, updated_at from public.skills
    where user_id = p_user_id and user_approved and approved_for_applications
$$;

revoke all on function public._approved_fact_versions from public;
revoke all on function public._approved_fact_versions from anon;
revoke all on function public._approved_fact_versions from authenticated;

-- ================================================================================================
-- PART 8 — upsert_application_with_snapshot
--
-- Does NOT modify upsert_application_from_extension's signature (CREATE OR REPLACE cannot change
-- an existing function's argument list without creating an ambiguous overload — see
-- docs/IMPLEMENTATION_PLAN.md's Phase 5A note). Instead this new, separately-named function calls
-- the existing one verbatim and adds the snapshot capture + linking around it, all within the one
-- transaction a single RPC invocation already is.
-- ================================================================================================

create function public.upsert_application_with_snapshot(
  p_user_id uuid,
  p_job_id uuid,
  p_status text,
  p_snapshot_company text,
  p_snapshot_title text,
  p_snapshot_location text,
  p_snapshot_employment_type text,
  p_snapshot_source_url text,
  p_snapshot_external_id text,
  p_snapshot_description text,
  p_snapshot_required_qualifications text[],
  p_snapshot_preferred_qualifications text[],
  p_snapshot_responsibilities text[],
  p_snapshot_skills text[],
  p_snapshot_salary_min numeric,
  p_snapshot_salary_max numeric,
  p_snapshot_salary_currency text,
  p_snapshot_locations text[],
  p_snapshot_work_mode text,
  p_snapshot_remote_location_restrictions text,
  p_snapshot_work_authorization_language text,
  p_snapshot_source_type text,
  p_snapshot_content_fingerprint text,
  p_snapshot_content_truncated boolean,
  p_snapshot_truncated_fields text[],
  p_location text,
  p_source_url text,
  p_canonical_url text,
  p_ats_provider text,
  p_external_id text,
  p_autofill_summary jsonb,
  p_unresolved_fields jsonb
)
returns table (
  application_id uuid,
  created boolean,
  final_status text,
  previous_status text,
  job_snapshot_id uuid,
  snapshot_frozen boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_snapshot_id uuid;
  v_app_result record;
  v_frozen boolean;
begin
  if not exists (select 1 from public.jobs where id = p_job_id and user_id = p_user_id) then
    raise exception 'job % not found or not owned by this user', p_job_id;
  end if;

  v_snapshot_id := public._upsert_job_snapshot(
    p_user_id, p_job_id, p_snapshot_company, p_snapshot_title, p_snapshot_location,
    p_snapshot_employment_type, p_snapshot_source_url, p_snapshot_external_id,
    p_snapshot_description, p_snapshot_required_qualifications,
    p_snapshot_preferred_qualifications, p_snapshot_responsibilities, p_snapshot_skills,
    p_snapshot_salary_min, p_snapshot_salary_max, p_snapshot_salary_currency,
    p_snapshot_locations, p_snapshot_work_mode, p_snapshot_remote_location_restrictions,
    p_snapshot_work_authorization_language, p_snapshot_source_type,
    p_snapshot_content_fingerprint, p_snapshot_content_truncated, p_snapshot_truncated_fields
  );

  select * into v_app_result from public.upsert_application_from_extension(
    p_user_id, p_job_id, coalesce(p_snapshot_company, ''), coalesce(p_snapshot_title, ''),
    p_location, p_status, p_source_url, p_canonical_url, p_ats_provider, p_external_id,
    p_autofill_summary, p_unresolved_fields
  );

  -- APPLIED-freeze (round-4 addendum item 5): once an application has moved past SAVED/
  -- IN_PROGRESS, ordinary Save/Update must never repoint it at a different snapshot — that would
  -- weaken the historical record this whole feature exists to preserve. The snapshot itself is
  -- still captured/deduped above regardless (harmless); only the link is conditional. Any future
  -- correction requires an explicit amendment workflow — deferred to Phase 5B, not built here.
  if v_app_result.final_status in ('SAVED', 'IN_PROGRESS') then
    update public.applications
      set job_snapshot_id = v_snapshot_id
      where id = v_app_result.application_id and user_id = p_user_id;
    v_frozen := false;
  else
    v_frozen := true;
  end if;

  return query
    select
      v_app_result.application_id,
      v_app_result.created,
      v_app_result.final_status,
      v_app_result.previous_status,
      (select a.job_snapshot_id from public.applications a where a.id = v_app_result.application_id),
      v_frozen;
end;
$$;

revoke all on function public.upsert_application_with_snapshot from public;
revoke all on function public.upsert_application_with_snapshot from anon;
revoke all on function public.upsert_application_with_snapshot from authenticated;
grant execute on function public.upsert_application_with_snapshot to service_role;

-- ================================================================================================
-- PART 9 — requirement mapping run lifecycle functions
-- ================================================================================================

create function public.create_pending_requirement_mapping_run(
  p_user_id uuid,
  p_job_snapshot_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_retrieval_fact_count int
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
begin
  if not exists (
    select 1 from public.job_snapshots where id = p_job_snapshot_id and user_id = p_user_id
  ) then
    raise exception 'job_snapshot % not found or not owned by this user', p_job_snapshot_id;
  end if;

  insert into public.requirement_mapping_runs (
    user_id, job_snapshot_id, status, provider, model, prompt_version, retrieval_fact_count
  ) values (
    p_user_id, p_job_snapshot_id, 'PENDING', p_provider, p_model, p_prompt_version,
    p_retrieval_fact_count
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.create_pending_requirement_mapping_run from public;
revoke all on function public.create_pending_requirement_mapping_run from anon;
revoke all on function public.create_pending_requirement_mapping_run from authenticated;
grant execute on function public.create_pending_requirement_mapping_run to service_role;

-- Idempotent: a duplicate/retried failure report simply matches zero rows the second time
-- (status is no longer PENDING) and returns false rather than erroring — a repeated "it failed"
-- signal isn't itself a bug worth surfacing loudly.
create function public.mark_requirement_mapping_run_failed(
  p_user_id uuid,
  p_run_id uuid,
  p_failure_category text
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated boolean;
begin
  update public.requirement_mapping_runs
    set status = 'FAILED', failed_at = now(), failure_category = p_failure_category
    where id = p_run_id and user_id = p_user_id and status = 'PENDING';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.mark_requirement_mapping_run_failed from public;
revoke all on function public.mark_requirement_mapping_run_failed from anon;
revoke all on function public.mark_requirement_mapping_run_failed from authenticated;
grant execute on function public.mark_requirement_mapping_run_failed to service_role;

-- Atomic promotion: validate the complete proposed run, insert all mapping rows under it,
-- supersede whatever was CURRENT, promote the new run — one transaction. A duplicate/late
-- promotion attempt against an already-terminal run raises loudly (unlike mark-failed's silent
-- no-op) since silently swallowing it could mask a real client-retry bug.
create function public.promote_requirement_mapping_run(
  p_user_id uuid,
  p_run_id uuid,
  p_mappings jsonb
) returns table (run_id uuid, mapping_count int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job_snapshot_id uuid;
  v_status text;
  v_mapping jsonb;
  v_fact jsonb;
  v_relationship text;
  v_fact_count int;
  v_count int := 0;
begin
  select job_snapshot_id, status into v_job_snapshot_id, v_status
    from public.requirement_mapping_runs
    where id = p_run_id and user_id = p_user_id
    for update;

  if v_job_snapshot_id is null then
    raise exception 'run % not found or not owned by this user', p_run_id;
  end if;
  if v_status <> 'PENDING' then
    raise exception 'run % is not in PENDING state (already %)', p_run_id, v_status;
  end if;

  -- Row-lock the snapshot to serialize concurrent promotion attempts for it.
  perform 1 from public.job_snapshots where id = v_job_snapshot_id for update;

  if jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'promote_requirement_mapping_run: p_mappings must be a JSON array';
  end if;

  -- Structural validation of every mapping + its matched_facts, before any insert (round-4
  -- addendum item 7). This is a defense-in-depth backstop against a bug in the calling
  -- TypeScript code, not against a malicious model — the model's output was already validated
  -- and allowlist-checked before this function was ever called, and this function is
  -- unreachable by anything but trusted server code (Part 1's grant pattern).
  for v_mapping in select * from jsonb_array_elements(p_mappings)
  loop
    v_relationship := v_mapping ->> 'relationship';
    if v_relationship not in ('DIRECT', 'EQUIVALENT', 'INFERRED', 'MISSING') then
      raise exception 'promote_requirement_mapping_run: invalid relationship %', v_relationship;
    end if;

    if jsonb_typeof(v_mapping -> 'matchedFacts') <> 'array' then
      raise exception 'promote_requirement_mapping_run: matchedFacts must be a JSON array';
    end if;

    v_fact_count := jsonb_array_length(v_mapping -> 'matchedFacts');
    if v_relationship = 'MISSING' and v_fact_count <> 0 then
      raise exception 'promote_requirement_mapping_run: MISSING requirement must have zero matchedFacts';
    end if;
    if v_relationship <> 'MISSING' and v_fact_count = 0 then
      raise exception 'promote_requirement_mapping_run: % requires at least one matched fact', v_relationship;
    end if;

    for v_fact in select * from jsonb_array_elements(v_mapping -> 'matchedFacts')
    loop
      if (v_fact - 'factId' - 'sourceTable' - 'factUpdatedAt') <> '{}'::jsonb then
        raise exception 'promote_requirement_mapping_run: unexpected keys in matched fact %', v_fact;
      end if;
      if v_fact ->> 'sourceTable' not in
        ('candidate_facts', 'experiences', 'education', 'projects', 'skills') then
        raise exception 'promote_requirement_mapping_run: invalid sourceTable %', v_fact ->> 'sourceTable';
      end if;

      begin
        perform (v_fact ->> 'factId')::uuid;
      exception when others then
        raise exception 'promote_requirement_mapping_run: invalid factId %', v_fact ->> 'factId';
      end;
      begin
        perform (v_fact ->> 'factUpdatedAt')::timestamptz;
      exception when others then
        raise exception 'promote_requirement_mapping_run: invalid factUpdatedAt %', v_fact ->> 'factUpdatedAt';
      end;

      -- Re-verify the fact still belongs to this user and is still approved right now — defense
      -- in depth alongside the allowlist check already performed before this call.
      if not exists (
        select 1 from public._approved_fact_versions(p_user_id) f
          where f.source_table = v_fact ->> 'sourceTable'
            and f.fact_id = (v_fact ->> 'factId')::uuid
      ) then
        raise exception 'promote_requirement_mapping_run: fact % (%) is not an approved fact of this user',
          v_fact ->> 'factId', v_fact ->> 'sourceTable';
      end if;
    end loop;
  end loop;

  insert into public.requirement_evidence_mappings (
    user_id, run_id, requirement_text, requirement_fingerprint, requirement_category,
    required_or_preferred, relationship, matched_facts, explanation, confidence,
    requires_user_confirmation
  )
  select
    p_user_id,
    p_run_id,
    m ->> 'requirementText',
    m ->> 'requirementFingerprint',
    m ->> 'requirementCategory',
    m ->> 'requiredOrPreferred',
    m ->> 'relationship',
    m -> 'matchedFacts',
    m ->> 'explanation',
    (m ->> 'confidence')::numeric,
    (m ->> 'requiresUserConfirmation')::boolean
  from jsonb_array_elements(p_mappings) as m;

  get diagnostics v_count = row_count;

  update public.requirement_mapping_runs
    set status = 'SUPERSEDED'
    where job_snapshot_id = v_job_snapshot_id and status = 'CURRENT';

  update public.requirement_mapping_runs
    set status = 'CURRENT', completed_at = now()
    where id = p_run_id;

  return query select p_run_id, v_count;
end;
$$;

revoke all on function public.promote_requirement_mapping_run from public;
revoke all on function public.promote_requirement_mapping_run from anon;
revoke all on function public.promote_requirement_mapping_run from authenticated;
grant execute on function public.promote_requirement_mapping_run to service_role;
