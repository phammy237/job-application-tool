-- Career OS — Phase 3: generated_answers
--
-- Adds the generated_answers table (docs/DATA_MODEL.md "generated_answers") backing
-- packages/ai's grounded suggestion pipeline (docs/AI_GROUNDING.md). A row with a non-empty
-- unsupported_claims array failed the rejection gate at generation time and must never be
-- surfaced to the user — packages/database's listOwnGeneratedAnswersForApplication filters
-- these out; they are kept only for audit (docs/DATA_MODEL.md's column note).
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it.

-- ============================================================================================
-- generated_answers
-- ============================================================================================

create table public.generated_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  field_label text not null,
  field_classification text not null check (field_classification in (
    'BASIC_PROFILE', 'EDUCATION', 'EXPERIENCE', 'SKILLS', 'WORK_AUTHORIZATION', 'RELOCATION',
    'COMPENSATION', 'FREE_RESPONSE', 'FILE_UPLOAD', 'DEMOGRAPHIC', 'LEGAL', 'AUTHENTICATION',
    'UNKNOWN'
  )),
  answer text not null,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  source_fact_ids uuid[] not null default '{}',
  reasoning_summary text,
  unsupported_claims text[] not null default '{}',
  requires_user_review boolean not null default true,
  user_decision text check (user_decision in ('APPROVED', 'EDITED', 'SKIPPED')),
  final_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index generated_answers_user_id_idx on public.generated_answers (user_id);
create index generated_answers_application_id_idx on public.generated_answers (application_id);

create trigger generated_answers_set_updated_at
  before update on public.generated_answers
  for each row execute function public.set_updated_at();

alter table public.generated_answers enable row level security;

create policy "select own generated_answers" on public.generated_answers
  for select using (auth.uid() = user_id);
create policy "insert own generated_answers" on public.generated_answers
  for insert with check (auth.uid() = user_id);
create policy "update own generated_answers" on public.generated_answers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own generated_answers" on public.generated_answers
  for delete using (auth.uid() = user_id);
