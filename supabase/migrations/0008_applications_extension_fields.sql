-- Career OS — Phase 4C: application-saving columns + duplicate-safe upsert
--
-- Adds the columns the extension's save flow needs (docs/IMPLEMENTATION_PLAN.md Phase 4C) —
-- no new table, reusing `applications` and its existing status enum (SAVED/IN_PROGRESS/APPLIED
-- already exist from Phase 1). Deliberately NOT storing raw HTML, DOM selectors, full
-- DetectedField/ReviewableField objects, or any sensitive field value — see the column comments
-- below and packages/shared/src/schemas/application.ts's autofillSummary/unresolvedFields
-- schemas for the exact shape enforced at the application layer.
--
-- CLAUDE.md: every user-owned table's migration ships its RLS/policies in the same PR that
-- creates it — `applications` already has both from migration 0001; this migration only adds
-- columns and indexes to an existing, already-RLS-enabled table, so no new policies are needed.

alter table public.applications
  -- Denormalized from the jobs row at save time (same pattern as the existing company/title
  -- denormalization) so the application record survives jobs.job_id being nulled on delete.
  add column source_url text,
  -- Normalized via packages/shared's canonicalizeUrl (query string, fragment, and trailing
  -- slash stripped) — the tier-2 duplicate-matching key. Never an executable selector or raw
  -- HTML, just a normalized string.
  add column canonical_url text,
  add column ats_provider text check (ats_provider in ('GENERIC', 'GREENHOUSE', 'LEVER', 'WORKDAY')),
  -- Requisition/job ID, when reliably detected — no current extractor populates this (Phase 2's
  -- GenericHtmlAdapter has no ATS-specific requisition-ID parsing, and none is added here; this
  -- migration only adds the column and its matching tier so a future adapter can populate it
  -- without another schema change).
  add column external_id text,
  -- Counts only — {approved, filled, skipped, failed, unresolved, manual}, validated by
  -- packages/shared's autofillSummarySchema. No per-field content.
  add column autofill_summary jsonb,
  -- Sanitized array of {label, classification, status, reason} — the field's own (non-sensitive)
  -- label/classification plus a category-level status/reason, never a value, never a DOM
  -- locator. Validated by packages/shared's unresolvedFieldSummarySchema.
  add column unresolved_fields jsonb;

-- Tier 1 and tier 2 duplicate-matching keys (see docs/IMPLEMENTATION_PLAN.md Phase 4C's
-- preferred matching order) — both partial so multiple applications with a null key don't
-- collide, and both backing upsert_application_from_extension's ON-CONFLICT-style retry below.
-- Tier 3 (company + title) is deliberately NOT a unique constraint here — a company/title match
-- alone can legitimately describe two different real openings, so collapsing it at the database
-- level would risk silently merging genuinely different applications. It's handled as a
-- best-effort, row-locked application-layer check inside the function below instead; see that
-- function's comment for the accepted race-window limitation this leaves.
create unique index applications_user_canonical_url_key
  on public.applications (user_id, canonical_url)
  where canonical_url is not null;

create unique index applications_user_provider_external_id_key
  on public.applications (user_id, ats_provider, external_id)
  where external_id is not null;

-- ================================================================================================
-- upsert_application_from_extension
--
-- Atomic create-or-update for the extension's save flow. Tries tier 1 (provider + external id),
-- then tier 2 (canonical url), then tier 3 (company + title, only when neither of the first two
-- is available) — first match wins, matching docs/IMPLEMENTATION_PLAN.md Phase 4C's preferred
-- order exactly. Never regresses a status the extension doesn't own the vocabulary for: once an
-- application has moved past SAVED/IN_PROGRESS (e.g. APPLIED, INTERVIEW, OFFER — reached via
-- "mark as applied" or the dashboard's own status changes), a plain save/update from the
-- extension leaves status untouched rather than resetting it backward.
--
-- Concurrency: tiers 1 and 2 are each backed by a real partial unique index above, so two
-- concurrent calls that both miss on SELECT and both attempt INSERT will have one succeed and
-- one raise unique_violation — caught below and retried as a lookup-then-update, closing the
-- race for the common cases (a URL or requisition ID is present). Tier 3 has no backing unique
-- index (by design, see above), so its race window is only as narrow as one function call's
-- internal `for update` row lock can make it — two truly simultaneous calls for a job with
-- neither a URL nor a requisition ID could still create two rows. This is the accepted,
-- documented limitation for that one fallback tier; every other path is race-free.
-- ================================================================================================

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
as $$
declare
  v_id uuid;
  v_current_status text;
  v_next_status text;
begin
  if p_status not in ('SAVED', 'IN_PROGRESS') then
    raise exception 'upsert_application_from_extension only accepts SAVED or IN_PROGRESS, got %', p_status;
  end if;

  loop
    v_id := null;

    if p_external_id is not null and p_ats_provider is not null then
      select id, status into v_id, v_current_status from public.applications
        where user_id = p_user_id and ats_provider = p_ats_provider and external_id = p_external_id
        for update;
    end if;

    if v_id is null and p_canonical_url is not null then
      select id, status into v_id, v_current_status from public.applications
        where user_id = p_user_id and canonical_url = p_canonical_url
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
