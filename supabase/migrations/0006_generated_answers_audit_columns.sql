-- Career OS — Phase 3: generated_answers audit/correlation columns
--
-- Adds the columns needed to later check whether the insufficientData self-report
-- (docs/AI_GROUNDING.md) is calibrated, and to join a persisted answer back to its
-- ai_usage_events telemetry rows for the same generation run — see 0005_ai_usage_events.sql's
-- comment: that table (and this correlation) is schema-level groundwork for a future
-- multi-provider routing system, not yet implemented.
--
-- generation_run_id/attempt_number are deliberately plain uuid/smallint columns, NOT a foreign
-- key to ai_usage_events — telemetry inserts are best-effort (see generate-suggestion.ts) and a
-- lost telemetry row must never be able to make a generated_answers write fail a constraint
-- check. The correlation remains usable even when one side of the join is missing.
--
-- All columns nullable: they only apply to rows this AI pipeline creates.

alter table public.generated_answers
  add column insufficient_data boolean,
  add column rejection_reason text check (rejection_reason in (
    'validation_failed', 'unknown_source_fact_id', 'unsupported_claims_present'
  )),
  add column available_fact_ids uuid[],
  add column generation_run_id uuid,
  add column attempt_number smallint check (attempt_number in (1, 2));
