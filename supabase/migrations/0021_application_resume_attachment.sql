-- Career OS — Phase 7B: application <-> resume attachment + submitted-résumé freeze.
--
-- Two nullable links, deliberately not one join table (see docs/IMPLEMENTATION_PLAN.md "Phase 7"
-- for the fuller comparison this migration's comments summarize):
--
--   applications.working_resume_version_id — "which version am I currently planning to submit?"
--     An ordinarily mutable pointer, exactly one per application, same shape and posture as the
--     job_snapshot_id/submission_packet_id columns 0010/0013 already added to this table.
--
--   submission_packets.resume_version_id — "which version did I actually submit?" Frozen once,
--     at the same moment mark_application_applied freezes everything else into the packet, and
--     never touched again — submission_packets is already immutable (0013's block-update trigger)
--     and never repointed by anything.
--
-- A separate application_resumes join table (purpose WORKING/SUBMITTED) was considered and
-- rejected: at most one WORKING version and one SUBMITTED version can ever be true for a given
-- application at a given time, so a join table would only ever hold 0-2 rows per application and
-- would duplicate exactly the two facts these two direct columns already represent — with none of
-- a join table's actual benefit (multiple concurrent rows of the same kind). SUBMITTED in
-- particular must never be a second, independently-mutable record of history: submission_packets
-- already *is* the canonical historical submission record (Phase 5B.1), and freezing the
-- submitted résumé onto that existing immutable row keeps "what did I submit" answerable from
-- exactly one place, not two that could disagree.
--
-- Both new FKs are composite (user_id, ...) against resume_versions(user_id, id) (migration
-- 0020) — a cross-user resume-version selection is structurally impossible, not merely checked in
-- application code, the same posture as every other cross-table link in this schema.

-- ================================================================================================
-- PART 1 — applications.working_resume_version_id
-- ================================================================================================

alter table public.applications add column working_resume_version_id uuid;

-- Column-scoped ON DELETE SET NULL (PG15+, same pattern as job_snapshot_id/submission_packet_id):
-- deleting a resume_version that is (only) someone's current working pointer just clears the
-- pointer — it never nulls applications.user_id, and it never blocks the version's deletion
-- (unlike Part 2's submission_packets FK below, which does block deletion once a version has been
-- submitted). Ordinarily mutable — no new RLS policy needed: the existing "update own
-- applications" policy from migration 0001 already covers this column, same as it already covers
-- every other ordinarily-mutable applications column.
alter table public.applications
  add constraint applications_working_resume_version_id_fkey
  foreign key (user_id, working_resume_version_id)
  references public.resume_versions (user_id, id)
  on delete set null (working_resume_version_id);

create index applications_working_resume_version_id_idx
  on public.applications (working_resume_version_id);

-- ================================================================================================
-- PART 2 — submission_packets.resume_version_id
--
-- Additive, alongside the pre-existing (always-null-in-practice) legacy resume_id column — never
-- replaced, never backfilled onto any existing packet. A packet frozen before this migration
-- keeps resume_version_id null forever; the historical viewer (application code, not this
-- migration) is responsible for telling that state apart from "no résumé was ever recorded."
--
-- No ON DELETE clause -> defaults to NO ACTION, i.e. RESTRICT within the transaction: once a
-- resume_version has been frozen into a real submission packet, deleting that version is
-- structurally blocked at the database level, not just by a hidden UI button. Deleting the
-- version's *parent* resume (which ON DELETE CASCADEs to resume_versions, migration 0020 Part 3)
-- attempts the same underlying version delete internally, so it is blocked too, for the identical
-- reason — a resume with any submitted version anywhere in its history cannot be deleted.
-- ================================================================================================

alter table public.submission_packets add column resume_version_id uuid;

alter table public.submission_packets
  add constraint submission_packets_resume_version_id_fkey
  foreign key (user_id, resume_version_id)
  references public.resume_versions (user_id, id)
  on delete restrict;

-- ================================================================================================
-- PART 3 — extend mark_application_applied to freeze the application's current working résumé
-- version into a newly-created packet.
--
-- p_resume_version_id is appended as a new final parameter with a default of null. PostgreSQL's
-- CREATE OR REPLACE FUNCTION only replaces an existing function when the argument list is
-- byte-for-byte identical (a default value doesn't exempt an added parameter from that rule) —
-- adding one, even with a default, registers as a distinct overload instead of replacing 0013's
-- 11-parameter version, which then makes every unqualified reference to
-- `public.mark_application_applied` ambiguous (confirmed against the live linked project:
-- `ERROR: function name "public.mark_application_applied" is not unique`, SQLSTATE 42725). The
-- explicit DROP below removes 0013's exact original signature first, so exactly one version of
-- this function exists afterward — the grants are re-declared unconditionally regardless, same
-- explicitness every other function in this codebase uses. Behavior is otherwise byte-for-byte
-- identical to 0013's version:
--
--   * Idempotent already-APPLIED case (packet already exists): p_resume_version_id is accepted
--     but ignored, exactly like every other p_* content argument in that branch — a repeated call
--     never swaps the frozen résumé version, even if the application's working_resume_version_id
--     has since changed to point at a newer version.
--   * First real transition into APPLIED: p_resume_version_id is frozen into the new packet
--     verbatim. It is null whenever the application had no working résumé version selected at
--     that moment — never inferred or defaulted to "current"/"primary" (same posture 0013
--     established for p_resume_id, and the same reasoning docs/IMPLEMENTATION_PLAN.md gives for
--     why résumé attachment must stay optional: some applications never carry one at all).
-- ================================================================================================

drop function if exists public.mark_application_applied(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, uuid, text
);

create function public.mark_application_applied(
  p_user_id uuid,
  p_application_id uuid,
  p_answers_snapshot jsonb,
  p_autofill_summary jsonb,
  p_unresolved_fields jsonb,
  p_consistency_findings jsonb,
  p_consistency_acknowledgements jsonb,
  p_job_snapshot_id uuid,
  p_resume_id uuid,
  p_requirement_mapping_run_id uuid,
  p_content_fingerprint text,
  p_resume_version_id uuid default null
)
returns table (
  application_id uuid,
  status text,
  applied_at timestamptz,
  previous_status text,
  submission_packet_id uuid,
  packet_created boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_app public.applications%rowtype;
  v_applied_at timestamptz;
  v_packet_id uuid;
  v_created boolean := false;
begin
  select * into v_app from public.applications
    where id = p_application_id and user_id = p_user_id
    for update;

  if not found then
    raise exception 'application % not found or not owned by this user', p_application_id;
  end if;

  if v_app.status = 'APPLIED' then
    return query select
      v_app.id, v_app.status, v_app.applied_at, v_app.status, v_app.submission_packet_id, false;
    return;
  end if;

  v_applied_at := coalesce(v_app.applied_at, now());

  if v_app.submission_packet_id is null then
    insert into public.submission_packets (
      user_id, application_id, job_snapshot_id, resume_id, resume_version_id,
      requirement_mapping_run_id, answers_snapshot, autofill_summary, unresolved_fields,
      consistency_findings, consistency_acknowledgements, content_fingerprint
    ) values (
      p_user_id, p_application_id, p_job_snapshot_id, p_resume_id, p_resume_version_id,
      p_requirement_mapping_run_id, p_answers_snapshot, p_autofill_summary, p_unresolved_fields,
      p_consistency_findings, p_consistency_acknowledgements, p_content_fingerprint
    )
    returning id into v_packet_id;
    v_created := true;
  else
    v_packet_id := v_app.submission_packet_id;
  end if;

  update public.applications
    set status = 'APPLIED', applied_at = v_applied_at, submission_packet_id = v_packet_id
    where id = p_application_id and user_id = p_user_id;

  insert into public.application_events (
    user_id, application_id, event_type, from_status, to_status, source
  ) values (
    p_user_id, p_application_id, 'STATUS_CHANGE', v_app.status, 'APPLIED', 'USER'
  );

  return query select
    p_application_id, 'APPLIED'::text, v_applied_at, v_app.status, v_packet_id, v_created;
end;
$$;

revoke all on function public.mark_application_applied from public;
revoke all on function public.mark_application_applied from anon;
revoke all on function public.mark_application_applied from authenticated;
grant execute on function public.mark_application_applied to service_role;
