-- Career OS — Phase 7G: company research intelligence foundation (RESEARCH ONLY).
--
-- Four new tables, all immutable once written, all created exclusively through the one
-- service-role-only `create_company_research_snapshot` RPC at the bottom of this migration — same
-- posture as job_snapshots/requirement_evidence_mappings (migration 0010): no INSERT policy for
-- `authenticated` on any of them, so a client can never fabricate a "researched" snapshot that
-- skipped AI-contract validation entirely.
--
-- Deliberately no `companies` table (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §4) — research stays
-- application-contextual. `company_research_snapshots.company_name`/`role_title` freeze plain text
-- at research time, so historical research stays understandable even if the application's own
-- fields are later edited or the application itself is deleted (Part 1, `application_id` is
-- column-scoped `ON DELETE SET NULL`, never cascaded).
--
-- Every requirement id a finding cites is a request-local string (sometimes a real
-- `requirement_evidence_mappings.id`, sometimes a synthesized per-request id when no mapping
-- exists — the exact same fallback Phase 7E's own résumé-tailoring operations use), never a real
-- foreign key: there is no canonical "requirements" table to reference, so `requirement_ids` is a
-- plain `text[]`, validated request-locally in application code
-- (`validateCompanyResearchPlan`), the same posture Phase 7E's own `requirementIds` field has.

-- ================================================================================================
-- PART 1 — company_research_snapshots
-- ================================================================================================

create table public.company_research_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable and never cascaded: deleting the application this research was originally attached
  -- to must not silently destroy a research artifact a later tailored résumé or interview-prep
  -- run may already reference by this snapshot's own immutable id (docs/IMPLEMENTATION_PLAN.md
  -- "Phase 7G" §7, and the Phase 7H/7I boundary at the bottom of that doc section).
  application_id uuid,
  company_name text not null check (length(trim(company_name)) > 0 and length(company_name) <= 200),
  role_title text not null check (length(trim(role_title)) > 0 and length(role_title) <= 200),
  -- Also never cascaded — job_snapshots are themselves permanent (no delete path exists for them
  -- today), but this stays a defensive SET NULL rather than an assumption.
  job_snapshot_id uuid,
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint company_research_snapshots_user_id_id_key unique (user_id, id),
  constraint company_research_snapshots_application_id_fkey
    foreign key (user_id, application_id) references public.applications (user_id, id)
    on delete set null (application_id),
  constraint company_research_snapshots_job_snapshot_id_fkey
    foreign key (user_id, job_snapshot_id) references public.job_snapshots (user_id, id)
    on delete set null (job_snapshot_id)
);

create index company_research_snapshots_user_id_idx on public.company_research_snapshots (user_id);
create index company_research_snapshots_application_id_idx
  on public.company_research_snapshots (application_id);

create trigger company_research_snapshots_block_update
  before update on public.company_research_snapshots
  for each row execute function public.reject_immutable_row_mutation();

alter table public.company_research_snapshots enable row level security;

-- Deliberate deviation from the ordinary four-policy pattern, same posture as job_snapshots: no
-- INSERT policy for `authenticated` — every snapshot is created exclusively through
-- create_company_research_snapshot below. DELETE is ordinary: the user may delete their own
-- snapshot (cascading to its own sources/findings/links, Parts 2-4), since no historical reference
-- to a snapshot exists yet in this phase (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §34: "Do not
-- over-engineer deletion restrictions for references that do not exist yet").
create policy "select own company_research_snapshots" on public.company_research_snapshots
  for select using (auth.uid() = user_id);
create policy "delete own company_research_snapshots" on public.company_research_snapshots
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- PART 2 — company_research_sources
--
-- Provenance metadata only — never a page dump (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §10/§11):
-- url/title/publisher/dates plus one bounded evidence excerpt, never full HTML, scripts, or an
-- entire article.
-- ================================================================================================

create table public.company_research_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  url text not null check (length(url) <= 2000),
  canonical_url text check (canonical_url is null or length(canonical_url) <= 2000),
  title text not null check (length(trim(title)) > 0 and length(title) <= 300),
  publisher text check (publisher is null or length(publisher) <= 200),
  source_type text not null check (source_type in (
    'OFFICIAL_WEBSITE', 'OFFICIAL_NEWSROOM', 'INVESTOR_RELATIONS', 'ENGINEERING_BLOG',
    'PRODUCT_BLOG', 'CAREERS', 'REPUTABLE_NEWS', 'OTHER'
  )),
  -- Never manufactured — null when the source itself doesn't expose a real publication date
  -- (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §28).
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  -- Bounded excerpt, not a full article (§11: "500-1500 characters" — 1500 is the ceiling this
  -- column enforces, matching EVIDENCE_EXCERPT_MAX in packages/shared).
  evidence_excerpt text check (evidence_excerpt is null or length(evidence_excerpt) <= 1500),
  content_hash text check (content_hash is null or length(content_hash) <= 128),

  constraint company_research_sources_user_id_id_key unique (user_id, id),
  -- Composite key a finding-source link (Part 4) can reference to structurally guarantee "this
  -- source actually belongs to the same snapshot the citing finding belongs to" — not just "same
  -- user," a stronger guarantee than the minimum this phase's own security review asked for.
  constraint company_research_sources_user_id_id_snapshot_key unique (user_id, id, snapshot_id),
  constraint company_research_sources_snapshot_id_fkey
    foreign key (user_id, snapshot_id) references public.company_research_snapshots (user_id, id)
    on delete cascade,
  -- §54 — enforce uniqueness within one snapshot at the structural level, not just app-level dedup.
  constraint company_research_sources_snapshot_url_key unique (snapshot_id, url)
);

create index company_research_sources_user_id_idx on public.company_research_sources (user_id);
create index company_research_sources_snapshot_id_idx on public.company_research_sources (snapshot_id);

create trigger company_research_sources_block_update
  before update on public.company_research_sources
  for each row execute function public.reject_immutable_row_mutation();

alter table public.company_research_sources enable row level security;

-- Select-only for `authenticated` — a source is entirely a child of its snapshot's own atomic
-- creation and cascade-delete; there is no legitimate case for creating, editing, or deleting one
-- independently of the snapshot it belongs to (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §8/§34).
create policy "select own company_research_sources" on public.company_research_sources
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 3 — company_research_findings
-- ================================================================================================

create table public.company_research_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  category text not null check (category in (
    'PRODUCT', 'STRATEGY', 'TECHNOLOGY', 'BUSINESS', 'CULTURE', 'HIRING', 'RECENT_DEVELOPMENT',
    'OTHER'
  )),
  claim text not null check (length(trim(claim)) > 0 and length(claim) <= 500),
  -- Deliberately separate from claim (§14): a factual company claim vs. why it matters for THIS
  -- role. Never populated with anything about a candidate — that intersection is Phase 7H.
  role_relevance text check (role_relevance is null or length(role_relevance) <= 400),
  -- Request-local requirement ids only (see this migration's own header comment for why this is
  -- not a foreign key) — bounded array size and per-element length as a defensive backstop, not
  -- the primary validation (that happens in validateCompanyResearchPlan before this table is ever
  -- written to).
  requirement_ids text[] not null default '{}',
  created_at timestamptz not null default now(),

  constraint company_research_findings_requirement_ids_bound
    check (array_length(requirement_ids, 1) is null or array_length(requirement_ids, 1) <= 6),
  constraint company_research_findings_user_id_id_key unique (user_id, id),
  constraint company_research_findings_user_id_id_snapshot_key unique (user_id, id, snapshot_id),
  constraint company_research_findings_snapshot_id_fkey
    foreign key (user_id, snapshot_id) references public.company_research_snapshots (user_id, id)
    on delete cascade
);

create index company_research_findings_user_id_idx on public.company_research_findings (user_id);
create index company_research_findings_snapshot_id_idx
  on public.company_research_findings (snapshot_id);

create trigger company_research_findings_block_update
  before update on public.company_research_findings
  for each row execute function public.reject_immutable_row_mutation();

alter table public.company_research_findings enable row level security;

create policy "select own company_research_findings" on public.company_research_findings
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 4 — company_research_finding_sources: every finding must cite at least one source (§13),
-- enforced structurally by create_company_research_snapshot below (a finding with zero sourceIds
-- is rejected before insert) rather than by a table constraint here (a join table has no natural
-- "at least one row per finding" check). The two composite FKs below are the real structural
-- guarantee this phase's own review demanded: a citation can only ever link a finding and a
-- source that both belong to the SAME user AND the SAME snapshot — not merely the same user.
-- ================================================================================================

create table public.company_research_finding_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  finding_id uuid not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),

  primary key (finding_id, source_id),
  constraint company_research_finding_sources_finding_fkey
    foreign key (user_id, finding_id, snapshot_id)
    references public.company_research_findings (user_id, id, snapshot_id)
    on delete cascade,
  constraint company_research_finding_sources_source_fkey
    foreign key (user_id, source_id, snapshot_id)
    references public.company_research_sources (user_id, id, snapshot_id)
    on delete cascade
);

create index company_research_finding_sources_user_id_idx
  on public.company_research_finding_sources (user_id);
create index company_research_finding_sources_snapshot_id_idx
  on public.company_research_finding_sources (snapshot_id);
create index company_research_finding_sources_source_id_idx
  on public.company_research_finding_sources (source_id);

create trigger company_research_finding_sources_block_update
  before update on public.company_research_finding_sources
  for each row execute function public.reject_immutable_row_mutation();

alter table public.company_research_finding_sources enable row level security;

create policy "select own company_research_finding_sources" on public.company_research_finding_sources
  for select using (auth.uid() = user_id);

-- ================================================================================================
-- PART 5 — create_company_research_snapshot: the one atomic path for persisting a completed
-- research pipeline run (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §32). Mirrors
-- promote_requirement_mapping_run's own shape (migration 0010 Part 6): structural JSONB
-- validation of every source/finding before any insert, defense-in-depth against a bug in the
-- calling TypeScript code, not against a malicious model (the model's own output was already
-- validated and allowlist-checked in validateCompanyResearchPlan before this function is ever
-- called, and this function is unreachable by anything but trusted server code).
--
-- Every source/finding id is generated by the CALLER before this call (same pattern as Phase 7C's
-- résumé entry ids) — this function only inserts the rows it's given, it never generates a
-- source/finding id of its own, so there is nothing for the model to have invented that could
-- collide with what's inserted here.
-- ================================================================================================

create function public.create_company_research_snapshot(
  p_user_id uuid,
  p_application_id uuid,
  p_company_name text,
  p_role_title text,
  p_job_snapshot_id uuid,
  p_sources jsonb,
  p_findings jsonb
)
returns table (
  snapshot_id uuid,
  source_count integer,
  finding_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_snapshot_id uuid;
  v_source jsonb;
  v_finding jsonb;
  v_source_id_elem jsonb;
  v_valid_source_ids uuid[];
  v_source_count int;
  v_finding_count int;
begin
  if p_application_id is not null and not exists (
    select 1 from public.applications where id = p_application_id and user_id = p_user_id
  ) then
    raise exception 'application_not_found';
  end if;
  if p_job_snapshot_id is not null and not exists (
    select 1 from public.job_snapshots where id = p_job_snapshot_id and user_id = p_user_id
  ) then
    raise exception 'job_snapshot_not_found';
  end if;

  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'create_company_research_snapshot: p_sources must be a non-empty JSON array';
  end if;
  if jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) = 0 then
    raise exception 'create_company_research_snapshot: p_findings must be a non-empty JSON array';
  end if;

  for v_source in select * from jsonb_array_elements(p_sources) loop
    if coalesce(v_source ->> 'url', '') = '' then
      raise exception 'create_company_research_snapshot: source missing url';
    end if;
    if coalesce(v_source ->> 'title', '') = '' then
      raise exception 'create_company_research_snapshot: source missing title';
    end if;
    if v_source ->> 'sourceType' not in (
      'OFFICIAL_WEBSITE', 'OFFICIAL_NEWSROOM', 'INVESTOR_RELATIONS', 'ENGINEERING_BLOG',
      'PRODUCT_BLOG', 'CAREERS', 'REPUTABLE_NEWS', 'OTHER'
    ) then
      raise exception 'create_company_research_snapshot: invalid sourceType %', v_source ->> 'sourceType';
    end if;
    begin
      perform (v_source ->> 'id')::uuid;
    exception when others then
      raise exception 'create_company_research_snapshot: invalid source id %', v_source ->> 'id';
    end;
  end loop;

  select array_agg((s ->> 'id')::uuid) into v_valid_source_ids from jsonb_array_elements(p_sources) s;
  if array_length(v_valid_source_ids, 1) is distinct from (
    select count(distinct s ->> 'id')::int from jsonb_array_elements(p_sources) s
  ) then
    raise exception 'create_company_research_snapshot: duplicate source id in p_sources';
  end if;

  for v_finding in select * from jsonb_array_elements(p_findings) loop
    if v_finding ->> 'category' not in (
      'PRODUCT', 'STRATEGY', 'TECHNOLOGY', 'BUSINESS', 'CULTURE', 'HIRING', 'RECENT_DEVELOPMENT',
      'OTHER'
    ) then
      raise exception 'create_company_research_snapshot: invalid category %', v_finding ->> 'category';
    end if;
    if coalesce(v_finding ->> 'claim', '') = '' then
      raise exception 'create_company_research_snapshot: finding missing claim';
    end if;
    begin
      perform (v_finding ->> 'id')::uuid;
    exception when others then
      raise exception 'create_company_research_snapshot: invalid finding id %', v_finding ->> 'id';
    end;
    if jsonb_typeof(v_finding -> 'sourceIds') <> 'array' or jsonb_array_length(v_finding -> 'sourceIds') = 0 then
      raise exception 'create_company_research_snapshot: finding % has no sourceIds', v_finding ->> 'id';
    end if;
    for v_source_id_elem in select * from jsonb_array_elements(v_finding -> 'sourceIds') loop
      if not ((v_source_id_elem #>> '{}')::uuid = any (v_valid_source_ids)) then
        raise exception 'create_company_research_snapshot: finding % cites unknown sourceId %',
          v_finding ->> 'id', v_source_id_elem;
      end if;
    end loop;
  end loop;

  insert into public.company_research_snapshots (
    user_id, application_id, company_name, role_title, job_snapshot_id
  ) values (
    p_user_id, p_application_id, p_company_name, p_role_title, p_job_snapshot_id
  ) returning id into v_snapshot_id;

  insert into public.company_research_sources (
    id, user_id, snapshot_id, url, canonical_url, title, publisher, source_type, published_at,
    evidence_excerpt, content_hash
  )
  select
    (s ->> 'id')::uuid, p_user_id, v_snapshot_id, s ->> 'url', s ->> 'canonicalUrl', s ->> 'title',
    s ->> 'publisher', s ->> 'sourceType', nullif(s ->> 'publishedAt', '')::timestamptz,
    s ->> 'evidenceExcerpt', s ->> 'contentHash'
  from jsonb_array_elements(p_sources) as s;
  get diagnostics v_source_count = row_count;

  insert into public.company_research_findings (
    id, user_id, snapshot_id, category, claim, role_relevance, requirement_ids
  )
  select
    (f ->> 'id')::uuid, p_user_id, v_snapshot_id, f ->> 'category', f ->> 'claim',
    nullif(f ->> 'roleRelevance', ''),
    coalesce(
      (select array_agg(r #>> '{}') from jsonb_array_elements(coalesce(f -> 'requirementIds', '[]'::jsonb)) r),
      '{}'
    )
  from jsonb_array_elements(p_findings) as f;
  get diagnostics v_finding_count = row_count;

  insert into public.company_research_finding_sources (user_id, snapshot_id, finding_id, source_id)
  select p_user_id, v_snapshot_id, (f ->> 'id')::uuid, (sid #>> '{}')::uuid
  from jsonb_array_elements(p_findings) as f,
       jsonb_array_elements(f -> 'sourceIds') as sid;

  return query select v_snapshot_id, v_source_count, v_finding_count;
end;
$$;

revoke all on function public.create_company_research_snapshot from public;
revoke all on function public.create_company_research_snapshot from anon;
revoke all on function public.create_company_research_snapshot from authenticated;
grant execute on function public.create_company_research_snapshot to service_role;
