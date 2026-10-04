-- Career OS — Auto Mode (D9 Phase A): opt-in background auto-queue of high-match discovery jobs,
-- reviewed by the user from any device (/dashboard's new "Needs your review" section).
--
-- `auto_mode_enabled` follows the exact same column-privilege pattern 0046 established for
-- `background_gmail_tracking_enabled` — authenticated may update only this one additional column,
-- nothing else. Unlike Gmail tracking, enabling this has no prerequisite connection to check.
alter table public.user_settings
  add column auto_mode_enabled boolean not null default false;

grant update (auto_mode_enabled) on public.user_settings to authenticated;

-- `applications.auto_queued` — permanent provenance, never cleared: this application was created
-- by the Auto Mode cron job (runAutoQueueForUser) from a high-Match/high-Coverage/non-CONFLICT
-- `/discover` candidate, via the exact same `start_application_from_catalog_job` handoff a manual
-- "Start application" click already uses — never a new write path, never a new privilege surface.
-- `auto_queue_status` is the review lifecycle: NOT_APPLICABLE for every application that was never
-- auto-queued (the default, forever, for every pre-existing and every manually/extension-created
-- application); PENDING_REVIEW from the moment the cron job creates it; KEPT once the user
-- confirms they want to work on it (status stays SAVED, untouched — it becomes a completely
-- ordinary tracked application from that point on); DISMISSED once the user declines it (status
-- moves to WITHDRAWN via the existing changeOwnApplicationStatus, never a delete).
--
-- No new RLS policies are needed for either column — both tables already carry the standard
-- 4-policy RLS (migration 0001), and these are plain columns on existing, already-isolated rows.
alter table public.applications
  add column auto_queued boolean not null default false,
  add column auto_queue_status text not null default 'NOT_APPLICABLE' check (auto_queue_status in (
    'NOT_APPLICABLE', 'PENDING_REVIEW', 'KEPT', 'DISMISSED'
  ));

-- Keeps the two columns from ever disagreeing: a row that was never auto-queued can't carry a
-- review status, and a row that WAS auto-queued always carries a real one.
alter table public.applications add constraint applications_auto_queue_consistency_check
  check (
    (auto_queued = false and auto_queue_status = 'NOT_APPLICABLE')
    or (auto_queued = true and auto_queue_status <> 'NOT_APPLICABLE')
  );

-- `application_events.source` gains `AUTO_QUEUE` — deliberately NOT `SYSTEM`. `SYSTEM` is reserved
-- (packages/database/src/queries/application-events.ts, listOwnRelevantStatusChangeEvents) for
-- exactly one call site, revertApplicationEvent's own bookkeeping event, and is explicitly
-- excluded (`.neq('source', 'SYSTEM')`) from ever becoming a follow-up-anchor date — the auto-queue
-- cron job's own application-creation STATUS_CHANGE event (null -> SAVED) is a genuine, relevant
-- transition and must NOT be silently excluded the way overloading SYSTEM here would cause. This
-- mirrors the exact reasoning that already justified GMAIL_SYNC getting its own value instead of
-- overloading SYSTEM for background Gmail-sourced status changes.
alter table public.application_events drop constraint application_events_source_check;
alter table public.application_events add constraint application_events_source_check
  check (source in ('USER', 'GMAIL_SYNC', 'SYSTEM', 'AUTO_QUEUE'));

-- `start_application_from_catalog_job` (migration 0032) gains one new, defaulted parameter,
-- `p_event_source` — every existing call site (the manual /discover "Start application" click)
-- keeps getting the exact same 'USER' it always hardcoded, byte-for-byte, with no code change on
-- its end at all. The Auto Mode orchestrator (runAutoQueueForUser) is the one new caller that
-- passes 'AUTO_QUEUE' instead, so the events this function writes honestly reflect which pipeline
-- actually created them. `create or replace function` (not drop+create) preserves the function's
-- existing grants exactly as migration 0032 left them (service_role only) — no re-grant needed,
-- unlike list_own_discovery_feed's own migration, which had to drop+recreate because it changed
-- its RETURNS TABLE column list; this change only appends one defaulted input parameter, which
-- `create or replace function` supports without dropping the function at all.
create or replace function public.start_application_from_catalog_job(
  p_user_id uuid,
  p_job_catalog_id uuid,
  p_snapshot_company text,
  p_snapshot_title text,
  p_snapshot_location text,
  p_snapshot_employment_type text,
  p_snapshot_source_url text,
  p_snapshot_description text,
  p_snapshot_required_qualifications text[],
  p_snapshot_preferred_qualifications text[],
  p_snapshot_responsibilities text[],
  p_snapshot_skills text[],
  p_snapshot_salary_min numeric,
  p_snapshot_salary_max numeric,
  p_snapshot_salary_currency text,
  p_snapshot_locations text[],
  p_snapshot_work_mode text,
  p_snapshot_source_type text,
  p_snapshot_content_fingerprint text,
  p_snapshot_content_truncated boolean,
  p_snapshot_truncated_fields text[],
  p_canonical_url text,
  p_event_metadata jsonb,
  p_event_source text default 'USER'
)
returns table (
  application_id uuid,
  created boolean,
  -- See migration 0032's own comment on this same renaming — unchanged here.
  application_status text,
  job_snapshot_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
  v_existing_status text;
  v_snapshot_id uuid;
  v_id uuid;
  v_attempts int := 0;
begin
  if not exists (select 1 from public.job_catalog where id = p_job_catalog_id) then
    raise exception 'job_catalog % not found', p_job_catalog_id;
  end if;

  v_snapshot_id := public._upsert_job_snapshot(
    p_user_id, p_job_catalog_id, p_snapshot_company, p_snapshot_title, p_snapshot_location,
    p_snapshot_employment_type, p_snapshot_source_url, null, p_snapshot_description,
    p_snapshot_required_qualifications, p_snapshot_preferred_qualifications,
    p_snapshot_responsibilities, p_snapshot_skills, p_snapshot_salary_min, p_snapshot_salary_max,
    p_snapshot_salary_currency, p_snapshot_locations, p_snapshot_work_mode, null, null,
    p_snapshot_source_type, p_snapshot_content_fingerprint, p_snapshot_content_truncated,
    p_snapshot_truncated_fields
  );

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 5 then
      raise exception 'start_application_from_catalog_job: too many unique_violation retries for user %', p_user_id;
    end if;

    v_existing_id := null;
    v_existing_status := null;

    select app.id, app.status into v_existing_id, v_existing_status from public.applications app
      where app.user_id = p_user_id and app.job_catalog_id = p_job_catalog_id
      for update;

    if v_existing_id is not null then
      return query
        select v_existing_id, false, v_existing_status,
          (select app.job_snapshot_id from public.applications app where app.id = v_existing_id);
      return;
    end if;

    if p_canonical_url is not null then
      select app.id, app.status into v_existing_id, v_existing_status from public.applications app
        where app.user_id = p_user_id and app.canonical_url = p_canonical_url
          and app.external_id is null and app.job_catalog_id is null
        for update;
    end if;

    if v_existing_id is not null then
      update public.applications app
        set job_catalog_id = p_job_catalog_id,
            job_snapshot_id = case
              when app.status in ('SAVED', 'IN_PROGRESS') then v_snapshot_id
              else app.job_snapshot_id
            end
        where app.id = v_existing_id and app.user_id = p_user_id;

      insert into public.application_events (user_id, application_id, event_type, source, metadata)
        values (p_user_id, v_existing_id, 'DISCOVERY_HANDOFF', p_event_source, p_event_metadata);

      return query
        select v_existing_id, false, v_existing_status,
          (select app.job_snapshot_id from public.applications app where app.id = v_existing_id);
      return;
    end if;

    begin
      insert into public.applications (
        user_id, job_catalog_id, job_snapshot_id, company, title, location, status,
        source_url, canonical_url
      ) values (
        p_user_id, p_job_catalog_id, v_snapshot_id, p_snapshot_company, p_snapshot_title,
        p_snapshot_location, 'SAVED', p_snapshot_source_url, p_canonical_url
      )
      returning id into v_id;

      insert into public.application_events (user_id, application_id, event_type, from_status, to_status, source)
        values (p_user_id, v_id, 'STATUS_CHANGE', null, 'SAVED', p_event_source);
      insert into public.application_events (user_id, application_id, event_type, source, metadata)
        values (p_user_id, v_id, 'DISCOVERY_HANDOFF', p_event_source, p_event_metadata);

      return query select v_id, true, 'SAVED'::text, v_snapshot_id;
      return;
    exception when unique_violation then
      continue;
    end;
  end loop;
end;
$$;
