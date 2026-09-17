-- Career OS — Resume Import: widen ai_usage_events.task_type for the new explicit,
-- user-triggered résumé-extraction structuring pipeline
-- (packages/ai/src/generate-resume-extraction.ts). Same additive-widening shape as migrations
-- 0012/0014/0016/0023/0026 before it.
--
-- Every value currently allowed by the constraint (matching migration 0026 exactly plus
-- 'resume_extraction') is preserved here — dropping and recreating a CHECK constraint replaces
-- the whole allowed set, so omitting even one existing value here would silently reject every
-- future insert of that type.
alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in (
    'field_suggestion', 'requirement_mapping', 'email_classification', 'unsupported_claim_check',
    'follow_up_draft', 'interview_prep', 'resume_tailoring', 'company_research', 'resume_extraction'
  ));
