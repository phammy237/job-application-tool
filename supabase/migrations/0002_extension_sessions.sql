-- Career OS — Phase 2: extension_sessions
--
-- Adds the extension_sessions table (docs/DATA_MODEL.md "extension_sessions") backing the
-- Chrome extension's bearer-token auth flow (docs/EXTENSION_DESIGN.md §4). The jobs table
-- already has its full extraction shape from 0001_init.sql — no change needed there.
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it.

-- ============================================================================================
-- extension_sessions
-- ============================================================================================

create table public.extension_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  device_label text,
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index extension_sessions_user_id_idx on public.extension_sessions (user_id);
create unique index extension_sessions_token_hash_key on public.extension_sessions (token_hash);

alter table public.extension_sessions enable row level security;

create policy "select own extension_sessions" on public.extension_sessions
  for select using (auth.uid() = user_id);
create policy "insert own extension_sessions" on public.extension_sessions
  for insert with check (auth.uid() = user_id);
create policy "update own extension_sessions" on public.extension_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own extension_sessions" on public.extension_sessions
  for delete using (auth.uid() = user_id);
