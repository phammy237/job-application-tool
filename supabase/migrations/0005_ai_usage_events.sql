-- Career OS — Phase 4: ai_usage_events
--
-- Records every AI provider attempt (and the deterministic short-circuit, and a deliberately
-- skipped escalation slot) made by packages/ai's multi-provider suggestion pipeline, so
-- cost-per-user/application/task/model, provider failure rate, grounding-gate rejection rate,
-- and how-often-and-why Luna escalates to Sonnet are all answerable from real data. See the
-- Phase 4 routing plan and docs/AI_GROUNDING.md.
--
-- Append-only, matching 0001_init.sql's application_events convention: no updated_at/trigger.
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it.

-- ============================================================================================
-- ai_usage_events
-- ============================================================================================

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  generation_run_id uuid not null,
  attempt_number smallint not null check (attempt_number in (1, 2)),
  ladder text not null check (ladder in ('deterministic', 'normal', 'premium')),
  field_classification text not null check (field_classification in (
    'BASIC_PROFILE', 'EDUCATION', 'EXPERIENCE', 'SKILLS', 'WORK_AUTHORIZATION', 'RELOCATION',
    'COMPENSATION', 'FREE_RESPONSE', 'FILE_UPLOAD', 'DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION',
    'UNKNOWN'
  )),
  provider text check (provider in ('anthropic', 'openai')),
  model text,
  task_type text not null check (task_type in ('field_suggestion')),
  provider_succeeded boolean,
  outcome text not null check (outcome in (
    'accepted', 'rejected', 'escalated', 'refusal', 'provider_error', 'skipped', 'deterministic'
  )),
  rejection_reason text check (rejection_reason in (
    'validation_failed', 'unknown_source_fact_id', 'unsupported_claims_present'
  )),
  escalation_reason text check (escalation_reason in (
    'low_confidence', 'retryable_rejection', 'provider_error', 'refusal'
  )),
  input_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost numeric(10, 6),
  latency_ms int,
  created_at timestamptz not null default now()
);

create index ai_usage_events_user_id_idx on public.ai_usage_events (user_id);
create index ai_usage_events_application_id_idx on public.ai_usage_events (application_id);
create index ai_usage_events_generation_run_id_idx on public.ai_usage_events (generation_run_id);

alter table public.ai_usage_events enable row level security;

create policy "select own ai_usage_events" on public.ai_usage_events
  for select using (auth.uid() = user_id);
create policy "insert own ai_usage_events" on public.ai_usage_events
  for insert with check (auth.uid() = user_id);
create policy "update own ai_usage_events" on public.ai_usage_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own ai_usage_events" on public.ai_usage_events
  for delete using (auth.uid() = user_id);
