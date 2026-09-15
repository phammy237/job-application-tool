-- Career OS — Phase 7G fix: company_research_snapshots' blanket immutability trigger (migration
-- 0025) conflicts with its own `application_id` column-scoped `ON DELETE SET NULL` FK — deleting
-- an application whose research snapshot still references it fires an UPDATE (nulling just that
-- column) that `reject_immutable_row_mutation` then unconditionally rejects, which would make
-- deleting the application itself fail instead of the intended "the snapshot survives with
-- application_id nulled" (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §7). Caught live, before this
-- migration existed, by supabase/tests/database/0030_company_research.test.sql's own
-- application-delete-semantics assertions — this is the first table in this codebase that is both
-- immutable AND the target of a SET NULL FK, so the existing generic trigger function never had to
-- handle this combination before.
--
-- Fix: a table-specific trigger that allows exactly one transition — application_id moving from
-- non-null to null, with every other column unchanged — and rejects everything else with the
-- exact same message shape `reject_immutable_row_mutation` already uses, so this remains
-- observably "immutable" for every ordinary purpose (no content column, no user_id, no
-- job_snapshot_id, no timestamp can ever change) while still letting the one legitimate FK-cascade
-- update through.

create function public.reject_company_research_snapshot_mutation_except_application_unlink()
returns trigger
language plpgsql
as $$
begin
  if new.id = old.id
    and new.user_id = old.user_id
    and new.company_name = old.company_name
    and new.role_title = old.role_title
    and new.job_snapshot_id is not distinct from old.job_snapshot_id
    and new.researched_at = old.researched_at
    and new.created_at = old.created_at
    and old.application_id is not null
    and new.application_id is null
  then
    return new;
  end if;

  raise exception 'company_research_snapshots rows are immutable and cannot be updated (id=%)', old.id;
end;
$$;

drop trigger company_research_snapshots_block_update on public.company_research_snapshots;

create trigger company_research_snapshots_block_update
  before update on public.company_research_snapshots
  for each row execute function public.reject_company_research_snapshot_mutation_except_application_unlink();
