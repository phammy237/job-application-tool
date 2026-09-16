-- Career OS — Job Discovery Track, D6: discovery -> existing application workflow handoff.
--
-- Domain model preserved exactly as designed (docs/JOB_DISCOVERY.md "job_catalog is NOT jobs/
-- job_snapshots"): job_catalog stays the global, mutable "what jobs currently exist" table;
-- applications stays "one user's relationship with an opportunity." This migration adds a
-- nullable provenance link from the latter back to the former — never collapses them into one
-- table, never makes applications depend on job_catalog staying unchanged forever (job_catalog
-- rows are never hard-deleted by any existing D1-D3 code path — only status-transitioned
-- ACTIVE -> POSSIBLY_CLOSED -> CLOSED — but `on delete set null` below is the defensive answer
-- regardless, matching applications.job_id's own on-delete behavior).
--
-- Snapshot mechanism: reuses job_snapshots verbatim (no new "discovery snapshot" table).
-- job_snapshots.source_job_id has never been FK-enforced by design (migration 0010: "outlives
-- the jobs row it was captured from") — this migration extends that same deliberate looseness to
-- also honestly hold a job_catalog.id for discovery-originated snapshots, not only a jobs.id.

-- ================================================================================================
-- PART 1 — applications.job_catalog_id: durable catalog provenance.
--
-- Nullable — every existing application (manual, extension-created) keeps job_catalog_id = null
-- forever; no backfill, no retroactive matching (docs/JOB_DISCOVERY.md "Backward compatibility" —
-- company+title alone is never treated as proof of identity, and no speculative heuristic
-- matching is run against historical rows).
--
-- The partial unique index is the actual database-enforced idempotency guarantee for D6's handoff
-- (not merely a SELECT-then-INSERT in application code): a given user can have at most one
-- application linked to a given catalog opportunity. Partial (where job_catalog_id is not null)
-- for the same reason applications_user_canonical_url_key is partial — rows with no catalog
-- linkage at all (the overwhelming majority, pre-D6) must never collide with each other on a NULL
-- comparison; multiple NULLs never violate a unique index, but being explicit is clearer intent.
-- ================================================================================================

alter table public.applications
  add column job_catalog_id uuid references public.job_catalog(id) on delete set null;

create unique index applications_user_job_catalog_id_key
  on public.applications (user_id, job_catalog_id)
  where job_catalog_id is not null;

create index applications_job_catalog_id_idx on public.applications (job_catalog_id);

-- ================================================================================================
-- PART 2 — application_events: DISCOVERY_HANDOFF event type + bounded metadata column.
--
-- metadata is nullable and only ever populated by DISCOVERY_HANDOFF events in this phase — every
-- pre-existing event_type/row is completely unaffected. Bounded (4000 chars as text) so this can
-- never become a place to stash a full job description or any large payload
-- (docs/JOB_DISCOVERY.md "Application-event behavior" — provenance only: catalog job id, source
-- ATS, and a historical Match/Coverage/Eligibility snapshot with its version stamps — never
-- secrets, never the posting body).
-- ================================================================================================

alter table public.application_events
  drop constraint application_events_event_type_check;
alter table public.application_events
  add constraint application_events_event_type_check
  check (event_type in ('STATUS_CHANGE', 'NOTE', 'EMAIL_MATCHED', 'MANUAL_EDIT', 'DISCOVERY_HANDOFF'));

alter table public.application_events add column metadata jsonb;
alter table public.application_events
  add constraint application_events_metadata_bounded
  check (metadata is null or length(metadata::text) <= 4000);

-- ================================================================================================
-- PART 3 — job_snapshots.source_type: add ASHBY.
--
-- A real, pre-existing gap this migration is the first to actually hit: job_snapshots (and
-- jobs.platform_type / applications.ats_provider, both left untouched — D6 never writes to
-- either) have only ever accepted GENERIC/GREENHOUSE/LEVER/WORKDAY, predating D1-D3's Ashby
-- adapter. Every snapshot this migration's own RPC captures for an Ashby-sourced catalog job
-- needs to honestly record 'ASHBY', not be forced into a false 'GENERIC'/null. Purely additive —
-- every existing row/value keeps working unchanged.
-- ================================================================================================

alter table public.job_snapshots drop constraint job_snapshots_source_type_check;
alter table public.job_snapshots
  add constraint job_snapshots_source_type_check
  check (source_type in ('GENERIC', 'GREENHOUSE', 'LEVER', 'WORKDAY', 'ASHBY'));

-- ================================================================================================
-- PART 4 — start_application_from_catalog_job: the one canonical D6 handoff operation.
--
-- Mirrors upsert_application_with_snapshot's exact shape and trust boundary (migration 0010,
-- PART 8): SECURITY INVOKER, granted only to service_role, called via the admin client from a
-- route handler that has *already* verified the session (requireUser()) and passes the verified
-- userId explicitly — never accepted from the client, never re-derived from auth.uid() (which
-- would be null under the service-role call anyway). service-role access is required here for
-- exactly one structural reason: job_snapshots has no `authenticated` INSERT policy at all (only
-- SELECT — migration 0010 PART 1), so a SECURITY INVOKER function called via a session-scoped
-- client cannot write to it regardless of the function's own security label; this is the same
-- reason upsert_application_with_snapshot itself is service-role-only, not a new pattern.
--
-- status is hardcoded to the literal 'SAVED' below — there is no p_status parameter of any kind.
-- This is the actual, structural guarantee that D6 can never create an APPLIED application: not a
-- runtime check that could have a bug, but a value this function's signature cannot express. (A
-- second, independent backstop already exists regardless: migration 0015's
-- reject_direct_applied_transition trigger only exempts current_user = 'service_role' from its
-- APPLIED-transition guard, which this function's own role *is* — so even a hypothetical future
-- edit reintroducing a status parameter would still need to defeat that trigger too.)
--
-- Idempotency (docs/JOB_DISCOVERY.md "Idempotency guarantee"): tiered lookup, exactly the same
-- shape as upsert_application_from_extension's own tiering, locked with `for update` and wrapped
-- in a bounded unique_violation retry loop — the two partial unique indexes
-- (applications_user_job_catalog_id_key here, applications_user_canonical_url_key already
-- existing) are the real, database-enforced guarantee; the retry loop is what makes concurrent
-- calls converge safely onto whichever row wins the race, not merely "prevents an error."
--   Tier 1 (job_catalog_id match): this exact discovery opportunity is already tracked by this
--     user — return it, write nothing new.
--   Tier 2 (canonical_url match, external_id is null, job_catalog_id is null): an
--     extension-created application already exists at the identical canonicalized posting URL
--     and has never been linked to any catalog job — converge onto it (backfill job_catalog_id,
--     and job_snapshot_id only if the application hasn't yet moved past SAVED/IN_PROGRESS, the
--     exact same freeze rule upsert_application_with_snapshot already applies) rather than create
--     a second row for the same real-world posting (docs/JOB_DISCOVERY.md "Extension
--     interoperability"). Only linkage changes here — status is never touched.
--   Neither tier matches: insert a new SAVED application, record a STATUS_CHANGE event
--     (null -> SAVED, matching every other first-creation path in this codebase) and a
--     DISCOVERY_HANDOFF event carrying the caller-supplied provenance metadata.
-- No job_catalog_id ownership check is needed (unlike upsert_application_from_extension's
-- p_job_id check against the user-owned jobs table) — job_catalog has no user_id at all; any
-- authenticated user may reference any existing catalog row, which is the entire point of a
-- shared catalog. The only validation is that the row exists at all — deliberately not gated on
-- status (ACTIVE/POSSIBLY_CLOSED/CLOSED): a user may still want to track/record a job that closed
-- moments ago (docs/JOB_DISCOVERY.md "Catalog lifecycle behavior" has the full reasoning).
-- ================================================================================================

create function public.start_application_from_catalog_job(
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
  p_event_metadata jsonb
)
returns table (
  application_id uuid,
  created boolean,
  -- Named application_status, not status: plpgsql auto-declares every RETURNS TABLE output
  -- column as a local variable in the function body, and `status` is also a real column on
  -- `public.applications` this function repeatedly queries — bare `status` inside an embedded
  -- SQL statement would be genuinely ambiguous between the two (confirmed live: Postgres raises
  -- 42702 "column reference is ambiguous" the moment such a query runs). Renaming the output
  -- column sidesteps the whole class of bug at its source, rather than qualifying every
  -- reference to the table column everywhere in the body.
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

  -- Captured/deduped once up front, regardless of which branch below ends up using it —
  -- _upsert_job_snapshot has its own independent unique_violation retry loop, so this is safe to
  -- call unconditionally (same structure as upsert_application_with_snapshot's own call site).
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

    -- Every reference to `public.applications` below is explicitly aliased (`app`) and every
    -- column read through it explicitly qualified (`app.status`, `app.job_snapshot_id`, `app.id`)
    -- — plpgsql auto-declares each `returns table` output column (application_id, created,
    -- application_status, job_snapshot_id) as a local variable in this function's own scope, and
    -- a bare column reference matching one of those names inside an embedded SQL statement is
    -- genuinely ambiguous between the two (confirmed live: Postgres raises 42702 "column
    -- reference is ambiguous" the moment such a query runs) — qualifying every reference is the
    -- robust fix, not renaming one column and hoping no other collision remains.

    -- Tier 1: already linked to this exact catalog opportunity.
    select app.id, app.status into v_existing_id, v_existing_status from public.applications app
      where app.user_id = p_user_id and app.job_catalog_id = p_job_catalog_id
      for update;

    if v_existing_id is not null then
      return query
        select v_existing_id, false, v_existing_status,
          (select app.job_snapshot_id from public.applications app where app.id = v_existing_id);
      return;
    end if;

    -- Tier 2: an unlinked extension-created application at the identical canonical URL.
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
        values (p_user_id, v_existing_id, 'DISCOVERY_HANDOFF', 'USER', p_event_metadata);

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
        values (p_user_id, v_id, 'STATUS_CHANGE', null, 'SAVED', 'USER');
      insert into public.application_events (user_id, application_id, event_type, source, metadata)
        values (p_user_id, v_id, 'DISCOVERY_HANDOFF', 'USER', p_event_metadata);

      return query select v_id, true, 'SAVED'::text, v_snapshot_id;
      return;
    exception when unique_violation then
      -- A concurrent call won the race between this call's SELECTs and INSERT above — loop back
      -- around; the re-run tier-1/tier-2 SELECTs will now find the row the other call just
      -- committed and this call converges onto it instead.
      continue;
    end;
  end loop;
end;
$$;

revoke all on function public.start_application_from_catalog_job from public;
revoke all on function public.start_application_from_catalog_job from anon;
revoke all on function public.start_application_from_catalog_job from authenticated;
grant execute on function public.start_application_from_catalog_job to service_role;

-- ================================================================================================
-- PART 5 — list_own_discovery_feed: tracked-application state, joined once, no N+1.
--
-- Postgres cannot change a function's return-column list via CREATE OR REPLACE (only its body) —
-- the function must be dropped and recreated, which also drops its grants, so they're reapplied
-- below exactly as migration 0031 first established them (including the anon-specific revoke that
-- migration's own live verification found necessary — Supabase's platform-level default
-- privileges grant execute on every public function to anon directly, not just via the PUBLIC
-- pseudo-role).
--
-- The added LEFT JOIN uses the new applications_user_job_catalog_id_key partial index for an
-- efficient indexed lookup per row — never a second query per card, and it changes nothing about
-- ranking/filtering/pagination: the join is purely an additional pair of nullable output columns,
-- not a predicate, so application status can never affect which jobs are returned or their order
-- (docs/JOB_DISCOVERY.md "Discovery list integration" — Match ranking stays untouched by D6).
-- ================================================================================================

drop function public.list_own_discovery_feed(
  text, text[], text, text[], text[], text[], numeric, numeric, integer, integer, integer
);

create function public.list_own_discovery_feed(
  p_search text default null,
  p_role_families text[] default null,
  p_location_token text default null,
  p_workplace_types text[] default null,
  p_employment_types text[] default null,
  p_eligibility_statuses text[] default null,
  p_min_match numeric default null,
  p_min_coverage numeric default null,
  p_freshness_days integer default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  job_catalog_id uuid,
  title text,
  company_name text,
  location_text text,
  normalized_workplace_type text,
  normalized_employment_type text,
  role_family text,
  first_seen_at timestamptz,
  match_score numeric,
  coverage numeric,
  eligibility_status text,
  tracked_application_id uuid,
  tracked_application_status text
)
language sql
security invoker
stable
as $$
  select
    jc.id as job_catalog_id,
    jc.title,
    jc.company_name,
    jc.location_text,
    jcf.normalized_workplace_type,
    jcf.normalized_employment_type,
    jcf.role_family,
    jc.first_seen_at,
    ujms.match_score,
    ujms.coverage,
    ujms.eligibility_status,
    app.id as tracked_application_id,
    app.status as tracked_application_status
  from public.user_job_match_scores ujms
  join public.job_catalog jc on jc.id = ujms.job_catalog_id
  join public.job_catalog_features jcf on jcf.job_catalog_id = jc.id
  left join public.applications app
    on app.user_id = auth.uid() and app.job_catalog_id = jc.id
  where ujms.user_id = auth.uid()
    and (
      p_search is null or btrim(p_search) = '' or
      jc.title ilike '%' || p_search || '%' or
      jc.company_name ilike '%' || p_search || '%' or
      jc.location_text ilike '%' || p_search || '%'
    )
    and (p_role_families is null or jcf.role_family = any(p_role_families))
    and (p_location_token is null or jcf.location_tokens @> array[p_location_token])
    and (p_workplace_types is null or jcf.normalized_workplace_type = any(p_workplace_types))
    and (p_employment_types is null or jcf.normalized_employment_type = any(p_employment_types))
    and (p_eligibility_statuses is null or ujms.eligibility_status = any(p_eligibility_statuses))
    and (p_min_match is null or ujms.match_score >= p_min_match)
    and (p_min_coverage is null or ujms.coverage >= p_min_coverage)
    and (p_freshness_days is null or jc.first_seen_at >= now() - (p_freshness_days || ' days')::interval)
  order by ujms.coverage_bucket asc, ujms.match_score desc, jc.id asc
  limit least(greatest(coalesce(p_limit, 25), 0), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_own_discovery_feed from public;
revoke all on function public.list_own_discovery_feed from anon;
grant execute on function public.list_own_discovery_feed to authenticated;
