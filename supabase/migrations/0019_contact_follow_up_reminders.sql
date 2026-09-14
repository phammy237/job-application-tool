-- Career OS — Phase 6C: explicit per-contact follow-up reminders.
--
-- A single nullable timestamp the user explicitly sets — Career OS never invents or infers this
-- date (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §4). No reminder table, no recurrence, no
-- reminder history: setting/clearing `follow_up_at` is ordinary contact editing, same posture as
-- every other mutable `contacts` column. The deterministic networking next-action engine
-- (packages/shared's `deriveNetworkingNextAction`) reads this column at request time — nothing
-- here persists a derived "next action" or "due" state, for the same synchronization reasons
-- Phase 5C's application next-action engine is never persisted either.
--
-- Deliberately NOT added, all confirmed premature by the same review that scoped this slice:
-- last_interaction_at (denormalized — the Phase 6B timeline query is already a single indexed
-- read), networking_priority/relationship_score (see CLAUDE.md-adjacent product principle: no
-- invented social-pressure metrics), next_action/next_action_due_at (derived, never persisted —
-- see above), any reminder/task table, any recurrence field.

alter table public.contacts add column follow_up_at timestamptz;

-- Backs both "contacts with a due follow-up" (packages/database's
-- listOwnContactsWithDueFollowUp — `where user_id = $1 and follow_up_at <= now() order by
-- follow_up_at`) and the ordinary "does this user have any reminders at all" check. Partial —
-- most contacts will never have a reminder set, so indexing only the rows that do keeps this
-- index small and keeps it exactly as targeted as the queries it serves.
create index contacts_user_id_follow_up_at_idx
  on public.contacts (user_id, follow_up_at)
  where follow_up_at is not null;

-- No RLS change: `follow_up_at` is an ordinary column on `contacts`, already covered by the
-- four-policy pattern migration 0017 established (`update own contacts` scopes by
-- `auth.uid() = user_id` regardless of which columns a given UPDATE touches) — verified directly
-- in supabase/tests/database/0023_contact_follow_up_reminders.test.sql, not just assumed.
