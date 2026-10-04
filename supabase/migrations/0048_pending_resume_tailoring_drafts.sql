-- Career OS — pending résumé tailoring drafts (D9 Phase B): the one new concept Phase B needs,
-- because Phase 7E/7F's tailoring pipeline (generateResumeTailoringPlan,
-- buildReviewedTailoredResume, save_reviewed_tailored_resume) was built fully synchronous and
-- ephemeral — it only ever runs from a live user click and persists nothing until the user's own
-- accept pass. Running it unattended from a cron job needs somewhere to put the result until the
-- user opens the review screen.
--
-- `proposal` stores the ENTIRE ResumeTailoringProposal (packages/shared) the exact same shape
-- POST /api/applications/:id/resume-tailoring already returns and ResumeTailoringReviewSession
-- already renders today — no new data model, no new review UI. Staleness uses the SAME anchors
-- save_reviewed_tailored_resume itself re-checks (proposal.baseResumeVersionId/jobSnapshotId
-- against the application's CURRENT working_resume_version_id/job_snapshot_id) — read at
-- consumption time from the stored jsonb, never a separate fingerprint column that could drift
-- out of sync with the one the save RPC actually trusts.
--
-- `unique(application_id)` — at most one pending draft per application; the orchestrator
-- (runAutoTailorDraftingForUser) skips generating a new one while one already exists rather than
-- silently overwriting a draft the user hasn't reviewed yet.
create table public.pending_resume_tailoring_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null unique references public.applications(id) on delete cascade,
  proposal jsonb not null,
  created_at timestamptz not null default now()
);

create index pending_resume_tailoring_drafts_user_id_idx
  on public.pending_resume_tailoring_drafts (user_id);

alter table public.pending_resume_tailoring_drafts enable row level security;

create policy "select own pending_resume_tailoring_drafts" on public.pending_resume_tailoring_drafts
  for select using (auth.uid() = user_id);
create policy "insert own pending_resume_tailoring_drafts" on public.pending_resume_tailoring_drafts
  for insert with check (auth.uid() = user_id);
create policy "update own pending_resume_tailoring_drafts" on public.pending_resume_tailoring_drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own pending_resume_tailoring_drafts" on public.pending_resume_tailoring_drafts
  for delete using (auth.uid() = user_id);
