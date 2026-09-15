-- Career OS — Phase 7H: link a saved tailored résumé version to the company-research snapshot
-- (if any) that informed it.
--
-- Immutable audit provenance, not a live/mutable pointer: once `save_reviewed_tailored_resume`
-- writes this column for a version, it never changes again — resume_versions is already fully
-- immutable (migration 0020's block-update trigger), so this column is set exactly once, at
-- insert time, same as every other column on this table. A later research refresh (a new
-- snapshot R2) never repoints an existing version from R1 to R2 — retailoring against R2 always
-- produces a brand-new version instead (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §44/§45).
--
-- Deliberately NOT added to `create_resume_version` (migration 0020's generic version-creation
-- RPC, used by Resume Studio's manual save and other non-tailoring call sites): those saves have
-- no company-research context to record, and the column is nullable with no default reference, so
-- every existing call site there is untouched and simply inserts null for it. Only
-- `save_reviewed_tailored_resume` (migration 0024) — the one save path that can actually be
-- research-aware — gets the new parameter.
--
-- FK behavior: composite `(user_id, company_research_snapshot_id)` against
-- `company_research_snapshots (user_id, id)`, same cross-user-impossible pattern as every other
-- link in this schema. `ON DELETE RESTRICT` (the default when no ON DELETE clause is given) is a
-- deliberate choice over `ON DELETE SET NULL`, for two reasons:
--   1. Once a résumé version has been saved with this snapshot's identity, that identity is real
--      history — "which research informed this specific version" — and silently losing it to a
--      later delete would be dishonest audit-wise (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §43).
--   2. `resume_versions` already carries the exact blanket-immutability-trigger-vs-FK-SET-NULL
--      conflict this codebase hit for real in Phase 7G (migration 0027's own fix): had this FK
--      instead used `ON DELETE SET NULL`, deleting a referenced snapshot would attempt an
--      `UPDATE ... SET company_research_snapshot_id = NULL` against a row `resume_versions_
--      block_update` (migration 0020) rejects outright — reintroducing that same bug class rather
--      than reusing 0027's specialized-trigger fix a second time.
-- This is a deliberate, documented narrowing of Phase 7G's original "owner can always delete
-- their own research snapshot" semantics: once a résumé version has been saved that references a
-- snapshot, that snapshot can no longer be deleted (the delete fails with a foreign-key
-- violation) until no version references it any more (which cannot happen today, since résumé
-- versions themselves are never deletable once submitted, and this column is never nulled). See
-- docs/COMPANY_RESEARCH.md for the user-facing explanation of this behavior.

alter table public.resume_versions
  add column company_research_snapshot_id uuid;

alter table public.resume_versions
  add constraint resume_versions_company_research_snapshot_id_fkey
  foreign key (user_id, company_research_snapshot_id)
  references public.company_research_snapshots (user_id, id);

create index resume_versions_company_research_snapshot_id_idx
  on public.resume_versions (company_research_snapshot_id);

-- ================================================================================================
-- save_reviewed_tailored_resume: add an optional p_company_research_snapshot_id param.
--
-- PostgreSQL's CREATE OR REPLACE FUNCTION only replaces an existing function when the argument
-- list is byte-for-byte identical to what's already registered — adding a parameter, even with a
-- default, registers as a distinct overload rather than replacing the old one, leaving two
-- versions of the same name and making every unqualified call ambiguous (the same issue migration
-- 0021 already hit and fixed for mark_application_applied). The old 9-arg signature is dropped
-- first, then the 10-arg version is created fresh.
-- ================================================================================================

drop function public.save_reviewed_tailored_resume(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb
);

create function public.save_reviewed_tailored_resume(
  p_user_id uuid,
  p_application_id uuid,
  p_expected_working_resume_version_id uuid,
  p_expected_job_snapshot_id uuid,
  p_target_resume_id uuid,
  p_new_resume_name text,
  p_new_resume_parent_id uuid,
  p_version_display_name text,
  p_snapshot_payload jsonb,
  p_company_research_snapshot_id uuid default null
)
returns table (
  resume_id uuid,
  resume_created boolean,
  version_id uuid,
  version_number integer,
  display_name text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_app public.applications%rowtype;
  v_resume_id uuid;
  v_resume_created boolean := false;
  v_next_version int;
  v_version public.resume_versions%rowtype;
begin
  if p_target_resume_id is null and p_new_resume_name is null then
    raise exception 'save_reviewed_tailored_resume: either p_target_resume_id or p_new_resume_name must be given';
  end if;
  if p_target_resume_id is not null and p_new_resume_name is not null then
    raise exception 'save_reviewed_tailored_resume: p_target_resume_id and p_new_resume_name are mutually exclusive';
  end if;

  -- Phase 7H — never trust a caller-supplied snapshot id blindly, even though the one real call
  -- site (the save API route) already does its own ownership check first and forwards null rather
  -- than an unowned id (see that route's own comment); this is the same defense-in-depth posture
  -- create_company_research_snapshot itself already uses for every id it's handed.
  if p_company_research_snapshot_id is not null then
    if not exists (
      select 1 from public.company_research_snapshots
      where id = p_company_research_snapshot_id and user_id = p_user_id
    ) then
      raise exception 'company_research_snapshot_not_found';
    end if;
  end if;

  -- Row-lock the application for the duration of the transaction — same "select ... for update"
  -- pattern as create_resume_version/mark_application_applied, and the anchor both staleness
  -- checks and the final pointer update below all read/write against.
  select * into v_app from public.applications
    where id = p_application_id and user_id = p_user_id
    for update;

  if not found then
    raise exception 'application_not_found';
  end if;

  if v_app.working_resume_version_id is distinct from p_expected_working_resume_version_id then
    raise exception 'stale_base_resume'
      using detail = coalesce(v_app.working_resume_version_id::text, '');
  end if;

  if v_app.job_snapshot_id is distinct from p_expected_job_snapshot_id then
    raise exception 'stale_job_context'
      using detail = coalesce(v_app.job_snapshot_id::text, '');
  end if;

  if p_target_resume_id is not null then
    -- Row-lock the target logical résumé too — a concurrent rename/delete of it while this
    -- transaction is in flight serializes rather than racing.
    select id into v_resume_id from public.resumes
      where id = p_target_resume_id and user_id = p_user_id
      for update;
    if not found then
      raise exception 'resume_not_found';
    end if;
  else
    -- Ordinary insert into public.resumes — same trigger-enforced invariants as any other insert
    -- (resumes_enforce_parent_is_master, migration 0020): p_new_resume_parent_id, if given, must
    -- already be a MASTER résumé owned by this same user, or the insert itself fails.
    insert into public.resumes (user_id, name, kind, parent_resume_id)
      values (p_user_id, p_new_resume_name, 'TAILORED', p_new_resume_parent_id)
      returning id into v_resume_id;
    v_resume_created := true;
  end if;

  select coalesce(max(rv.version_number), 0) + 1 into v_next_version
    from public.resume_versions rv
    where rv.resume_id = v_resume_id and rv.user_id = p_user_id;

  insert into public.resume_versions (
    user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload,
    company_research_snapshot_id
  ) values (
    p_user_id, v_resume_id, v_next_version, p_version_display_name, 'STRUCTURED_V1',
    p_snapshot_payload, p_company_research_snapshot_id
  )
  returning * into v_version;

  update public.applications
    set working_resume_version_id = v_version.id
    where id = p_application_id and user_id = p_user_id;

  return query select v_resume_id, v_resume_created, v_version.id, v_version.version_number, v_version.display_name;
end;
$$;

revoke all on function public.save_reviewed_tailored_resume from public;
revoke all on function public.save_reviewed_tailored_resume from anon;
revoke all on function public.save_reviewed_tailored_resume from authenticated;
grant execute on function public.save_reviewed_tailored_resume to service_role;
