-- Career OS — Phase 6A: networking/CRM foundation.
--
-- Adds the private, user-owned contacts model that later Phase 6 slices (interactions,
-- reminders, Gmail contact suggestions, outreach/coffee-chat AI) build on top of. This
-- migration is deliberately narrow — see docs/IMPLEMENTATION_PLAN.md "Phase 6A" for the full
-- list of what is explicitly deferred to 6B+ (contact_interactions, follow_up_at,
-- source_email_signal_id, a companies table, etc.). Nothing below references any of those.
--
-- Three new tables, all ordinary private CRM data (not immutable-history like job_snapshots/
-- submission_packets — a user can freely edit or delete their own contacts):
--   contacts             — one row per person the user knows, reusable across applications.
--   contact_tags         — multi-select, longer-lived relationship classification per contact.
--   application_contacts — join table linking a contact to a specific application, with a
--                           per-application role (distinct from a contact's tags — see the
--                           column comment on application_contacts.role).
--
-- CLAUDE.md: every user-owned table ships with RLS enabled and the four standard policies in
-- the same migration that creates it; composite ownership FKs make a cross-user link
-- structurally impossible, not merely checked in application code.

-- ============================================================================================
-- contacts
-- ============================================================================================

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The only required human-identity field — a contact like "Jane — UF alum at Microsoft" must
  -- be valid without an email, title, LinkedIn URL, or first/last split (docs/IMPLEMENTATION_PLAN.md
  -- "Phase 6A" §3).
  display_name text not null check (length(trim(display_name)) > 0),
  first_name text,
  last_name text,
  email text,
  phone text,
  linkedin_url text,
  -- Free text, not a foreign key — Phase 6A deliberately has no companies table (see
  -- docs/IMPLEMENTATION_PLAN.md "Phase 6A" §7). An application's `company` may be copied in as a
  -- one-time convenience default when adding a contact from application context; it never stays
  -- synced afterward.
  current_company text,
  current_title text,
  location text,
  notes text,
  -- How this contact row came to exist. Only values Phase 6A can actually produce — MANUAL (the
  -- /network "Add contact" form) and APPLICATION_CONTEXT (added from an application's People
  -- section). OTHER exists for any current path that doesn't cleanly fit either (e.g. a future
  -- data-fix script) — it is not a placeholder for an unbuilt source. Gmail-derived contacts get
  -- their own source value only when that feature actually ships (Phase 6B+); this CHECK is
  -- additive-widened then, the same way ai_usage_events.task_type has been widened repeatedly.
  source text not null check (source in ('MANUAL', 'APPLICATION_CONTEXT', 'OTHER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Lets contact_tags/application_contacts below use a composite FK back to this table, the same
  -- pattern applications/resumes adopted in migration 0013 for the identical reason.
  constraint contacts_user_id_id_key unique (user_id, id)
);

create index contacts_user_id_idx on public.contacts (user_id);
create index contacts_user_id_created_at_idx on public.contacts (user_id, created_at desc);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

alter table public.contacts enable row level security;

create policy "select own contacts" on public.contacts
  for select using (auth.uid() = user_id);
create policy "insert own contacts" on public.contacts
  for insert with check (auth.uid() = user_id);
create policy "update own contacts" on public.contacts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own contacts" on public.contacts
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- contact_tags  (multi-select; longer-lived relationship classification — see the distinction
-- from application_contacts.role documented on that column below)
-- ============================================================================================

create table public.contact_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null,
  tag text not null check (tag in (
    'RECRUITER', 'HIRING_MANAGER', 'EMPLOYEE', 'ALUMNI', 'MENTOR', 'PROFESSOR', 'FRIEND',
    'CLASSMATE', 'REFERRER', 'NETWORKING_CONTACT', 'OTHER'
  )),
  created_at timestamptz not null default now(),

  primary key (user_id, contact_id, tag),

  -- Composite FK: a tag row cannot reference a contact owned by a different user, structurally.
  constraint contact_tags_contact_fkey
    foreign key (user_id, contact_id) references public.contacts (user_id, id) on delete cascade
);

-- No update policy/trigger below: every column of this table is part of its primary key, so
-- there is no mutable payload to update — changing a contact's tags is a delete-then-insert
-- (see packages/database's replaceOwnContactTags), not a row-level update.

alter table public.contact_tags enable row level security;

create policy "select own contact_tags" on public.contact_tags
  for select using (auth.uid() = user_id);
create policy "insert own contact_tags" on public.contact_tags
  for insert with check (auth.uid() = user_id);
create policy "delete own contact_tags" on public.contact_tags
  for delete using (auth.uid() = user_id);

-- ============================================================================================
-- application_contacts  (join table — a contact is reusable across many applications)
-- ============================================================================================

create table public.application_contacts (
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null,
  contact_id uuid not null,
  -- The person's function relative to THIS application — distinct from contact_tags, which is
  -- the person's longer-lived relationship to the user overall (docs/IMPLEMENTATION_PLAN.md
  -- "Phase 6A" §21). Linking a contact here with role INTERVIEWER never mutates their global
  -- tags, and vice versa — the two concepts are deliberately not coupled.
  role text not null check (role in (
    'RECRUITER', 'HIRING_MANAGER', 'REFERRER', 'INTERVIEWER', 'EMPLOYEE_CONTACT', 'OTHER'
  )),
  created_at timestamptz not null default now(),

  -- One contact may have multiple roles on one application (e.g. both REFERRER and
  -- EMPLOYEE_CONTACT), but the exact same (contact, role) pair on the same application is a
  -- structural duplicate, not a new fact — rejected by this primary key rather than left to
  -- application-layer discipline.
  primary key (user_id, application_id, contact_id, role),

  -- Composite FKs: a link row cannot reference an application or a contact owned by a different
  -- user, structurally — a cross-user link is impossible at the database level, not merely
  -- checked in the RPC/query layer.
  constraint application_contacts_application_fkey
    foreign key (user_id, application_id) references public.applications (user_id, id)
    on delete cascade,
  constraint application_contacts_contact_fkey
    foreign key (user_id, contact_id) references public.contacts (user_id, id) on delete cascade
);

-- Supports "applications linked to this contact" (packages/database's
-- listOwnApplicationsForContact) — the primary key's own column order (application_id before
-- contact_id) doesn't serve that direction.
create index application_contacts_user_id_contact_id_idx
  on public.application_contacts (user_id, contact_id);

-- No update policy/trigger below, for the same reason as contact_tags: every column here is
-- part of the primary key, so changing a link's role is a delete-then-insert, not an update.

alter table public.application_contacts enable row level security;

create policy "select own application_contacts" on public.application_contacts
  for select using (auth.uid() = user_id);
create policy "insert own application_contacts" on public.application_contacts
  for insert with check (auth.uid() = user_id);
create policy "delete own application_contacts" on public.application_contacts
  for delete using (auth.uid() = user_id);
