-- Career OS — fix increment_ai_request_usage's ambiguous column reference
--
-- 0004_increment_ai_request_usage.sql's RETURNS TABLE(...) declares OUT parameters
-- (ai_requests_this_period, ai_request_limit, ai_request_period_started_at) with the same
-- names as public.user_settings's real columns. PL/pgSQL's default variable_conflict='error'
-- then makes every bare reference to those names inside embedded SQL statements in the
-- function body ambiguous (could mean the OUT parameter or the table column), failing with
-- "column reference is ambiguous" (SQLSTATE 42702) the moment the function runs — confirmed by
-- running supabase/tests/database/0015_increment_ai_request_usage.test.sql against a real
-- database.
--
-- Fix: qualify every value-expression reference to these column names with the table's own
-- name (`user_settings.column`) so Postgres resolves them as columns unambiguously, rather than
-- relying on `set plpgsql.variable_conflict = use_column` — Supabase's migration role doesn't
-- have permission to set that GUC at the function level (SQLSTATE 42501, confirmed by trying).
-- No behavior changes beyond making the function actually able to run at all.

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
    set ai_requests_this_period = user_settings.ai_requests_this_period + 1
    where user_id = p_user_id
    returning
      user_settings.ai_requests_this_period,
      user_settings.ai_request_limit,
      user_settings.ai_request_period_started_at
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
