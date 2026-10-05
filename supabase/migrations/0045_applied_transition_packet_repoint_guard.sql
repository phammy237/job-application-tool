-- Career OS — close a narrow gap in the 0015 applied-transition guard: submission_packet_id could
-- be RE-POINTED after an application reached APPLIED.
--
-- 0015's reject_direct_applied_transition() only guarded the null -> non-null transition on
-- submission_packet_id ("v_setting_packet_id := new.submission_packet_id is not null and
-- old.submission_packet_id is null"). Once an application is APPLIED with a packet already
-- attached, an ordinary authenticated client could still run
-- `update applications set submission_packet_id = <another-own-packet-uuid> ...` directly via
-- PostgREST — the trigger never fired, because old.submission_packet_id was already non-null.
--
-- The composite foreign key (user_id, submission_packet_id) -> submission_packets(user_id, id)
-- (migration 0013) already prevents pointing at another *user's* packet, so this was never a
-- cross-tenant bypass — only a user rewriting which of their own historical submission packets is
-- attached to an already-applied application, silently altering that application's own recorded
-- provenance after the fact. Still worth closing: provenance that can be quietly rewritten by its
-- own owner is not a reliable audit trail.
--
-- Fix: v_setting_packet_id now also fires on any *change* to a non-null value, not just
-- null -> non-null. Nulling an existing packet id back out is left alone — outside this finding's
-- scope and a strictly lower-risk direction (detaching provenance, not forging a different one).
create or replace function public.reject_direct_applied_transition() returns trigger
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
      (new.submission_packet_id is not null
       and old.submission_packet_id is distinct from new.submission_packet_id);
  end if;

  if (v_becoming_applied or v_setting_applied_at or v_setting_packet_id)
     and current_user <> 'service_role'
  then
    raise exception 'applications rows may only reach APPLIED (status/applied_at/submission_packet_id) via a trusted server-side operation — mark_application_applied, or the equivalent trusted historical-revert path — never a direct client write. current_user=%, TG_OP=%', current_user, TG_OP;
  end if;

  return new;
end;
$$;
