-- Career OS — Phase 5B.3: widen ai_usage_events.task_type for the new explicit, user-triggered
-- unsupported-claim check (packages/ai/src/generate-unsupported-claims-check.ts). Same additive
-- widening migration 0010 Part 6 already did once for 'requirement_mapping' — no new table, no
-- new run-lifecycle table: this check is deliberately ephemeral (docs/IMPLEMENTATION_PLAN.md
-- Phase 5B.3E), so ai_usage_events is the only persisted trace of it at all.

-- Migration 0012 already widened this once to add 'email_classification' alongside 0010's
-- 'field_suggestion'/'requirement_mapping' — all three must be preserved here, not just 0010's
-- original two (a live query against the linked project caught this: 25 real email_classification
-- rows already exist from Phase 5's Gmail sync verification, which a re-derivation from 0010
-- alone would have missed).
alter table public.ai_usage_events
  drop constraint ai_usage_events_task_type_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_task_type_check
  check (task_type in (
    'field_suggestion', 'requirement_mapping', 'email_classification', 'unsupported_claim_check'
  ));
