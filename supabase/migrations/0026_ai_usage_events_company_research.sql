-- Career OS — Phase 7G: widen ai_usage_events.task_type for the new explicit, user-triggered
-- company-research synthesis pipeline (packages/ai/src/generate-company-research.ts). Same
-- additive-widening shape as migrations 0012/0014/0016/0023 before it — no new table needed for
-- this telemetry row; the *persisted result* of this pipeline is a real
-- `company_research_snapshots` row (migration 0025), which is new — this migration only widens
-- the existing generation-attempt telemetry, unlike 0023's pipeline which had no persisted result
-- of its own at all.
--
-- Every value currently allowed by the constraint (verified against the live linked project
-- before writing this migration, matching migration 0023 exactly plus 'resume_tailoring') is
-- preserved here — dropping and recreating a CHECK constraint replaces the whole allowed set, so
-- omitting even one existing value here would silently reject every future insert of that type.
--
-- No new rejection_reason value is needed: this pipeline's own validation failures (unknown
-- source id, unknown requirement id, zero findings) all map onto the same three existing
-- rejection_reason values every other pipeline's structural/unknown-id/unsupported-content
-- failures already use (see generate-company-research.ts's own outcome-mapping comment).
alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in (
    'field_suggestion', 'requirement_mapping', 'email_classification', 'unsupported_claim_check',
    'follow_up_draft', 'interview_prep', 'resume_tailoring', 'company_research'
  ));
