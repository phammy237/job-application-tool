-- Career OS — Phase 5B.1: frozen submission packets + the atomic canonical APPLIED transition.
--
-- Phase 5B.0 made markOwnApplicationApplied the one TypeScript-level canonical operation for
-- reaching APPLIED, but it was a plain multi-step client call (update, then a separate event
-- insert) — fine when it touched one table, not once packet creation joins the same transition.
-- This migration moves the whole transition into one Postgres function so there is never a
-- window where an application is APPLIED without a packet, or a packet exists without the
-- application actually being APPLIED. See docs/IMPLEMENTATION_PLAN.md Phase 5B.1 for the full
-- design rationale.
--
-- This migration does NOT touch 0001-0012. Every new object below is additive.

-- ================================================================================================
-- PART 1 — unique(user_id, id) on tables that need to be the parent side of a new composite FK
--
-- applications and resumes were never a composite-FK parent before now (job_snapshots and
-- requirement_mapping_runs already got this treatment in migration 0010 for the same reason).
-- id is already globally unique (primary key), so this is a cheap, non-breaking additive index —
-- Postgres requires a real unique constraint/index on the *exact* (user_id, id) column pair to
-- allow a composite FK to reference it, even though id alone already implies uniqueness.
-- ================================================================================================

alter table public.applications
  add constraint applications_user_id_id_key unique (user_id, id);

alter table public.resumes
  add constraint resumes_user_id_id_key unique (user_id, id);

-- ================================================================================================
-- PART 2 — submission_packets
--
-- Immutable, one row per application, created exactly once — at the first real transition into
-- APPLIED through the canonical operation below. A legacy application already APPLIED before this
-- migration existed has no packet and never retroactively gets a fabricated one (docs/
-- IMPLEMENTATION_PLAN.md Phase 5B.1 "legacy APPLIED" temporal invariant).
-- ================================================================================================

create table public.submission_packets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  -- Nullable: an application created manually on the dashboard (no jobId at all) has no snapshot;
  -- see docs/DATA_MODEL.md "applications.job_snapshot_id", already nullable for the same reason.
  job_snapshot_id uuid,
  -- Nullable: applications.resume_id has no real writer anywhere in this codebase today (Phase
  -- 5B.0 inspection) — never fabricated or defaulted, see Part 4 below.
  resume_id uuid,
  -- Nullable: only set when a CURRENT requirement_mapping_run exists for the linked snapshot at
  -- freeze time; not duplicated content, just a reference into an already-immutable table.
  requirement_mapping_run_id uuid,

  -- The literal, already-persisted generated_answers content for this application at freeze time
  -- — never a reconstruction from today's profile, never a fabricated AUTOFILL_BASIC value (see
  -- packages/shared's submissionPacketAnswerSchema and docs/IMPLEMENTATION_PLAN.md Phase 5B.1C
  -- for exactly what this does and does not capture).
  answers_snapshot jsonb not null default '[]',
  -- Copied from applications.autofill_summary/unresolved_fields at the moment of freezing — those
  -- two columns on `applications` remain ordinarily mutable after APPLIED (an extension "Save"
  -- overwrites them unconditionally regardless of status), so they are not a safe historical
  -- source on their own; this is the frozen copy.
  autofill_summary jsonb,
  unresolved_fields jsonb,

  -- The deterministic consistency-firewall findings (Phase 5B.2) computed and gated on at the
  -- exact moment this packet was created, and the user's acknowledgements of any WARNING findings
  -- — frozen exactly as they stood at submission time, never recomputed on read.
  consistency_findings jsonb not null default '[]',
  consistency_acknowledgements jsonb not null default '[]',

  content_fingerprint text not null,
  created_at timestamptz not null default now(),

  constraint submission_packets_answers_snapshot_is_array
    check (jsonb_typeof(answers_snapshot) = 'array'),
  constraint submission_packets_consistency_findings_is_array
    check (jsonb_typeof(consistency_findings) = 'array'),
  constraint submission_packets_consistency_acknowledgements_is_array
    check (jsonb_typeof(consistency_acknowledgements) = 'array'),
  constraint submission_packets_content_fingerprint_not_blank
    check (length(trim(content_fingerprint)) > 0),

  -- Exactly one packet per application, structurally enforced — not just application-layer
  -- discipline. The atomic RPC below additionally guards this with a row lock + existence check,
  -- so this index is the second, independent guarantee (same posture as Phase 5A's partial unique
  -- index on requirement_mapping_runs).
  constraint submission_packets_user_id_id_key unique (user_id, id),
  constraint submission_packets_application_id_key unique (user_id, application_id),

  -- Composite FKs: a cross-user link is structurally impossible, not merely checked in the RPC.
  constraint submission_packets_application_fkey
    foreign key (user_id, application_id) references public.applications (user_id, id),
  constraint submission_packets_job_snapshot_fkey
    foreign key (user_id, job_snapshot_id) references public.job_snapshots (user_id, id),
  constraint submission_packets_resume_fkey
    foreign key (user_id, resume_id) references public.resumes (user_id, id),
  constraint submission_packets_requirement_mapping_run_fkey
    foreign key (user_id, requirement_mapping_run_id)
    references public.requirement_mapping_runs (user_id, id)
);

create index submission_packets_user_id_idx on public.submission_packets (user_id);
create index submission_packets_application_id_idx on public.submission_packets (application_id);

-- Immutability, enforced at the database level against every role including service_role — reuses
-- the exact trigger function migration 0010 already defined (public.reject_immutable_row_mutation)
-- rather than redefining it; it is generic (keyed off TG_TABLE_NAME/old.id), not job_snapshots-
-- specific. DELETE is intentionally not blocked the same way, for the identical reason job_snapshots
-- leaves it unblocked: blocking it would also break the legitimate auth.users -> submission_packets
-- cascade on account deletion. The actual delete guarantee is the same as job_snapshots' — no RLS
-- delete policy for `authenticated` (below), and no Phase 5B code path issues a direct delete.
create trigger submission_packets_block_update
  before update on public.submission_packets
  for each row execute function public.reject_immutable_row_mutation();

alter table public.submission_packets enable row level security;

-- Same deliberate deviation as job_snapshots/requirement_evidence_mappings: select-only for
-- `authenticated`. No insert policy — a direct PostgREST insert would bypass the atomic
-- transition's ownership/idempotency/immutability guarantees entirely. All writes happen
-- exclusively through mark_application_applied (Part 4), which is service_role-only.
create policy "select own submission_packets" on public.submission_packets
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 3 — applications.submission_packet_id
-- ================================================================================================

alter table public.applications add column submission_packet_id uuid;

-- Postgres 15+'s column-scoped ON DELETE SET NULL, same pattern as job_snapshot_id in migration
-- 0010 — nulls only this one column, never user_id, if a packet were ever deleted (no code path
-- deletes one today; this is defensive, matching precedent).
alter table public.applications
  add constraint applications_submission_packet_id_fkey
  foreign key (user_id, submission_packet_id)
  references public.submission_packets (user_id, id)
  on delete set null (submission_packet_id);

create index applications_submission_packet_id_idx
  on public.applications (submission_packet_id);

-- ================================================================================================
-- PART 4 — mark_application_applied: the one atomic canonical APPLIED transition
--
-- Replaces Phase 5B.0's plain multi-step markOwnApplicationApplied (update, then a separate event
-- insert) — that was safe when it touched exactly one table, but is no longer sufficient now that
-- packet creation must be atomic with the status transition. This function performs the *entire*
-- transition — ownership verification, applied_at preservation, at-most-once packet creation,
-- status/pointer update, and conditional event recording — inside one transaction.
--
-- Deterministic consistency-firewall gating (Phase 5B.2: recomputing findings, rejecting on an
-- unacknowledged BLOCKING/WARNING finding) happens in TypeScript, immediately before this function
-- is called — the rule engine is explicitly pure/DB-free (docs/IMPLEMENTATION_PLAN.md Phase
-- 5B.2A), so it cannot run inside Postgres. This function trusts p_consistency_findings/
-- p_consistency_acknowledgements as already-validated, final content to freeze — it does not
-- re-derive or re-check them itself. That is safe because both the gating decision and this call
-- happen inside the same server-side request handler, with no client-controlled step in between.
--
-- p_answers_snapshot/p_autofill_summary/p_unresolved_fields/p_job_snapshot_id/p_resume_id/
-- p_requirement_mapping_run_id/p_content_fingerprint are only used the first time a packet is
-- created for this application (submission_packet_id is currently null); on every later call they
-- are accepted but ignored — the existing packet is reused as-is, never mutated, never replaced.
-- ================================================================================================

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
  p_content_fingerprint text
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
  -- Row-locked read scoped by BOTH id and user_id — this is the ownership check (this function
  -- runs via the service-role admin client, so RLS does not apply; it is the only enforcement
  -- point, same posture as every other Phase 4/5A service-role function). The lock serializes any
  -- concurrent call for the same application for the rest of this transaction, closing the retry/
  -- race window a bare "check then insert" from two separate statements would leave open.
  select * into v_app from public.applications
    where id = p_application_id and user_id = p_user_id
    for update;

  if not found then
    raise exception 'application % not found or not owned by this user', p_application_id;
  end if;

  -- CASE 2/5 — already APPLIED: a pure idempotent no-op. Nothing changes: no new packet (even a
  -- legacy application that predates packet support stays exactly as it is — never a fabricated
  -- packet from current state on a repeated call), no applied_at rewrite, no duplicate event.
  if v_app.status = 'APPLIED' then
    return query select
      v_app.id, v_app.status, v_app.applied_at, v_app.status, v_app.submission_packet_id, false;
    return;
  end if;

  -- applied_at represents the ORIGINAL submission timestamp, not the most recent toggle — set only
  -- the first time (still null), preserved on every subsequent real transition into APPLIED
  -- (covers CASE 4: e.g. INTERVIEW -> APPLIED again after an earlier APPLIED -> INTERVIEW move).
  v_applied_at := coalesce(v_app.applied_at, now());

  if v_app.submission_packet_id is null then
    -- CASE 1 (first-ever transition) or a legacy application transitioning into APPLIED for the
    -- first time under this operation (e.g. a pre-5B.1 APPLIED row that later moved away and is
    -- now genuinely being re-submitted) — create exactly one packet.
    insert into public.submission_packets (
      user_id, application_id, job_snapshot_id, resume_id, requirement_mapping_run_id,
      answers_snapshot, autofill_summary, unresolved_fields,
      consistency_findings, consistency_acknowledgements, content_fingerprint
    ) values (
      p_user_id, p_application_id, p_job_snapshot_id, p_resume_id, p_requirement_mapping_run_id,
      p_answers_snapshot, p_autofill_summary, p_unresolved_fields,
      p_consistency_findings, p_consistency_acknowledgements, p_content_fingerprint
    )
    returning id into v_packet_id;
    v_created := true;
  else
    -- CASE 4 — a packet already exists from an earlier real transition; reuse it verbatim. The
    -- immutable-row trigger would reject an update to it even if this code tried one.
    v_packet_id := v_app.submission_packet_id;
  end if;

  update public.applications
    set status = 'APPLIED', applied_at = v_applied_at, submission_packet_id = v_packet_id
    where id = p_application_id and user_id = p_user_id;

  -- Only a real transition reaches this line (the already-APPLIED case returned above), so this
  -- event is never spammed on an idempotent repeat — same "don't log a no-op transition"
  -- precedent as POST /api/applications and Phase 5B.0's markOwnApplicationApplied.
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
