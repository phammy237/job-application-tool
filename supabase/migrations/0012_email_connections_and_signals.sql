-- Career OS — Phase 5: email_connections + email_signals (Gmail sync)
--
-- Both tables are "RLS: standard" per docs/DATA_MODEL.md — unlike Phase 5A's job_snapshots/
-- requirement_mapping_runs/requirement_evidence_mappings, there is no service-role-only RPC
-- boundary here. Gmail sync is a pure web-app feature (the extension is never involved), every
-- write happens through a normal RLS-scoped client from an authenticated web session, so the
-- standard four-policy pattern is sufficient and correct.
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it.

-- ================================================================================================
-- email_connections
-- ================================================================================================

create table public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gmail',
  email_address text not null,
  -- Encrypted at rest via packages/database's token-encryption.ts (AES-256-GCM, keyed by the
  -- server-only TOKEN_ENCRYPTION_KEY env var) — never plaintext, never returned by any API
  -- response. Must be decrypted to call Google's API, unlike extension_sessions.token_hash
  -- (one-way, comparison-only) — see docs/EMAIL_INTEGRATION.md §5.
  encrypted_refresh_token text not null,
  scopes text[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISCONNECTED', 'ERROR')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Lets email_signals reference (user_id, id) as a composite FK below, so a signal can never
  -- name a connection owned by a different user even under an application-layer bug.
  constraint email_connections_user_id_id_key unique (user_id, id),
  constraint email_connections_user_email_key unique (user_id, email_address)
);

create index email_connections_user_id_idx on public.email_connections (user_id);

alter table public.email_connections enable row level security;

create policy "select own email_connections" on public.email_connections
  for select using (auth.uid() = user_id);
create policy "insert own email_connections" on public.email_connections
  for insert with check (auth.uid() = user_id);
create policy "update own email_connections" on public.email_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own email_connections" on public.email_connections
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- email_signals
--
-- Deliberately minimal — never full email bodies (docs/EMAIL_INTEGRATION.md §3).
--
-- confirmation_status is an addition beyond the column list currently documented in
-- docs/DATA_MODEL.md (updated in this same PR) — without it, a user-declined low-confidence
-- match would resurface identically on every future sync with no way to distinguish "never
-- reviewed" from "explicitly declined, don't ask again." Direct precedent:
-- generated_answers.user_decision (APPROVED/EDITED/SKIPPED).
--   PENDING       — below the auto-apply threshold, awaiting user confirm/decline
--   CONFIRMED     — user confirmed a below-threshold match; an application_events row now exists
--   DECLINED      — user declined; application_events is never touched for this signal
--   AUTO_APPLIED  — met the >=0.85 combined-confidence threshold; already written to
--                   application_events (still visible + undoable, never silent)
--   NOT_APPLICABLE — no matched_application_id (zero-match) or classification = 'OTHER'
-- ================================================================================================

create table public.email_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_connection_id uuid not null,
  provider_message_id text not null,
  sender text,
  sender_domain text,
  subject text,
  received_at timestamptz,
  matched_application_id uuid references public.applications(id) on delete set null,
  classification text check (classification in (
    'APPLICATION_RECEIVED', 'ASSESSMENT', 'INTERVIEW', 'ACTION_REQUIRED', 'OFFER', 'REJECTED', 'OTHER'
  )),
  confidence numeric(3,2),
  evidence text,
  confirmation_status text not null default 'PENDING' check (confirmation_status in (
    'PENDING', 'CONFIRMED', 'DECLINED', 'AUTO_APPLIED', 'NOT_APPLICABLE'
  )),
  processed_at timestamptz not null default now(),

  constraint email_signals_user_id_id_key unique (user_id, id),
  constraint email_signals_connection_fkey
    foreign key (user_id, email_connection_id)
    references public.email_connections (user_id, id) on delete cascade,
  -- Dedup guarantee referenced in docs/EMAIL_INTEGRATION.md §1.9 — re-running sync never
  -- reprocesses or duplicates a message already seen.
  constraint email_signals_dedup_key unique (email_connection_id, provider_message_id)
);

create index email_signals_user_id_idx on public.email_signals (user_id);
create index email_signals_matched_application_id_idx on public.email_signals (matched_application_id);

alter table public.email_signals enable row level security;

create policy "select own email_signals" on public.email_signals
  for select using (auth.uid() = user_id);
create policy "insert own email_signals" on public.email_signals
  for insert with check (auth.uid() = user_id);
create policy "update own email_signals" on public.email_signals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own email_signals" on public.email_signals
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- application_events.email_signal_id had no FK yet — email_signals didn't exist when 0001_init.sql
-- added the column (see that file's comment immediately above the application_events table,
-- written in anticipation of exactly this migration).
-- ================================================================================================

alter table public.application_events
  add constraint application_events_email_signal_id_fkey
  foreign key (email_signal_id) references public.email_signals(id) on delete set null;

-- ================================================================================================
-- ai_usage_events.task_type — add 'email_classification' alongside the existing values, same
-- pattern used in 0010 to add 'requirement_mapping' to the original 0005 constraint.
-- ================================================================================================

alter table public.ai_usage_events drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events add constraint ai_usage_events_task_type_check
  check (task_type in ('field_suggestion', 'requirement_mapping', 'email_classification'));
