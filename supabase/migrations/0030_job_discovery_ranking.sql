-- Career OS — Job Discovery Track, D4: deterministic feature extraction, user-configurable
-- ranking, and eligibility. See docs/JOB_DISCOVERY.md for the full design.
--
-- Four new tables:
--   job_catalog_features         — global, one row per job_catalog row, service-role write only
--                                   (same posture as job_catalog itself)
--   discovery_scoring_profiles   — user-owned, standard four-policy RLS
--   discovery_eligibility_profiles — user-owned, standard four-policy RLS
--   user_job_match_scores        — user-owned, select-only RLS (same posture as job_snapshots) —
--                                   every write goes through the service-role recompute CLI
--
-- Nothing here touches job_sources/job_catalog (D1-D3) or any existing table's semantics.

-- ================================================================================================
-- PART 1 — job_catalog_features (global, derived, service-role-write)
-- ================================================================================================

create table public.job_catalog_features (
  id uuid primary key default gen_random_uuid(),
  job_catalog_id uuid not null unique references public.job_catalog(id) on delete cascade,

  -- job_catalog.content_hash at the moment features were computed — a mismatch against the
  -- current job_catalog row is exactly how a stale features row is found for recomputation
  -- (docs/JOB_DISCOVERY.md "Recomputation"), without needing a join back to job_catalog just to
  -- know whether reprocessing is needed.
  content_hash_at_extraction text not null,

  plain_text_description text not null default '',

  -- Every classification enum here carries an explicit 'UNKNOWN' member (unlike job_catalog
  -- itself, which uses null for "not specified") — this table exists specifically to represent
  -- "what could Career OS determine" as a first-class value.
  role_family text not null default 'UNKNOWN' check (role_family in (
    'PRODUCT_MANAGEMENT', 'TECHNICAL_PROGRAM_MANAGEMENT', 'PRODUCT_ANALYTICS', 'DATA_ANALYTICS',
    'DATA_SCIENCE', 'SOFTWARE_ENGINEERING', 'BUSINESS_ANALYTICS', 'STRATEGY_OPERATIONS',
    'CONSULTING', 'UNKNOWN'
  )),
  seniority text not null default 'UNKNOWN' check (seniority in (
    'INTERN', 'NEW_GRAD', 'ENTRY', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL', 'MANAGER',
    'DIRECTOR_PLUS', 'UNKNOWN'
  )),
  is_internship boolean not null default false,
  is_new_grad boolean not null default false,

  normalized_employment_type text not null default 'UNKNOWN' check (normalized_employment_type in (
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'UNKNOWN'
  )),
  normalized_workplace_type text not null default 'UNKNOWN' check (normalized_workplace_type in (
    'REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'
  )),

  location_tokens text[] not null default '{}',
  extracted_competency_codes text[] not null default '{}',

  required_years_min integer,
  required_years_max integer,
  graduation_year_min integer,
  graduation_year_max integer,

  sponsorship_signal text not null default 'UNKNOWN' check (sponsorship_signal in (
    'AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN'
  )),
  citizenship_requirement text not null default 'UNKNOWN' check (citizenship_requirement in (
    'US_CITIZEN_ONLY', 'UNKNOWN'
  )),
  clearance_requirement text not null default 'UNKNOWN' check (clearance_requirement in (
    'ACTIVE_CLEARANCE_REQUIRED', 'CLEARANCE_ELIGIBILITY_REQUIRED', 'UNKNOWN'
  )),
  work_authorization_requirement text not null default 'UNKNOWN' check (work_authorization_requirement in (
    'AUTHORIZATION_REQUIRED', 'UNKNOWN'
  )),

  -- Bounded, deterministic-template evidence snippets (never raw model output — there is no
  -- model). Shape: { sponsorship?, citizenship?, clearance?, workAuthorization? }, each a string
  -- or null. Validated at the application layer (packages/shared's jobCatalogFeatureEvidenceSchema).
  evidence jsonb not null default '{}',

  feature_version text not null,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_catalog_features_years_range check (
    required_years_min is null or required_years_max is null or required_years_min <= required_years_max
  ),
  constraint job_catalog_features_graduation_range check (
    graduation_year_min is null or graduation_year_max is null or graduation_year_min <= graduation_year_max
  )
);

create index job_catalog_features_role_family_idx on public.job_catalog_features (role_family);
create index job_catalog_features_seniority_idx on public.job_catalog_features (seniority);
create index job_catalog_features_feature_version_idx on public.job_catalog_features (feature_version);
create index job_catalog_features_location_tokens_idx on public.job_catalog_features using gin (location_tokens);
create index job_catalog_features_competency_codes_idx on public.job_catalog_features using gin (extracted_competency_codes);

create trigger job_catalog_features_set_updated_at
  before update on public.job_catalog_features
  for each row execute function public.set_updated_at();

alter table public.job_catalog_features enable row level security;

-- Same read posture as job_catalog itself: non-sensitive, global, platform-derived data.
create policy "select job_catalog_features as authenticated" on public.job_catalog_features
  for select
  to authenticated
  using (true);

-- No insert/update/delete policy for anon or authenticated — every write goes through the
-- service-role feature-extraction CLI (packages/discovery), which bypasses RLS as a role
-- property, matching CLAUDE.md's posture for every other privileged global write path.

-- ================================================================================================
-- PART 2 — discovery_scoring_profiles (user-owned, standard four-policy RLS)
-- ================================================================================================

create table public.discovery_scoring_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  -- Schema-shape version for this row's own JSON structure — distinct from ranking_version
  -- (the scoring-ENGINE version, stamped onto computed user_job_match_scores rows below).
  profile_version text not null default 'v1',

  preset text not null default 'BALANCED' check (preset in (
    'BALANCED', 'CAREER_FIT_FIRST', 'LOCATION_FIRST', 'CUSTOM'
  )),

  -- {"ROLE_FIT": 0-10, "COMPETENCY_FIT": 0-10, ...} — see docs/JOB_DISCOVERY.md "D4 V1 Supported
  -- Scoring Criteria". Validated at the application layer (packages/shared's
  -- criteriaWeightsSchema); the BALANCED default here matches
  -- packages/shared/src/lib/default-scoring-profile.ts's BALANCED_PRESET_CRITERIA_WEIGHTS exactly.
  criteria_weights jsonb not null default '{
    "ROLE_FIT": 7, "COMPETENCY_FIT": 7, "SENIORITY_FIT": 6, "LOCATION_FIT": 6,
    "WORK_MODE_FIT": 5, "EMPLOYMENT_TYPE_FIT": 5, "OBSERVED_FRESHNESS": 3
  }'::jsonb,

  -- Preferences WITHIN criteria — deliberately NOT defaulted to any non-empty opinion (Career OS
  -- cannot guess what role families/locations a specific user wants). Every value absent from
  -- these maps is UNKNOWN for that user (docs/JOB_DISCOVERY.md "Role"/"Location"/etc.), not 0.
  role_preferences jsonb not null default '{}',
  seniority_preferences jsonb not null default '{}',
  location_preferences jsonb not null default '{}',
  work_mode_preferences jsonb not null default '{}',
  employment_type_preferences jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger discovery_scoring_profiles_set_updated_at
  before update on public.discovery_scoring_profiles
  for each row execute function public.set_updated_at();

alter table public.discovery_scoring_profiles enable row level security;

create policy "select own discovery_scoring_profiles" on public.discovery_scoring_profiles
  for select using (auth.uid() = user_id);
create policy "insert own discovery_scoring_profiles" on public.discovery_scoring_profiles
  for insert with check (auth.uid() = user_id);
create policy "update own discovery_scoring_profiles" on public.discovery_scoring_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own discovery_scoring_profiles" on public.discovery_scoring_profiles
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- PART 3 — discovery_eligibility_profiles (user-owned, standard four-policy RLS)
-- ================================================================================================
--
-- Every field is nullable and defaults to null — null means "the user hasn't told us," which is
-- exactly what makes the corresponding Eligibility check inapplicable (docs/JOB_DISCOVERY.md
-- "Eligibility profile"). Only explicit, self-reported answers are ever stored here; nothing is
-- inferred.

create table public.discovery_eligibility_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  currently_authorized_to_work boolean,
  requires_sponsorship_now boolean,
  requires_sponsorship_future boolean,
  is_us_citizen boolean,
  has_active_security_clearance boolean,
  eligible_to_obtain_security_clearance boolean,
  graduation_year integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint discovery_eligibility_profiles_graduation_year_range check (
    graduation_year is null or (graduation_year >= 2000 and graduation_year <= 2100)
  )
);

create trigger discovery_eligibility_profiles_set_updated_at
  before update on public.discovery_eligibility_profiles
  for each row execute function public.set_updated_at();

alter table public.discovery_eligibility_profiles enable row level security;

create policy "select own discovery_eligibility_profiles" on public.discovery_eligibility_profiles
  for select using (auth.uid() = user_id);
create policy "insert own discovery_eligibility_profiles" on public.discovery_eligibility_profiles
  for insert with check (auth.uid() = user_id);
create policy "update own discovery_eligibility_profiles" on public.discovery_eligibility_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own discovery_eligibility_profiles" on public.discovery_eligibility_profiles
  for delete using (auth.uid() = user_id);

-- ================================================================================================
-- PART 4 — user_job_match_scores (user-owned, select-only RLS — same posture as job_snapshots)
-- ================================================================================================
--
-- Deliberately NOT an ordinary four-policy table: a computed score is the output of a
-- service-role batch recomputation (scripts/discovery/rank.ts), never a direct user write. An
-- authenticated insert/update policy would let a client fabricate its own "Match: 100" row via
-- PostgREST, bypassing the scoring engine entirely.

create table public.user_job_match_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_catalog_id uuid not null references public.job_catalog(id) on delete cascade,

  match_score numeric(5, 2) not null check (match_score >= 0 and match_score <= 100),
  coverage numeric(5, 2) not null check (coverage >= 0 and coverage <= 100),
  eligibility_status text not null check (eligibility_status in ('ELIGIBLE', 'UNKNOWN', 'CONFLICT')),

  -- [{ criterion, weight, known, fit }, ...] — one entry per D4 V1 criterion, enough to
  -- reproduce/explain the score exactly without recomputation (docs/JOB_DISCOVERY.md
  -- "Match-score math").
  score_components jsonb not null default '[]',
  -- [{ type, status, reasonCode, explanation, evidenceText, sourceField }, ...] — only the
  -- *applicable* checks; see docs/JOB_DISCOVERY.md "Overall eligibility derivation".
  eligibility_checks jsonb not null default '[]',

  ranking_version text not null,
  feature_version text not null,
  eligibility_version text not null,

  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- At most one current score per (user, job) — recomputation overwrites in place rather than
  -- accumulating history; docs/JOB_DISCOVERY.md documents this as a deliberate V1 simplification
  -- (no score history is currently kept).
  constraint user_job_match_scores_user_job_key unique (user_id, job_catalog_id)
);

create index user_job_match_scores_user_id_idx on public.user_job_match_scores (user_id);
create index user_job_match_scores_user_id_score_idx
  on public.user_job_match_scores (user_id, match_score desc);
create index user_job_match_scores_job_catalog_id_idx on public.user_job_match_scores (job_catalog_id);

alter table public.user_job_match_scores enable row level security;

create policy "select own user_job_match_scores" on public.user_job_match_scores
  for select using (auth.uid() = user_id);

-- No insert/update/delete policy for authenticated — service-role only, same reasoning as
-- job_snapshots (docs/DATA_MODEL.md "RLS policy pattern" deliberate exception).
