-- Career OS — Phase 5C.3: widen ai_usage_events.task_type for the two new explicit,
-- user-triggered AI action-assistance pipelines (packages/ai/src/generate-follow-up-draft.ts,
-- packages/ai/src/generate-interview-prep.ts). Same additive-widening shape as migration 0012
-- and 0014 before it — no new table, both pipelines are ephemeral (docs/IMPLEMENTATION_PLAN.md
-- "Phase 5C.3E"), so ai_usage_events is the only persisted trace of either at all.
--
-- Every value currently allowed by the constraint (verified against 0014, the most recent widening
-- of this same constraint, and against the live linked project) is preserved here — dropping and
-- recreating a CHECK constraint replaces the whole allowed set, so omitting even one existing
-- value here would silently reject every future insert of that type. See 0014's own comment for
-- why this matters (a live query caught a real gap when re-deriving from an earlier migration
-- alone).
alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in (
    'field_suggestion', 'requirement_mapping', 'email_classification', 'unsupported_claim_check',
    'follow_up_draft', 'interview_prep'
  ));
