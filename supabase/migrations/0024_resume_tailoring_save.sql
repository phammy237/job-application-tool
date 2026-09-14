-- Career OS — Phase 7F: save a reviewed AI résumé-tailoring draft as a new immutable version.
--
-- Phase 7E's proposal is deliberately ephemeral (never persisted) and the user's review of it
-- (accept/reject/edit) lives entirely client-side until they explicitly click "Save Tailored
-- Resume" (docs/IMPLEMENTATION_PLAN.md "Phase 7F" §3/§47/§62). This migration adds the one
-- atomic, concurrency-safe operation that actually persists that decision — reusing the exact
-- versioning primitives migration 0020's create_resume_version already established (row-lock the
-- parent resume, compute version_number under that lock, insert) rather than inventing a second
-- way to create a version.
--
-- What's new here beyond create_resume_version:
--   1. An optimistic-concurrency guard on the *application*: the caller states which working
--      résumé version and which job snapshot the reviewed draft was generated against
--      (p_expected_working_resume_version_id / p_expected_job_snapshot_id); if either no longer
--      matches the application's current state, the save is rejected outright — never silently
--      applied on top of a stale base (§14/§15/§50). Both application columns are read under the
--      same row lock as the eventual working-résumé-pointer update, so two concurrent saves from
--      the same stale base cannot both succeed (§50): the first to acquire the lock wins, updates
--      the pointer, and commits; the second then sees the now-changed working_resume_version_id
--      once it acquires the lock and is rejected.
--   2. Optionally creating a new TAILORED logical résumé in the same transaction as the version
--      it immediately gets a version in — the MASTER-base case (§17/§28: tailoring from the
--      user's master always produces a new TAILORED résumé, never a versioned master).
--   3. Setting applications.working_resume_version_id to the newly created version, atomically
--      with its creation — nothing between "version exists" and "the application points at it"
--      for another request to observe (§20/§49).
--
-- What's deliberately unchanged: submission_packets is never touched here (§27) — this function
-- has no parameter for it and no code path that could reach it. A résumé version's own content
-- and immutability are exactly create_resume_version's existing guarantees; this function does
-- not duplicate or reimplement them, it only adds application-level orchestration around them.

create function public.save_reviewed_tailored_resume(
  p_user_id uuid,
  p_application_id uuid,
  p_expected_working_resume_version_id uuid,
  p_expected_job_snapshot_id uuid,
  -- Exactly one of these two branches is used: pass an existing logical résumé id to append the
  -- next version to it, or leave it null and supply naming/lineage to create a new TAILORED
  -- résumé first. Never both, and never neither (checked below, not left to fall through).
  p_target_resume_id uuid,
  p_new_resume_name text,
  p_new_resume_parent_id uuid,
  p_version_display_name text,
  p_snapshot_payload jsonb
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
    user_id, resume_id, version_number, display_name, snapshot_format, snapshot_payload
  ) values (
    p_user_id, v_resume_id, v_next_version, p_version_display_name, 'STRUCTURED_V1', p_snapshot_payload
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
