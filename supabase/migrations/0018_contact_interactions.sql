-- Career OS — Phase 6B: contact interaction history.
--
-- Adds a factual, user-controlled record of past interactions with a contact (email, call,
-- coffee chat, meeting, LinkedIn message, event, introduction, note) — answers "what history do
-- I have with this person?" for a later Phase 6 slice (networking next actions, reminders,
-- Gmail-derived interactions, AI coffee-chat prep) to build on. This migration is deliberately
-- narrow — see docs/IMPLEMENTATION_PLAN.md "Phase 6B" for the full list of what's explicitly
-- deferred (follow_up_at, networking_reminders, a GMAIL_SIGNAL source, any AI). Nothing below
-- references any of those.
--
-- Ordinary private, user-editable CRM data — like contacts itself (not immutable-history like
-- job_snapshots/submission_packets): a user can freely correct or remove their own interaction
-- records, unlike Phase 5B's append-only/immutable semantics.
--
-- CLAUDE.md: ships with RLS enabled and the four standard policies in this same migration;
-- composite ownership FKs make a cross-user attachment (to someone else's contact OR someone
-- else's application) structurally impossible, not merely checked in application code.

create table public.contact_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null,
  -- The interaction's medium/type — not its purpose. THANK_YOU/REFERRAL_REQUEST/FOLLOW_UP
  -- describe *why* an interaction happened, which belongs in `subject`/`notes` (or a later,
  -- explicit purpose field if actually needed) — conflating the two here would make "log a call"
  -- ambiguous the moment that call was also a thank-you.
  interaction_type text not null check (interaction_type in (
    'EMAIL', 'CALL', 'COFFEE_CHAT', 'MEETING', 'LINKEDIN_MESSAGE', 'EVENT', 'INTRODUCTION',
    'NOTE', 'OTHER'
  )),
  -- Nullable — many interaction types have no natural direction (a coffee chat or meeting is
  -- inherently MUTUAL; a NOTE the user jots down about the contact has none at all). Never
  -- forced where it doesn't fit.
  direction text check (direction in ('INBOUND', 'OUTBOUND', 'MUTUAL')),
  -- When the interaction actually happened (user-editable, defaults to "now" in the UI) — not
  -- when the row was created. A user logging Tuesday's coffee chat on Thursday still wants
  -- Tuesday's date driving the timeline order.
  occurred_at timestamptz not null,
  subject text,
  notes text,
  -- Optional context linking this interaction to one of the user's applications — see the
  -- composite FK below for the ownership guarantee. Query-layer validation (packages/database's
  -- createOwnContactInteraction/updateOwnContactInteraction) additionally requires it be one of
  -- *this contact's* already-linked applications (an application_contacts row must already
  -- exist) — a business-rule check, not an ownership boundary, so it lives in application code
  -- the same way createOwnApplication's status guard does, not as a table constraint (a CHECK
  -- constraint can't reference another table, and this isn't a cross-user security concern the
  -- way the composite FK below is).
  application_id uuid,
  -- How this interaction row came to exist. Only MANUAL is supported in Phase 6B — the user's
  -- own "Log interaction" form. A future Gmail-derived source (e.g. GMAIL_SIGNAL) is added only
  -- when that feature actually ships, the same additive-widening posture as contacts.source and
  -- ai_usage_events.task_type before it.
  source text not null default 'MANUAL' check (source in ('MANUAL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FK: an interaction cannot reference a contact owned by a different user,
  -- structurally. Contact deletion cascades — the interaction is history *about* the contact and
  -- has no meaning once the contact is gone.
  constraint contact_interactions_contact_fkey
    foreign key (user_id, contact_id) references public.contacts (user_id, id) on delete cascade,

  -- Composite FK: an interaction cannot reference an application owned by a different user,
  -- structurally. Deliberately NOT on delete cascade — deleting an application must not erase a
  -- contact's real history with that person, so only `application_id` on this row is nulled
  -- (Postgres 15+'s column-scoped ON DELETE SET NULL for a composite FK, the same pattern
  -- migration 0013 already established for applications.submission_packet_id). user_id is
  -- structurally never touched: it isn't part of this FK's referenced-side match failing, and
  -- the column-scoped clause names only application_id.
  constraint contact_interactions_application_fkey
    foreign key (user_id, application_id) references public.applications (user_id, id)
    on delete set null (application_id)
);

-- Primary listing query: one contact's timeline, most recent first — see
-- packages/database's listOwnContactInteractions.
create index contact_interactions_user_id_contact_id_occurred_at_idx
  on public.contact_interactions (user_id, contact_id, occurred_at desc);

create trigger contact_interactions_set_updated_at
  before update on public.contact_interactions
  for each row execute function public.set_updated_at();

alter table public.contact_interactions enable row level security;

-- Ordinary mutable CRUD RLS — unlike contact_tags/application_contacts (Phase 6A), every column
-- here besides the primary key is real mutable payload (type, direction, occurred_at, subject,
-- notes, application_id), so update is a genuine row update, not a delete-then-insert. This is
-- personal CRM note-taking: users can correct mistakes freely, so there is no Phase 5B
-- immutable-history trigger here.
create policy "select own contact_interactions" on public.contact_interactions
  for select using (auth.uid() = user_id);
create policy "insert own contact_interactions" on public.contact_interactions
  for insert with check (auth.uid() = user_id);
create policy "update own contact_interactions" on public.contact_interactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own contact_interactions" on public.contact_interactions
  for delete using (auth.uid() = user_id);
