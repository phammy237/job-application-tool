-- Career OS — AI request quota accounting fix (production incident, real personal-beta account)
--
-- Real evidence from the linked production project: the one real account (the only
-- user_settings row with gmail_integration_enabled = true) had ai_requests_this_period = 50 of
-- 50, entirely consumed by 50 consecutive email_classification ai_usage_events, every single one
-- with outcome = 'provider_error' (a genuine Claude API authentication failure — not a user
-- action, not a contract rejection, not a refusal). increment_ai_request_usage (0004/0007) is
-- called, and spends one unit, BEFORE the provider is ever reached — so a systemically failing
-- provider call (auth/network/5xx, never even a real model response) permanently burned the
-- user's entire shared quota with zero legitimate AI usage, silently locking out every other
-- AI-assisted feature (Company Research, Requirements & evidence, résumé tailoring, ...) that
-- shares the same pool. Not development/test pollution — every other user_settings row (all
-- disposable live-verification accounts from D4-D6) sits at 0, untouched.
--
-- Fix, not just a reset: a request that never got a real response from the provider didn't cost
-- anything and didn't use the service in any meaningful sense, so it should not permanently spend
-- the user's quota. `decrement_ai_request_usage` gives back the one unit
-- `increment_ai_request_usage` pre-emptively reserved, called by every packages/ai generator
-- (generate-suggestion, generate-email-classification, generate-company-research,
-- generate-requirement-mapping, generate-resume-tailoring-plan, generate-follow-up-draft,
-- generate-interview-prep, generate-unsupported-claims-check) specifically and only on a
-- provider_error outcome — never on accepted/rejected/refusal, which all represent a real
-- response Claude actually returned. This still preserves the atomic check-and-reserve
-- concurrency guard (a burst of concurrent requests still can't all sneak through before any of
-- them completes) while no longer punishing the user for a provider-side failure.
--
-- Also raises the shared default limit from 50 to 150 per 30-day period: 50 was never sized
-- against real multi-feature usage (docs/AI_GROUNDING.md §7's shared pool) — a single real
-- application-review session alone (per-field suggestions across one job's form, one company
-- research, one requirements/evidence pass) can reasonably spend 10-15 units, and the pool is
-- also shared with the automatic, per-email Gmail sync classifier. 150/30 days (~5/day) stays a
-- real, protective ceiling — nowhere near unlimited — while comfortably covering genuine personal
-- daily use across every AI-assisted feature. Not a blind bump: sized against the task list
-- above, not picked arbitrarily.

create or replace function public.decrement_ai_request_usage(
  p_user_id uuid
)
returns void
language plpgsql
security invoker
as $$
begin
  update public.user_settings
    set ai_requests_this_period = greatest(user_settings.ai_requests_this_period - 1, 0)
    where user_id = p_user_id;
end;
$$;

revoke all on function public.decrement_ai_request_usage from public;
grant execute on function public.decrement_ai_request_usage to authenticated, service_role;

alter table public.user_settings alter column ai_request_limit set default 150;

-- Bump every row still sitting at the untouched old default — there is no UI to set a custom
-- per-user limit today, so every existing row is at 50 for the same reason (never deliberately
-- overridden); this never touches a row a future feature might have set to something else.
update public.user_settings set ai_request_limit = 150 where ai_request_limit = 50;

-- One-time correction, not a blind reset: recomputes each still-active period's count under the
-- corrected policy above (provider_error no longer counts) from the real ai_usage_events log,
-- rather than zeroing every row indiscriminately. A period that has already expired is left
-- alone — increment_ai_request_usage resets it to 0 the next time it's actually used, same as
-- today.
update public.user_settings us
set ai_requests_this_period = coalesce((
  select count(*)::int
  from public.ai_usage_events e
  where e.user_id = us.user_id
    and e.created_at >= us.ai_request_period_started_at
    and e.outcome <> 'provider_error'
), 0)
where us.ai_request_period_started_at > now() - interval '30 days';
