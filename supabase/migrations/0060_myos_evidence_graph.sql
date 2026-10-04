-- myOS — evidence graph foundation.
--
-- myOS is the personal-evidence layer under Career OS. It REUSES the existing profile tables
-- (projects, skills, experiences, education) as graph nodes and adds:
--   myos_evidence      — provenance-bearing evidence items (GitHub repo/PR, note, link, ...).
--   myos_achievements  — achievements / awards / metrics / launches, optionally tied to a node.
--   myos_stories       — STAR interview stories.
--   myos_edges         — typed, provenance-bearing relationships between nodes.
--   myos_candidates    — INFERRED suggestions awaiting user confirmation (never silently trusted).
--   github_connections / github_credentials / github_repositories / github_sync_runs
--   portfolio_settings — explicit opt-in + API key hash for the PUBLIC export.
--
-- Migration numbered 0060+ on purpose: parallel in-flight branches use 0044–0047.
-- CLAUDE.md: every table ships with RLS in this same migration. github_credentials is the one
-- deliberate exception to "four policies": it is service-role-only (RLS on, zero policies), so
-- an encrypted token can never be selected through the anon/authenticated API at all.

-- ============================================================================================
-- Composite ownership keys on existing node tables (additive, lets edges/links FK safely)
-- ============================================================================================

alter table public.projects add constraint projects_user_id_id_key unique (user_id, id);
alter table public.skills add constraint skills_user_id_id_key unique (user_id, id);
alter table public.experiences add constraint experiences_user_id_id_key unique (user_id, id);
alter table public.education add constraint education_user_id_id_key unique (user_id, id);

-- ============================================================================================
-- Visibility + project/skill/experience enrichment (additive; defaults are the safe ones)
-- ============================================================================================

alter table public.projects
  add column status text check (status in ('IDEA', 'ACTIVE', 'COMPLETED', 'ARCHIVED')),
  add column summary text,
  add column collaborators text[] not null default '{}',
  add column talking_points text[] not null default '{}',
  add column origin text not null default 'MANUAL' check (origin in ('MANUAL', 'GITHUB', 'RESUME')),
  add column visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC'));

alter table public.skills
  add column visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC'));

alter table public.experiences
  add column visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC'));

-- ============================================================================================
-- Provenance guard helper
-- ============================================================================================
-- VERIFIED means "a trusted server-side process confirmed this against its source". An end user
-- (PostgREST role authenticated/anon) must never be able to self-forge it, so triggers below
-- reject end-user writes of VERIFIED evidence/edges, GITHUB_* evidence and GitHub ingestion
-- data. Ingestion (GitHub sync) runs through the service-role client (role service_role, or the
-- table owner) with an explicit user_id filter in application code. current_user cannot be
-- spoofed through JWT claims, unlike request.jwt.claims.
create or replace function public.myos_is_end_user()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user in ('authenticated', 'anon')
$$;

-- ============================================================================================
-- myos_evidence
-- ============================================================================================

create table public.myos_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in (
    'GITHUB_REPO', 'GITHUB_README', 'GITHUB_PR', 'GITHUB_COMMIT', 'RESUME', 'USER_NOTE',
    'LINK', 'DOCUMENT', 'AWARD', 'OTHER'
  )),
  -- Stable identifier within the source (e.g. 'owner/repo', 'owner/repo#12'); the idempotency key.
  source_ref text,
  source_url text,
  title text not null check (length(trim(title)) > 0),
  excerpt text check (excerpt is null or length(excerpt) <= 2000),
  occurred_at timestamptz,
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verification_state text not null check (verification_state in (
    'VERIFIED', 'INFERRED', 'USER_PROVIDED', 'AI_GENERATED'
  )),
  visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint myos_evidence_user_id_id_key unique (user_id, id)
);

create unique index myos_evidence_source_key
  on public.myos_evidence (user_id, source_type, source_ref) where source_ref is not null;
create index myos_evidence_user_id_idx on public.myos_evidence (user_id);

create trigger myos_evidence_set_updated_at
  before update on public.myos_evidence
  for each row execute function public.set_updated_at();

create or replace function public.myos_evidence_guard_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.myos_is_end_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.verification_state = 'VERIFIED' or new.source_type like 'GITHUB\_%' then
      raise exception 'myos_evidence: VERIFIED / GITHUB_* evidence is written by the server only'
        using errcode = '42501';
    end if;
  else
    if new.verification_state = 'VERIFIED' and old.verification_state <> 'VERIFIED' then
      raise exception 'myos_evidence: cannot promote evidence to VERIFIED' using errcode = '42501';
    end if;
    if new.source_type like 'GITHUB\_%' and new.source_type is distinct from old.source_type then
      raise exception 'myos_evidence: cannot change source_type to GITHUB_*' using errcode = '42501';
    end if;
    if (old.verification_state = 'VERIFIED' or old.source_type like 'GITHUB\_%')
       and (new.source_type is distinct from old.source_type
         or new.source_ref is distinct from old.source_ref
         or new.source_url is distinct from old.source_url) then
      raise exception 'myos_evidence: provenance of server-verified evidence is immutable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger myos_evidence_guard_provenance
  before insert or update on public.myos_evidence
  for each row execute function public.myos_evidence_guard_provenance();

alter table public.myos_evidence enable row level security;
create policy "select own myos_evidence" on public.myos_evidence
  for select using (auth.uid() = user_id);
create policy "insert own myos_evidence" on public.myos_evidence
  for insert with check (auth.uid() = user_id);
create policy "update own myos_evidence" on public.myos_evidence
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own myos_evidence" on public.myos_evidence
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- myos_achievements
-- ============================================================================================

create table public.myos_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  kind text not null default 'ACHIEVEMENT' check (kind in (
    'ACHIEVEMENT', 'AWARD', 'METRIC', 'LAUNCH', 'LEADERSHIP', 'MILESTONE'
  )),
  occurred_on date,
  -- Free text exactly as the user stated it ("30% faster builds"). A row with metric_text is
  -- only ever VERIFIED/USER_PROVIDED; the application layer refuses to surface a metric that
  -- has no supporting evidence edge.
  metric_text text,
  project_id uuid,
  experience_id uuid,
  verification_state text not null default 'USER_PROVIDED' check (verification_state in (
    'VERIFIED', 'INFERRED', 'USER_PROVIDED', 'AI_GENERATED'
  )),
  user_approved boolean not null default false,
  visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint myos_achievements_user_id_id_key unique (user_id, id),
  constraint myos_achievements_project_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id) on delete set null (project_id),
  constraint myos_achievements_experience_fkey
    foreign key (user_id, experience_id) references public.experiences (user_id, id) on delete set null (experience_id)
);

create index myos_achievements_user_id_idx on public.myos_achievements (user_id);

create trigger myos_achievements_set_updated_at
  before update on public.myos_achievements
  for each row execute function public.set_updated_at();

alter table public.myos_achievements enable row level security;
create policy "select own myos_achievements" on public.myos_achievements
  for select using (auth.uid() = user_id);
create policy "insert own myos_achievements" on public.myos_achievements
  for insert with check (auth.uid() = user_id);
create policy "update own myos_achievements" on public.myos_achievements
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own myos_achievements" on public.myos_achievements
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- myos_stories (STAR)
-- ============================================================================================

create table public.myos_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  situation text,
  task text,
  action text,
  result text,
  competencies text[] not null default '{}',
  themes text[] not null default '{}',
  verification_state text not null default 'USER_PROVIDED' check (verification_state in (
    'VERIFIED', 'INFERRED', 'USER_PROVIDED', 'AI_GENERATED'
  )),
  user_approved boolean not null default false,
  visibility text not null default 'PRIVATE'
    check (visibility in ('PRIVATE', 'CAREER_OS_ONLY', 'PUBLIC')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint myos_stories_user_id_id_key unique (user_id, id)
);

create index myos_stories_user_id_idx on public.myos_stories (user_id);
create index myos_stories_competencies_gin_idx on public.myos_stories using gin (competencies);

create trigger myos_stories_set_updated_at
  before update on public.myos_stories
  for each row execute function public.set_updated_at();

alter table public.myos_stories enable row level security;
create policy "select own myos_stories" on public.myos_stories
  for select using (auth.uid() = user_id);
create policy "insert own myos_stories" on public.myos_stories
  for insert with check (auth.uid() = user_id);
create policy "update own myos_stories" on public.myos_stories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own myos_stories" on public.myos_stories
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- myos_edges (typed relationships between nodes)
-- ============================================================================================

create table public.myos_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_type text not null check (from_type in (
    'PROJECT', 'EXPERIENCE', 'EDUCATION', 'SKILL', 'ACHIEVEMENT', 'STORY', 'EVIDENCE'
  )),
  from_id uuid not null,
  to_type text not null check (to_type in (
    'PROJECT', 'EXPERIENCE', 'EDUCATION', 'SKILL', 'ACHIEVEMENT', 'STORY', 'EVIDENCE'
  )),
  to_id uuid not null,
  relation text not null check (relation in (
    'DEMONSTRATES', 'USES', 'BELONGS_TO', 'SUPPORTS', 'REPRESENTS', 'REFERENCES'
  )),
  verification_state text not null check (verification_state in (
    'VERIFIED', 'INFERRED', 'USER_PROVIDED', 'AI_GENERATED'
  )),
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  note text,
  created_at timestamptz not null default now(),
  constraint myos_edges_no_self_loop check (not (from_type = to_type and from_id = to_id)),
  constraint myos_edges_unique unique (user_id, from_type, from_id, to_type, to_id, relation)
);

create index myos_edges_from_idx on public.myos_edges (user_id, from_type, from_id);
create index myos_edges_to_idx on public.myos_edges (user_id, to_type, to_id);

-- Resolves the table for a node type (null for unknown). Kept in one place so the endpoint
-- validator and the delete-cleanup triggers cannot drift apart.
create or replace function public.myos_node_table(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'PROJECT' then 'projects'
    when 'EXPERIENCE' then 'experiences'
    when 'EDUCATION' then 'education'
    when 'SKILL' then 'skills'
    when 'ACHIEVEMENT' then 'myos_achievements'
    when 'STORY' then 'myos_stories'
    when 'EVIDENCE' then 'myos_evidence'
  end
$$;

-- Both endpoints must exist and be owned by the edge's user. SECURITY INVOKER: under RLS the
-- lookup can only ever see the caller's own rows, so a foreign id looks like "does not exist".
create or replace function public.myos_edges_validate_endpoints()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_found boolean;
begin
  -- CHECK constraints run after BEFORE triggers, so guard against an unknown type here and
  -- raise the same clean check_violation instead of format()'s "null identifier" error.
  if public.myos_node_table(new.from_type) is null or public.myos_node_table(new.to_type) is null then
    raise exception 'myos_edges: unknown node type (% / %)', new.from_type, new.to_type
      using errcode = '23514';
  end if;

  execute format('select exists (select 1 from public.%I where id = $1 and user_id = $2)',
                 public.myos_node_table(new.from_type))
    into v_found using new.from_id, new.user_id;
  if not v_found then
    raise exception 'myos_edges: from endpoint % % not found for user', new.from_type, new.from_id
      using errcode = '23503';
  end if;

  execute format('select exists (select 1 from public.%I where id = $1 and user_id = $2)',
                 public.myos_node_table(new.to_type))
    into v_found using new.to_id, new.user_id;
  if not v_found then
    raise exception 'myos_edges: to endpoint % % not found for user', new.to_type, new.to_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger myos_edges_validate_endpoints
  before insert or update of from_type, from_id, to_type, to_id, user_id on public.myos_edges
  for each row execute function public.myos_edges_validate_endpoints();

create or replace function public.myos_edges_guard_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.myos_is_end_user() and new.verification_state = 'VERIFIED'
     and (tg_op = 'INSERT' or old.verification_state <> 'VERIFIED') then
    raise exception 'myos_edges: VERIFIED edges are written by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger myos_edges_guard_provenance
  before insert or update on public.myos_edges
  for each row execute function public.myos_edges_guard_provenance();

-- Polymorphic ids have no FK, so deleting a node must remove its edges explicitly.
create or replace function public.myos_edges_cleanup_on_node_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.myos_edges
   where user_id = old.user_id
     and ((from_type = tg_argv[0] and from_id = old.id)
       or (to_type = tg_argv[0] and to_id = old.id));
  return old;
end;
$$;

create trigger projects_myos_edges_cleanup after delete on public.projects
  for each row execute function public.myos_edges_cleanup_on_node_delete('PROJECT');
create trigger experiences_myos_edges_cleanup after delete on public.experiences
  for each row execute function public.myos_edges_cleanup_on_node_delete('EXPERIENCE');
create trigger education_myos_edges_cleanup after delete on public.education
  for each row execute function public.myos_edges_cleanup_on_node_delete('EDUCATION');
create trigger skills_myos_edges_cleanup after delete on public.skills
  for each row execute function public.myos_edges_cleanup_on_node_delete('SKILL');
create trigger myos_achievements_edges_cleanup after delete on public.myos_achievements
  for each row execute function public.myos_edges_cleanup_on_node_delete('ACHIEVEMENT');
create trigger myos_stories_edges_cleanup after delete on public.myos_stories
  for each row execute function public.myos_edges_cleanup_on_node_delete('STORY');
create trigger myos_evidence_edges_cleanup after delete on public.myos_evidence
  for each row execute function public.myos_edges_cleanup_on_node_delete('EVIDENCE');

alter table public.myos_edges enable row level security;
create policy "select own myos_edges" on public.myos_edges
  for select using (auth.uid() = user_id);
create policy "insert own myos_edges" on public.myos_edges
  for insert with check (auth.uid() = user_id);
create policy "update own myos_edges" on public.myos_edges
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own myos_edges" on public.myos_edges
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- myos_candidates (INFERRED suggestions awaiting confirmation)
-- ============================================================================================

create table public.myos_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('SKILL', 'TALKING_POINT', 'PROJECT_SUMMARY', 'COMPETENCY')),
  project_id uuid,
  -- e.g. { "skill": "FastAPI", "category": "FRAMEWORK" } — shape validated by Zod per kind.
  payload jsonb not null,
  evidence_ids uuid[] not null default '{}',
  rationale text,
  -- Idempotency: the same suggestion for the same project is never inserted twice.
  dedupe_key text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REJECTED')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint myos_candidates_user_id_id_key unique (user_id, id),
  constraint myos_candidates_dedupe_key unique (user_id, dedupe_key),
  constraint myos_candidates_project_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id) on delete cascade
);

create index myos_candidates_user_status_idx on public.myos_candidates (user_id, status);

-- evidence_ids is a bare uuid[] (no FK possible): every id must be evidence owned by the same user.
create or replace function public.myos_candidates_validate_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(new.evidence_ids) as e(id)
     where not exists (select 1 from public.myos_evidence ev where ev.id = e.id and ev.user_id = new.user_id)
  ) then
    raise exception 'myos_candidates: evidence_ids must reference evidence owned by the same user'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger myos_candidates_validate_evidence
  before insert or update of evidence_ids, user_id on public.myos_candidates
  for each row execute function public.myos_candidates_validate_evidence();

alter table public.myos_candidates enable row level security;
create policy "select own myos_candidates" on public.myos_candidates
  for select using (auth.uid() = user_id);
create policy "insert own myos_candidates" on public.myos_candidates
  for insert with check (auth.uid() = user_id);
create policy "update own myos_candidates" on public.myos_candidates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own myos_candidates" on public.myos_candidates
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- GitHub
-- ============================================================================================

-- One connection per user. A connection may be username-only (public data, no token).
create table public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_login text not null check (length(trim(github_login)) > 0),
  github_user_id bigint,
  has_token boolean not null default false,
  status text not null default 'CONNECTED' check (status in ('CONNECTED', 'ERROR', 'REVOKED')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger github_connections_set_updated_at
  before update on public.github_connections
  for each row execute function public.set_updated_at();

create or replace function public.github_connections_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.myos_is_end_user() and (
       tg_op = 'INSERT'
    or new.github_login is distinct from old.github_login
    or new.github_user_id is distinct from old.github_user_id
    or new.has_token is distinct from old.has_token) then
    raise exception 'github_connections: identity fields are written by the server only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger github_connections_guard
  before insert or update on public.github_connections
  for each row execute function public.github_connections_guard();

alter table public.github_connections enable row level security;
create policy "select own github_connections" on public.github_connections
  for select using (auth.uid() = user_id);
-- No end-user INSERT policy: a connection (github_login / github_user_id) is created by the
-- server (service role, explicit user_id filter), so a user cannot claim another GitHub identity.
create policy "update own github_connections" on public.github_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own github_connections" on public.github_connections
  for delete using (auth.uid() = user_id);

-- Service-role-only secret store: RLS enabled with NO policies, so anon/authenticated can
-- neither read nor write it. The token is AES-256-GCM encrypted (TOKEN_ENCRYPTION_KEY).
create table public.github_credentials (
  user_id uuid primary key references public.github_connections(user_id) on delete cascade,
  encrypted_access_token text not null,
  created_at timestamptz not null default now()
);
alter table public.github_credentials enable row level security;
revoke all on public.github_credentials from anon, authenticated;

create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  github_repo_id bigint not null,
  full_name text not null,
  description text,
  html_url text not null,
  is_private boolean not null default false,
  is_fork boolean not null default false,
  is_archived boolean not null default false,
  default_branch text,
  primary_language text,
  languages jsonb not null default '{}'::jsonb,
  topics text[] not null default '{}',
  stars int not null default 0,
  repo_created_at timestamptz,
  pushed_at timestamptz,
  readme_excerpt text check (readme_excerpt is null or length(readme_excerpt) <= 6000),
  readme_sha text,
  contributors jsonb not null default '[]'::jsonb,
  pr_count int not null default 0,
  commit_count int not null default 0,
  -- ETag of the repo metadata response; lets incremental sync send If-None-Match.
  etag text,
  -- Import is opt-in per repository: nothing becomes a project until the user selects it.
  selected boolean not null default false,
  project_id uuid,
  sync_status text not null default 'PENDING' check (sync_status in ('PENDING', 'SYNCED', 'ERROR')),
  sync_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_repositories_user_id_id_key unique (user_id, id),
  constraint github_repositories_repo_key unique (user_id, github_repo_id),
  constraint github_repositories_project_fkey
    foreign key (user_id, project_id) references public.projects (user_id, id) on delete set null (project_id)
);

create index github_repositories_user_id_idx on public.github_repositories (user_id);

create trigger github_repositories_set_updated_at
  before update on public.github_repositories
  for each row execute function public.set_updated_at();

-- End users may only toggle `selected` and link `project_id`; every other column is
-- server-ingested data (service role / owner bypass this check).
create or replace function public.github_repositories_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.myos_is_end_user() and
     (to_jsonb(new) - 'selected' - 'project_id' - 'updated_at')
       is distinct from (to_jsonb(old) - 'selected' - 'project_id' - 'updated_at') then
    raise exception 'github_repositories: only selected/project_id may be changed by the user'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger github_repositories_guard
  before update on public.github_repositories
  for each row execute function public.github_repositories_guard();

alter table public.github_repositories enable row level security;
create policy "select own github_repositories" on public.github_repositories
  for select using (auth.uid() = user_id);
-- No end-user INSERT policy: repository rows come from server-side ingestion only.
create policy "update own github_repositories" on public.github_repositories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own github_repositories" on public.github_repositories
  for delete using (auth.uid() = user_id);

create table public.github_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index github_sync_runs_user_started_idx on public.github_sync_runs (user_id, started_at desc);

alter table public.github_sync_runs enable row level security;
create policy "select own github_sync_runs" on public.github_sync_runs
  for select using (auth.uid() = user_id);
-- Sync runs are server-written (service role); end users may read and delete their own only.
create policy "delete own github_sync_runs" on public.github_sync_runs
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- portfolio_settings (explicit opt-in for the PUBLIC export)
-- ============================================================================================

create table public.portfolio_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  -- SHA-256 hex of the API key; the key itself is shown once and never stored.
  api_key_hash text unique,
  display_name text,
  headline text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger portfolio_settings_set_updated_at
  before update on public.portfolio_settings
  for each row execute function public.set_updated_at();

alter table public.portfolio_settings enable row level security;
create policy "select own portfolio_settings" on public.portfolio_settings
  for select using (auth.uid() = user_id);
create policy "insert own portfolio_settings" on public.portfolio_settings
  for insert with check (auth.uid() = user_id);
create policy "update own portfolio_settings" on public.portfolio_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own portfolio_settings" on public.portfolio_settings
  for delete using (auth.uid() = user_id);
