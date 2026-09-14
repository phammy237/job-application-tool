-- Career OS — Phase 7A: master résumé + immutable résumé versioning.
--
-- Pre-migration inspection (see the accompanying report) found that `public.resumes` — created
-- in 0001_init.sql as "table only, upload UI and extraction pipeline land in a later phase" — has
-- no real writer anywhere in this codebase: no route, no server action, no insert call site
-- outside pgTAP fixtures inside rolled-back transactions. `applications.resume_id` and
-- `submission_packets.resume_id` both point at it and are both always null in practice (confirmed
-- in 0013's own comments). Its actual shape (file_path/file_name/label/is_primary/
-- extraction_status/extracted_at) is a *different* concept from what Phase 7 needs — an uploaded
-- résumé file awaiting future Claude extraction into candidate_facts, per docs/USER_FLOWS.md §1 —
-- not a logical "résumé identity with tailored version history." Conflating the two would corrupt
-- both concepts, so this migration renames the existing table to `resume_uploads` (zero data
-- loss: it has no rows in any real environment, and PostgreSQL preserves every dependent FK,
-- index, and RLS policy automatically across a table rename) and gives the freed `resumes` name
-- to the new logical-identity model this phase actually needs. `applications.resume_id`,
-- `candidate_facts.source_resume_id`, and `submission_packets.resume_id` keep their exact current
-- (always-null) meaning, now pointing at `resume_uploads` — no historical value is reinterpreted.

-- ================================================================================================
-- PART 1 — rename resumes -> resume_uploads (renaming every dependent identifier for clarity;
-- the rename itself is what PostgreSQL propagates automatically to FKs)
-- ================================================================================================

alter table public.resumes rename to resume_uploads;
alter table public.resume_uploads rename constraint resumes_user_id_id_key to resume_uploads_user_id_id_key;
alter index resumes_user_id_idx rename to resume_uploads_user_id_idx;
alter trigger resumes_set_updated_at on public.resume_uploads rename to resume_uploads_set_updated_at;
alter policy "select own resumes" on public.resume_uploads rename to "select own resume_uploads";
alter policy "insert own resumes" on public.resume_uploads rename to "insert own resume_uploads";
alter policy "update own resumes" on public.resume_uploads rename to "update own resume_uploads";
alter policy "delete own resumes" on public.resume_uploads rename to "delete own resume_uploads";
alter table public.submission_packets
  rename constraint submission_packets_resume_fkey to submission_packets_resume_upload_fkey;

-- ================================================================================================
-- PART 2 — resumes (new): logical résumé identity — a name/kind/lineage record with no content of
-- its own. Content lives exclusively in resume_versions (Part 3); this table is the thing a
-- version belongs to and the thing a display name/rename applies to.
-- ================================================================================================

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('MASTER', 'TAILORED')),
  -- Nullable: a MASTER resume has no parent by definition (enforced below); a TAILORED resume is
  -- expected to descend from the user's MASTER, though this column alone doesn't require that —
  -- the trigger below does. Composite FK + column-scoped SET NULL (PG15+, same pattern as
  -- job_snapshot_id/submission_packet_id): deleting the parent never nulls this row's user_id.
  parent_resume_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint resumes_user_id_id_key unique (user_id, id),
  constraint resumes_parent_not_self check (parent_resume_id is distinct from id),
  constraint resumes_master_has_no_parent check (kind <> 'MASTER' or parent_resume_id is null),
  constraint resumes_parent_resume_id_fkey
    foreign key (user_id, parent_resume_id) references public.resumes (user_id, id)
    on delete set null (parent_resume_id)
);

-- At most one MASTER resume per user (docs' "Master resume rule": a single active MASTER is
-- enough for this product today — nothing in the current profile/candidate-facts model is
-- per-discipline, so multiple simultaneous masters would just be multiple identical starting
-- points with no way to tell them apart). Database-enforced, not UI convention.
create unique index resumes_one_master_per_user
  on public.resumes (user_id) where kind = 'MASTER';
create index resumes_user_id_idx on public.resumes (user_id);
create index resumes_parent_resume_id_idx on public.resumes (parent_resume_id);

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

-- Real structural lineage guarantee beyond the nullable FK above: a resume with a non-null parent
-- must point at a MASTER resume owned by the same user, not at another TAILORED resume (which
-- would create ambiguous, hard-to-reason-about lineage chains). Runs as a trigger — independent of
-- which role performs the write — the same "don't rely on RLS/app code alone for an invariant"
-- posture CLAUDE.md establishes for authorization; this one is a data-shape invariant, not an
-- authorization boundary, but the enforcement mechanism is the same idea.
create function public.enforce_resume_parent_is_master() returns trigger
language plpgsql as $$
begin
  if new.parent_resume_id is not null then
    if not exists (
      select 1 from public.resumes
      where id = new.parent_resume_id and user_id = new.user_id and kind = 'MASTER'
    ) then
      raise exception
        'resumes.parent_resume_id must reference a MASTER resume owned by the same user (resume id=%)',
        new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger resumes_enforce_parent_is_master
  before insert or update on public.resumes
  for each row execute function public.enforce_resume_parent_is_master();

alter table public.resumes enable row level security;

-- Ordinary four-policy pattern (docs/DATA_MODEL.md "RLS policy pattern") — a logical resume is
-- plain user-editable identity data (name/kind/lineage), not immutable history. All the
-- immutability guarantees this phase needs live on resume_versions (Part 3) instead.
create policy "select own resumes" on public.resumes
  for select using (auth.uid() = user_id);
create policy "insert own resumes" on public.resumes
  for insert with check (auth.uid() = user_id);
create policy "update own resumes" on public.resumes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own resumes" on public.resumes
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- PART 3 — resume_versions: immutable snapshots. A version's content is never edited in place —
-- editing always creates a new version, which is the entire point of this table.
--
-- What a version actually snapshots in *this* phase: this repo has no structured resume content,
-- no LaTeX, no PDF, and no wired uploaded-file/extraction pipeline yet (resume_uploads has never
-- had a writer either — see Part 1's note) — there is no truthful content to copy into a version
-- today. Rather than fabricate a content shape to fill the column, snapshot_format is a real,
-- narrow enum with exactly one current, honest member: METADATA_ONLY, meaning "this version's
-- identity (name/number/timestamp) is real and permanent; its document content does not exist
-- yet." snapshot_payload stays null for every METADATA_ONLY row (enforced below) — never a
-- fabricated placeholder. This is still enough to support Phase 7B's attachment/freeze semantics,
-- which only need a version's *identity*, not its content, to answer "which version was
-- submitted." A later phase (7C+) adds real content by widening this same check constraint with a
-- new migration — additive, never reinterpreting an existing METADATA_ONLY row's meaning.
-- ================================================================================================

create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resume_id uuid not null,
  version_number integer not null check (version_number > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  snapshot_format text not null default 'METADATA_ONLY'
    check (snapshot_format in ('METADATA_ONLY')),
  snapshot_payload jsonb,
  created_at timestamptz not null default now(),

  constraint resume_versions_metadata_only_has_no_payload
    check (snapshot_format <> 'METADATA_ONLY' or snapshot_payload is null),

  constraint resume_versions_user_id_id_key unique (user_id, id),
  -- Safe per-resume version numbering's second, independent guarantee (see
  -- create_resume_version below for the first: a row lock on the parent resume).
  constraint resume_versions_resume_version_key unique (resume_id, version_number),
  constraint resume_versions_resume_id_fkey
    foreign key (user_id, resume_id) references public.resumes (user_id, id)
    on delete cascade
);

create index resume_versions_user_id_idx on public.resume_versions (user_id);
create index resume_versions_resume_id_idx on public.resume_versions (resume_id);

-- Immutability — reuses the exact trigger function migrations 0010/0013 already defined
-- (public.reject_immutable_row_mutation), fires against every role including service_role.
create trigger resume_versions_block_update
  before update on public.resume_versions
  for each row execute function public.reject_immutable_row_mutation();

alter table public.resume_versions enable row level security;

-- Deliberate deviation from the ordinary four-policy pattern, same posture as job_snapshots/
-- requirement_mapping_runs: no INSERT policy for `authenticated`. version_number must never be
-- client-supplied (a direct PostgREST insert could pick an arbitrary/colliding number, or skip
-- the row-lock that makes numbering race-free) — every version is created exclusively through the
-- create_resume_version RPC below (service-role-only, same posture as mark_application_applied).
--
-- DELETE, unlike INSERT, *is* given an ordinary authenticated policy: Phase 7A's actual
-- deletion invariant ("a version that was ever historically submitted must not be deletable") is
-- enforced structurally by submission_packets.resume_version_id's FK (Part 2 of the next
-- migration) being ON DELETE RESTRICT, not by withholding DELETE entirely — a non-submitted
-- version genuinely should be deletable by its owner (docs: "Do NOT rely solely on hidden UI
-- buttons").
create policy "select own resume_versions" on public.resume_versions
  for select using (auth.uid() = user_id);
create policy "delete own resume_versions" on public.resume_versions
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- PART 4 — create_resume_version: the one atomic, concurrency-safe path for creating a version.
--
-- Row-locks the parent resumes row for the duration of the transaction (same "select ... for
-- update" pattern as increment_ai_request_usage/mark_application_applied), so two concurrent
-- calls for the *same* resume_id serialize instead of racing on `max(version_number) + 1`; the
-- unique(resume_id, version_number) constraint above is the second, independent guarantee that
-- survives even a locking bug. security invoker + service_role-only grant, same posture as every
-- other privileged write in this codebase (upsert_application_from_extension, mark_
-- application_applied) — callers derive p_user_id from the verified server-side session, never
-- from a client-supplied field, and call this via the admin client from a Next.js server action.
-- ================================================================================================

create function public.create_resume_version(
  p_user_id uuid,
  p_resume_id uuid,
  p_display_name text,
  p_snapshot_format text default 'METADATA_ONLY',
  p_snapshot_payload jsonb default null
)
returns public.resume_versions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_resume public.resumes%rowtype;
  v_next_version int;
  v_row public.resume_versions%rowtype;
begin
  select * into v_resume from public.resumes
    where id = p_resume_id and user_id = p_user_id
    for update;

  if not found then
    raise exception 'resume % not found or not owned by this user', p_resume_id;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
    from public.resume_versions
    where resume_id = p_resume_id and user_id = p_user_id;

  insert into public.resume_versions (
    user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload
  ) values (
    p_user_id, p_resume_id, v_next_version, p_display_name, p_snapshot_format, p_snapshot_payload
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_resume_version from public;
revoke all on function public.create_resume_version from anon;
revoke all on function public.create_resume_version from authenticated;
grant execute on function public.create_resume_version to service_role;
