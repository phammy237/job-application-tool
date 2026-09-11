-- Career OS — Phase 5B hardening: close the direct-PostgREST APPLIED bypass identified by
-- adversarial review (docs/IMPLEMENTATION_PLAN.md "Phase 5B hardening"). Migrations 0013/0014
-- built the canonical mark_application_applied RPC and its gate, but never restricted the
-- applications table itself — the table's ordinary `authenticated` RLS INSERT/UPDATE policies
-- (migration 0001) have no column restriction, so a direct PostgREST call using a user's own
-- valid session JWT could set status='APPLIED' (or applied_at/submission_packet_id) directly,
-- bypassing the RPC, packet creation, and the consistency firewall entirely. This migration
-- closes that at the database boundary with a trigger — RLS itself is left exactly as permissive
-- as before for every other column/value (CLAUDE.md: RLS is the backstop, not the only check;
-- this is the second, independent check for the one narrow case that actually matters).
--
-- Guard: reject any INSERT, or any UPDATE that changes applications.status into 'APPLIED' from
-- something else, or that sets applied_at or submission_packet_id from null to non-null, unless
-- the executing Postgres role is service_role. mark_application_applied always executes as
-- service_role (granted execute only to that role — migration 0013's PART 4), so it is
-- unaffected. Every ordinary write that does not attempt one of these three transitions — a new
-- non-APPLIED application, an edit to notes/company/title regardless of current status, a
-- Gmail-driven move to a later status, moving away from APPLIED to something else — is also
-- unaffected, since the guard's condition simply never matches for those.
--
-- revertApplicationEvent (packages/database/src/queries/application-events.ts) is the one
-- accepted exception to "only mark_application_applied produces APPLIED" — an existing Phase 5B
-- invariant, unchanged by this migration: restoring a genuinely historical APPLIED state after an
-- undo. Its one applications-table write now runs via the admin/service-role client for exactly
-- this reason, which is why this trigger's exception is a plain role check rather than "was this
-- called from mark_application_applied specifically" — the revert path legitimately needs the
-- same exception mark_application_applied does. A second, independent safeguard added in that
-- same TypeScript function (not this migration, see its own updated comment) additionally
-- refuses to revert-restore APPLIED unless the application's own applied_at is already non-null
-- — i.e. unless it is independently, structurally provable (via a column this very trigger also
-- protects) that the row really did go through mark_application_applied at some point in its
-- history. Without that second check, a user could insert a fabricated application_events row
-- (event_type='STATUS_CHANGE', from_status='APPLIED', reverted_at=null — application_events
-- keeps its ordinary authenticated insert policy, since legitimate code also inserts rows with
-- from_status='APPLIED' whenever a real application moves away from APPLIED to something else)
-- and then call the real revert flow on it to manufacture an APPLIED state for an application
-- that was never legitimately applied at all. Guarding applied_at here is what makes that
-- fabricated row insufficient on its own.

create function public.reject_direct_applied_transition() returns trigger
language plpgsql as $$
declare
  v_becoming_applied boolean;
  v_setting_applied_at boolean;
  v_setting_packet_id boolean;
begin
  if TG_OP = 'INSERT' then
    v_becoming_applied := (new.status = 'APPLIED');
    v_setting_applied_at := (new.applied_at is not null);
    v_setting_packet_id := (new.submission_packet_id is not null);
  else
    v_becoming_applied := (new.status = 'APPLIED' and old.status is distinct from 'APPLIED');
    v_setting_applied_at := (new.applied_at is not null and old.applied_at is null);
    v_setting_packet_id :=
      (new.submission_packet_id is not null and old.submission_packet_id is null);
  end if;

  if (v_becoming_applied or v_setting_applied_at or v_setting_packet_id)
     and current_user <> 'service_role'
  then
    raise exception 'applications rows may only reach APPLIED (status/applied_at/submission_packet_id) via a trusted server-side operation — mark_application_applied, or the equivalent trusted historical-revert path — never a direct client write. current_user=%, TG_OP=%', current_user, TG_OP;
  end if;

  return new;
end;
$$;

create trigger applications_guard_applied_transition
  before insert or update on public.applications
  for each row execute function public.reject_direct_applied_transition();
