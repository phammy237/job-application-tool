-- ============================================================================================
-- 0000 — Data API default privileges, made explicit.
--
-- Every migration after this one was written against Supabase's legacy default: objects created
-- in `public` by `postgres` are automatically granted to the Data API roles (anon, authenticated,
-- service_role), and RLS policies do the actual per-row filtering. The hosted project still has
-- exactly these defaults (verified 2026-09-30 via information_schema.role_table_grants), so on it
-- this migration is a no-op.
--
-- Newer Supabase CLI/cloud defaults no longer auto-grant ("auto_expose_new_tables", deprecated,
-- removed 2026-10-30), so a freshly created database — `supabase start`, the CI `db-tests` job —
-- got no table grants at all and every test failed with "permission denied for table ..." before
-- RLS was ever evaluated. Declaring the defaults here makes every fresh database match
-- production regardless of the platform default.
--
-- Numbered 0000 so it runs before the tables it covers exist. Because it sorts before migrations
-- the hosted project already has, the first `supabase db push` after adding it needs
-- `--include-all`.
--
-- Narrower privileges are still applied per object by later migrations (e.g. 0044 restricts
-- user_settings to column-level grants) and always take precedence, since they run afterwards.
-- ============================================================================================

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
