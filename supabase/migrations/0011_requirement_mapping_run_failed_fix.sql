-- Career OS — Phase 5A correction: mark_requirement_mapping_run_failed's GET DIAGNOSTICS bug
--
-- Migration 0010 was applied to the linked project (via `supabase db push --linked`) while
-- mark_requirement_mapping_run_failed still had a real bug: its GET DIAGNOSTICS target was
-- declared `boolean` instead of an integer type, so `get diagnostics v_updated = row_count`
-- followed by `return v_updated > 0` failed at runtime with "operator does not exist:
-- boolean > integer" — caught only by exercising the RPC against a real database, not by any
-- mocked test. The live function was corrected in place via an out-of-band
-- `create or replace function` issued directly against the linked project, and the
-- 0010 migration *file* was separately edited in the same working session (before it had been
-- committed) to match. That out-of-band operation is not something any other database's
-- migration history can be relied on to have received, and per this repo's migration
-- discipline (see 0009's header comment) an already-applied migration is never edited again
-- once it's part of committed history — 0010 is that now. This is the proper forward
-- migration for the correction, so the fix is tracked and reproducible rather than resting on
-- a manual operation.
--
-- Applying 0001-0011 to a fresh database and applying 0011 alone to a database already at
-- 0010 (whether or not that database ever received the out-of-band manual fix — CREATE OR
-- REPLACE FUNCTION is idempotent) both arrive at the identical end state.

create or replace function public.mark_requirement_mapping_run_failed(
  p_user_id uuid,
  p_run_id uuid,
  p_failure_category text
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row_count int;
begin
  update public.requirement_mapping_runs
    set status = 'FAILED', failed_at = now(), failure_category = p_failure_category
    where id = p_run_id and user_id = p_user_id and status = 'PENDING';
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

-- Re-asserted explicitly rather than assumed preserved — CREATE OR REPLACE FUNCTION does not
-- change existing grants, so this is a no-op against a database already correctly configured,
-- but it makes 0011 self-contained: it does not rely on 0010 (or the out-of-band manual fix)
-- having left the grants in the right state, and it guards against the function ever
-- accidentally regaining default PUBLIC execute privilege.
revoke all on function public.mark_requirement_mapping_run_failed from public;
revoke all on function public.mark_requirement_mapping_run_failed from anon;
revoke all on function public.mark_requirement_mapping_run_failed from authenticated;
grant execute on function public.mark_requirement_mapping_run_failed to service_role;
