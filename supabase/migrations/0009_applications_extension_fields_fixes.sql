-- Career OS — Phase 4D: corrections to migration 0008
--
-- Migration 0008 (Phase 4C) was already committed to version control before these defects were
-- found — by that point it must be treated as immutable (a database that has already applied
-- it, or ever will from a checkout of that exact commit, needs a *forward* migration to reach
-- the corrected schema; rewriting 0008 in place would silently strand any such database, since
-- `supabase db push` tracks applied migrations by filename and would never re-run an edited
-- 0008). This migration is that forward correction, found and verified by exercising
-- upsert_application_from_extension against a real Postgres instance (docs/IMPLEMENTATION_PLAN.md
-- Phase 4D) — no mocked test caught any of these, since the hand-maintained
-- packages/database/src/types/database.types.ts agreed with the bugs rather than catching them.
--
-- Applying 0001–0009 in order to a brand-new database, and applying just this file to a
-- database already at 0008, both arrive at the identical end state — every statement below
-- only ever assumes 0008's original (committed) schema as its starting point.

-- 1. The RPC referenced applications.location from the start; migration 0008's `alter table`
--    list never actually added it.
alter table public.applications
  add column location text;

-- 2. 0008's canonical_url index didn't exclude rows already claimed by a distinct external_id.
--    Without that exclusion, two different requisitions that happen to share one generic
--    apply-page URL (canonicalizeUrl strips the query string entirely — see
--    packages/shared's doc comment) would collide on this index the moment the second one
--    tried to insert, even though the RPC's own tier-2 SELECT already knows to skip
--    external_id-having rows when matching. The index predicate and the query predicate have
--    to agree, or the index fires before the query logic ever gets a say.
drop index if exists public.applications_user_canonical_url_key;

create unique index applications_user_canonical_url_key
  on public.applications (user_id, canonical_url)
  where canonical_url is not null and external_id is null;

-- 3. Corrected upsert_application_from_extension — same signature and return shape as 0008's
--    version (CREATE OR REPLACE preserves existing grants), body hardened with:
--      - a pinned search_path (belt-and-suspenders alongside the fully-qualified table names
--        already used throughout, consistent with SECURITY INVOKER's reduced blast radius)
--      - an explicit job_id-ownership check: this function runs via the service-role admin
--        client (no RLS session — see apps/web/app/api/applications/route.ts), so it is the
--        only enforcement point for "does p_job_id actually belong to p_user_id," not RLS
--      - a bounded unique_violation retry loop (5 attempts) instead of an unconditional loop
--      - nullif-based normalization of blank external_id/canonical_url to null, so an empty
--        string can never masquerade as a real, distinct dedup key
create or replace function public.upsert_application_from_extension(
  p_user_id uuid,
  p_job_id uuid,
  p_company text,
  p_title text,
  p_location text,
  p_status text,
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
  previous_status text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_current_status text;
  v_next_status text;
  v_attempts int := 0;
begin
  if p_status not in ('SAVED', 'IN_PROGRESS') then
    raise exception 'upsert_application_from_extension only accepts SAVED or IN_PROGRESS, got %', p_status;
  end if;

  if p_job_id is not null and not exists (
    select 1 from public.jobs where id = p_job_id and user_id = p_user_id
  ) then
    raise exception 'job % not found or not owned by this user', p_job_id;
  end if;

  p_external_id := nullif(p_external_id, '');
  p_canonical_url := nullif(p_canonical_url, '');

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 5 then
      raise exception 'upsert_application_from_extension: too many unique_violation retries for user %', p_user_id;
    end if;

    v_id := null;

    if p_external_id is not null and p_ats_provider is not null then
      select id, status into v_id, v_current_status from public.applications
        where user_id = p_user_id and ats_provider = p_ats_provider and external_id = p_external_id
        for update;
    end if;

    if v_id is null and p_canonical_url is not null then
      select id, status into v_id, v_current_status from public.applications
        where user_id = p_user_id and canonical_url = p_canonical_url and external_id is null
        for update;
    end if;

    if v_id is null and p_canonical_url is null and p_external_id is null then
      select id, status into v_id, v_current_status from public.applications
        where user_id = p_user_id
          and canonical_url is null
          and external_id is null
          and lower(company) = lower(p_company)
          and lower(title) = lower(p_title)
        for update;
    end if;

    if v_id is not null then
      if v_current_status in ('SAVED', 'IN_PROGRESS') then
        v_next_status := p_status;
      else
        v_next_status := v_current_status;
      end if;

      update public.applications set
        job_id = coalesce(p_job_id, job_id),
        location = coalesce(p_location, location),
        status = v_next_status,
        source_url = coalesce(p_source_url, source_url),
        canonical_url = coalesce(p_canonical_url, canonical_url),
        ats_provider = coalesce(p_ats_provider, ats_provider),
        external_id = coalesce(p_external_id, external_id),
        autofill_summary = p_autofill_summary,
        unresolved_fields = p_unresolved_fields
        where id = v_id;

      return query select v_id, false, v_next_status, v_current_status;
      return;
    end if;

    begin
      insert into public.applications (
        user_id, job_id, company, title, location, status,
        source_url, canonical_url, ats_provider, external_id,
        autofill_summary, unresolved_fields
      ) values (
        p_user_id, p_job_id, p_company, p_title, p_location, p_status,
        p_source_url, p_canonical_url, p_ats_provider, p_external_id,
        p_autofill_summary, p_unresolved_fields
      )
      returning id into v_id;

      return query select v_id, true, p_status, null::text;
      return;
    exception when unique_violation then
      -- A concurrent call won the race and inserted the same (user_id, canonical_url) or
      -- (user_id, ats_provider, external_id) row between this call's SELECT and INSERT above —
      -- loop back around; the re-run SELECT will now find the row the other call just committed
      -- and this call will fall into the update branch instead.
      continue;
    end;
  end loop;
end;
$$;

revoke all on function public.upsert_application_from_extension from public;
grant execute on function public.upsert_application_from_extension to authenticated, service_role;
