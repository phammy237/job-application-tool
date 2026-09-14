-- Career OS — Phase 7E: widen ai_usage_events.task_type for the new explicit, user-triggered
-- grounded résumé-tailoring pipeline (packages/ai/src/generate-resume-tailoring-plan.ts). Same
-- additive-widening shape as migrations 0012/0014/0016 before it — no new table; this pipeline is
-- fully ephemeral (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §21/§45: no ResumeTailoringPlan/Proposal
-- is ever persisted), so ai_usage_events is the only durable trace of a generation attempt at all.
--
-- Every value currently allowed by the constraint (verified against the live linked project
-- before writing this migration, per docs/IMPLEMENTATION_PLAN.md "Phase 7E" §57 — confirmed to
-- match migration 0016 exactly) is preserved here — dropping and recreating a CHECK constraint
-- replaces the whole allowed set, so omitting even one existing value here would silently reject
-- every future insert of that type.
--
-- No new rejection_reason value is needed: resume-tailoring's own validation failures (unknown
-- id, operation conflict, invalid target index, ungrounded number/technology) all map onto the
-- three existing rejection_reason values already covering every other pipeline's structural,
-- unknown-id, and unsupported-content failures (see generate-resume-tailoring-plan.ts's own doc
-- comment for the exact mapping) — rejection_reason's CHECK constraint is left untouched here.
alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in (
    'field_suggestion', 'requirement_mapping', 'email_classification', 'unsupported_claim_check',
    'follow_up_draft', 'interview_prep', 'resume_tailoring'
  ));
