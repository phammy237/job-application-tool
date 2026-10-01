-- ============================================================================================
-- 0044 — make the AI request quota server-authoritative.
--
-- Before this migration a signed-in user could raise or reset their own AI quota straight
-- through PostgREST with the public anon key and their own session — no app code involved:
--   * `update own user_settings` (0001) covered every column, so
--     `update user_settings set ai_request_limit = 999999` succeeded;
--   * `delete own user_settings` + `insert own user_settings` let them recreate the row with
--     ai_requests_this_period back at 0;
--   * increment/decrement_ai_request_usage are security invoker and were granted to
--     `authenticated`, so calling decrement in a loop zeroed the counter.
-- ai_request_limit is the one seam CLAUDE.md reserves for a future plan/billing system, and every
-- unit is a real Claude/Tavily call — the quota has to be enforced below the app, not by it.
--
-- After this migration:
--   * authenticated may UPDATE only the genuinely user-editable columns
--     (gmail_integration_enabled, theme) and may INSERT only a bare row (user_id alone — every
--     other column takes its default; the handle_new_user trigger already creates the row, this
--     only keeps getOrCreateOwnUserSettings' fallback working). No DELETE at all: the row is
--     removed by the auth.users cascade on account deletion.
--   * the quota RPCs are service-role only. Every packages/ai pipeline reserves/refunds quota
--     through the service-role client (apps/web routes pass createAdminClient() to the AI step),
--     and those calls always pass the session-derived user id.
-- The row-level policies from 0001 stay as they are — they still scope what's left to the
-- caller's own row; these privileges narrow *which columns/operations* that row allows.
-- ============================================================================================

revoke insert, update, delete on public.user_settings from anon, authenticated;
grant update (gmail_integration_enabled, theme) on public.user_settings to authenticated;
grant insert (user_id) on public.user_settings to authenticated;

revoke all on function public.increment_ai_request_usage(uuid, interval) from public, anon, authenticated;
grant execute on function public.increment_ai_request_usage(uuid, interval) to service_role;

revoke all on function public.decrement_ai_request_usage(uuid) from public, anon, authenticated;
grant execute on function public.decrement_ai_request_usage(uuid) to service_role;
