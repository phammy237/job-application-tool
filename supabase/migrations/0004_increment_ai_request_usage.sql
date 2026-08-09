-- Career OS — Phase 3: increment_ai_request_usage RPC
--
-- Closes the read-then-write race flagged in docs/SECURITY_AND_PRIVACY.md's rate-limit
-- enforcement risk: a plain "select ai_requests_this_period, then update if under limit" from
-- application code lets two concurrent requests both read the same pre-increment count and
-- both proceed. `select ... for update` locks the caller's user_settings row for the duration
-- of the transaction, so a second concurrent call blocks until the first commits — the
-- check-and-increment becomes atomic. Called by packages/database's
-- incrementOwnAiRequestUsage, in turn called by packages/ai before every suggestion attempt
-- (docs/AI_GROUNDING.md §7).

create or replace function public.increment_ai_request_usage(
  p_user_id uuid,
  p_period_length interval default '30 days'::interval
)
returns table (
  allowed boolean,
  ai_requests_this_period int,
  ai_request_limit int,
  ai_request_period_started_at timestamptz
)
language plpgsql
security invoker
as $$
declare
  v_row public.user_settings%rowtype;
begin
  select * into v_row from public.user_settings where user_id = p_user_id for update;

  if not found then
    insert into public.user_settings (user_id) values (p_user_id) returning * into v_row;
  end if;

  if v_row.ai_request_period_started_at <= now() - p_period_length then
    update public.user_settings
      set ai_requests_this_period = 0, ai_request_period_started_at = now()
      where user_id = p_user_id
      returning * into v_row;
  end if;

  if v_row.ai_requests_this_period >= v_row.ai_request_limit then
    return query select
      false,
      v_row.ai_requests_this_period,
      v_row.ai_request_limit,
      v_row.ai_request_period_started_at;
    return;
  end if;

  update public.user_settings
    set ai_requests_this_period = ai_requests_this_period + 1
    where user_id = p_user_id
    returning
      ai_requests_this_period,
      ai_request_limit,
      ai_request_period_started_at
    into
      v_row.ai_requests_this_period,
      v_row.ai_request_limit,
      v_row.ai_request_period_started_at;

  return query select
    true,
    v_row.ai_requests_this_period,
    v_row.ai_request_limit,
    v_row.ai_request_period_started_at;
end;
$$;

revoke all on function public.increment_ai_request_usage from public;
grant execute on function public.increment_ai_request_usage to authenticated, service_role;
