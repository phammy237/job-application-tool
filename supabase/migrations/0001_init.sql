-- Career OS — Phase 1 schema
--
-- Implements docs/DATA_MODEL.md for the Phase 1 subset of tables: profiles, candidate_facts,
-- experiences, education, projects, skills, resumes, jobs (minimal shape), applications,
-- application_events, user_settings, feature_flags.
--
-- Deferred to later migrations: generated_answers (Phase 3), extension_sessions (Phase 2),
-- email_connections / email_signals (Phase 5) — see docs/IMPLEMENTATION_PLAN.md.
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it. There is no table below that a user's data can end up
-- in without a user_id scoping it and a matching policy.

-- ============================================================================================
-- Extensions
-- ============================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================================
-- Shared helper: maintain updated_at on every table that has one
-- ============================================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================================
-- profiles
-- ============================================================================================

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  headline text,
  email text,
  phone text,
  location text,
  work_authorization text,
  relocation_preference text,
  links jsonb not null default '{}'::jsonb,
  public_slug text,
  visible_on_public_profile boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_public_slug_key
  on public.profiles (public_slug)
  where public_slug is not null;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "select own profile" on public.profiles
  for select using (auth.uid() = user_id);
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own profile" on public.profiles
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- resumes  (table only — upload UI and extraction pipeline land in a later phase)
-- ============================================================================================

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  label text,
  is_primary boolean not null default false,
  extraction_status text not null default 'PENDING'
    check (extraction_status in ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED')),
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resumes_user_id_idx on public.resumes (user_id);

create trigger resumes_set_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

alter table public.resumes enable row level security;

create policy "select own resumes" on public.resumes
  for select using (auth.uid() = user_id);
create policy "insert own resumes" on public.resumes
  for insert with check (auth.uid() = user_id);
create policy "update own resumes" on public.resumes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own resumes" on public.resumes
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- candidate_facts
-- ============================================================================================

create table public.candidate_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'EDUCATION', 'EXPERIENCE', 'LEADERSHIP', 'RESEARCH', 'PROJECT', 'SKILL', 'LANGUAGE',
    'CERTIFICATION', 'AWARD', 'WORK_AUTHORIZATION', 'LOCATION_PREFERENCE',
    'RELOCATION_PREFERENCE', 'LINK', 'CONTACT'
  )),
  title text not null,
  normalized_value text not null,
  source_text text,
  source_resume_id uuid references public.resumes(id) on delete set null,
  user_approved boolean not null default false,
  approved_for_applications boolean not null default false,
  visible_on_public_profile boolean not null default false,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidate_facts_user_id_idx on public.candidate_facts (user_id);
create index candidate_facts_user_id_category_idx on public.candidate_facts (user_id, category);
create index candidate_facts_tags_gin_idx on public.candidate_facts using gin (tags);

create trigger candidate_facts_set_updated_at
  before update on public.candidate_facts
  for each row execute function public.set_updated_at();

alter table public.candidate_facts enable row level security;

create policy "select own candidate_facts" on public.candidate_facts
  for select using (auth.uid() = user_id);
create policy "insert own candidate_facts" on public.candidate_facts
  for insert with check (auth.uid() = user_id);
create policy "update own candidate_facts" on public.candidate_facts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own candidate_facts" on public.candidate_facts
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- experiences
-- ============================================================================================

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_fact_id uuid references public.candidate_facts(id) on delete set null,
  company text not null,
  title text not null,
  location text,
  employment_type text,
  start_date date,
  end_date date,
  description text,
  tags text[] not null default '{}',
  user_approved boolean not null default false,
  approved_for_applications boolean not null default false,
  visible_on_public_profile boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index experiences_user_id_idx on public.experiences (user_id);
create index experiences_user_id_start_date_idx on public.experiences (user_id, start_date desc);
create index experiences_tags_gin_idx on public.experiences using gin (tags);

create trigger experiences_set_updated_at
  before update on public.experiences
  for each row execute function public.set_updated_at();

alter table public.experiences enable row level security;

create policy "select own experiences" on public.experiences
  for select using (auth.uid() = user_id);
create policy "insert own experiences" on public.experiences
  for insert with check (auth.uid() = user_id);
create policy "update own experiences" on public.experiences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own experiences" on public.experiences
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- education
-- ============================================================================================

create table public.education (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_fact_id uuid references public.candidate_facts(id) on delete set null,
  school text not null,
  degree text,
  field_of_study text,
  start_date date,
  graduation_date date,
  gpa text,
  honors text[] not null default '{}',
  user_approved boolean not null default false,
  approved_for_applications boolean not null default false,
  visible_on_public_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index education_user_id_idx on public.education (user_id);

create trigger education_set_updated_at
  before update on public.education
  for each row execute function public.set_updated_at();

alter table public.education enable row level security;

create policy "select own education" on public.education
  for select using (auth.uid() = user_id);
create policy "insert own education" on public.education
  for insert with check (auth.uid() = user_id);
create policy "update own education" on public.education
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own education" on public.education
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- projects
-- ============================================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_fact_id uuid references public.candidate_facts(id) on delete set null,
  name text not null,
  description text,
  role text,
  start_date date,
  end_date date,
  url text,
  tags text[] not null default '{}',
  user_approved boolean not null default false,
  approved_for_applications boolean not null default false,
  visible_on_public_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);
create index projects_tags_gin_idx on public.projects using gin (tags);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy "select own projects" on public.projects
  for select using (auth.uid() = user_id);
create policy "insert own projects" on public.projects
  for insert with check (auth.uid() = user_id);
create policy "update own projects" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own projects" on public.projects
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- skills
-- ============================================================================================

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_fact_id uuid references public.candidate_facts(id) on delete set null,
  name text not null,
  category text,
  proficiency text,
  user_approved boolean not null default false,
  approved_for_applications boolean not null default false,
  visible_on_public_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index skills_user_id_idx on public.skills (user_id);
create unique index skills_user_id_lower_name_key on public.skills (user_id, lower(name));

create trigger skills_set_updated_at
  before update on public.skills
  for each row execute function public.set_updated_at();

alter table public.skills enable row level security;

create policy "select own skills" on public.skills
  for select using (auth.uid() = user_id);
create policy "insert own skills" on public.skills
  for insert with check (auth.uid() = user_id);
create policy "update own skills" on public.skills
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own skills" on public.skills
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- jobs  (minimal shape — full extraction fields are already present; the extension starts
-- populating description/responsibilities/raw_extraction/platform_type in Phase 2)
-- ============================================================================================

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text,
  title text,
  location text,
  employment_type text,
  description text,
  responsibilities text[] not null default '{}',
  qualifications text[] not null default '{}',
  preferred_qualifications text[] not null default '{}',
  skills text[] not null default '{}',
  source_url text,
  platform_type text check (platform_type in ('GENERIC', 'GREENHOUSE', 'LEVER', 'WORKDAY')),
  raw_extraction jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_user_id_idx on public.jobs (user_id);
create index jobs_user_id_source_url_idx on public.jobs (user_id, source_url);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

create policy "select own jobs" on public.jobs
  for select using (auth.uid() = user_id);
create policy "insert own jobs" on public.jobs
  for insert with check (auth.uid() = user_id);
create policy "update own jobs" on public.jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own jobs" on public.jobs
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- applications
-- ============================================================================================

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  resume_id uuid references public.resumes(id) on delete set null,
  company text not null,
  title text not null,
  status text not null default 'SAVED' check (status in (
    'SAVED', 'IN_PROGRESS', 'APPLIED', 'APPLICATION_RECEIVED', 'ASSESSMENT', 'INTERVIEW',
    'ACTION_REQUIRED', 'OFFER', 'REJECTED', 'WITHDRAWN', 'UNKNOWN'
  )),
  notes text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_user_id_idx on public.applications (user_id);
create index applications_user_id_status_idx on public.applications (user_id, status);
create index applications_user_id_company_idx on public.applications (user_id, company);
create index applications_user_id_applied_at_idx
  on public.applications (user_id, applied_at desc);

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

alter table public.applications enable row level security;

create policy "select own applications" on public.applications
  for select using (auth.uid() = user_id);
create policy "insert own applications" on public.applications
  for insert with check (auth.uid() = user_id);
create policy "update own applications" on public.applications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own applications" on public.applications
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- application_events  (append-only timeline)
--
-- email_signal_id is added as a plain uuid column now, without a foreign key, because
-- email_signals doesn't exist until the Phase 5 migration. That migration adds:
--   alter table public.application_events
--     add constraint application_events_email_signal_id_fkey
--     foreign key (email_signal_id) references public.email_signals(id) on delete set null;
-- ============================================================================================

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  event_type text not null check (event_type in (
    'STATUS_CHANGE', 'NOTE', 'EMAIL_MATCHED', 'MANUAL_EDIT'
  )),
  from_status text,
  to_status text,
  source text not null check (source in ('USER', 'GMAIL_SYNC', 'SYSTEM')),
  email_signal_id uuid,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index application_events_user_id_idx on public.application_events (user_id);
create index application_events_application_id_created_at_idx
  on public.application_events (application_id, created_at);

alter table public.application_events enable row level security;

create policy "select own application_events" on public.application_events
  for select using (auth.uid() = user_id);
create policy "insert own application_events" on public.application_events
  for insert with check (auth.uid() = user_id);
create policy "update own application_events" on public.application_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own application_events" on public.application_events
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- user_settings
-- ============================================================================================

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gmail_integration_enabled boolean not null default false,
  ai_requests_this_period int not null default 0,
  ai_request_period_started_at timestamptz not null default now(),
  ai_request_limit int not null default 50,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark'))
);

alter table public.user_settings enable row level security;

create policy "select own user_settings" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "insert own user_settings" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "update own user_settings" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own user_settings" on public.user_settings
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- feature_flags  (not user-owned — see docs/DATA_MODEL.md)
-- ============================================================================================

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

alter table public.feature_flags enable row level security;

-- Readable by anyone with a valid session (flags are not secret) and by anon, since the
-- public /join page needs to check public_signups_enabled before a session exists.
create policy "select feature_flags" on public.feature_flags
  for select using (true);

-- No insert/update/delete policy for authenticated/anon roles: flags are changed only via
-- migration or the service-role key, never by application code acting on a user's behalf.

insert into public.feature_flags (key, enabled, description) values
  ('public_signups_enabled', false,
   'Controls whether the public /join page accepts new account creation. Off during private beta — see docs/IMPLEMENTATION_PLAN.md Phase 6/7.'),
  ('gmail_integration_enabled', false,
   'Global kill switch for Gmail sync, independent of any user''s own user_settings.gmail_integration_enabled toggle. Off until Phase 5 ships and OAuth verification posture is decided — see docs/EMAIL_INTEGRATION.md §6.');

-- ============================================================================================
-- New-user bootstrap: create a profiles row and a user_settings row the moment an account is
-- created (docs/USER_FLOWS.md §1). security definer so it runs with the privileges of its
-- owner (bypassing RLS) rather than the auth trigger's own context, which has no session yet.
-- ============================================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
    values (new.id, new.email);
  insert into public.user_settings (user_id)
    values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
