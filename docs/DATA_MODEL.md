# Data Model

Target: Supabase Postgres. This document defines the schema that `supabase/migrations/`
will implement starting in Phase 1. Every user-owned table has `user_id` and Row Level
Security enabled; there is no table anywhere in this list that a user's data can end up in
without a `user_id` scoping it.

Conventions used below:

- `id uuid default gen_random_uuid() primary key` on every table unless noted.
- `created_at timestamptz not null default now()`, `updated_at timestamptz not null default
now()` (maintained by an `on update` trigger) on every table.
- `user_id uuid not null references auth.users(id) on delete cascade` on every user-owned
  table — this is what makes account deletion (`docs/USER_FLOWS.md` §8) a cascade instead of
  a manual sweep.

## Two-layer fact model

- **`candidate_facts`** is the atomic, provenance-tracked ledger: every discrete claim about
  the candidate, where it came from, and whether it's approved. This is what
  `docs/AI_GROUNDING.md` retrieval reads from and what the approval UI in `/profile` edits.
- **`experiences` / `education` / `projects` / `skills`** are structured, user-editable
  records optimized for display and matching (dates, company, ranking tags). Each row may
  optionally point back to the `candidate_facts` row it was extracted from
  (`source_fact_id`), but a user can also create/edit these directly — they are not required
  to originate from AI extraction.

Both layers carry `user_approved` / `approved_for_applications` / `visible_on_public_profile`
independently, because a structured `experiences` row summarizes possibly-several underlying
facts and its own approval state is what `packages/ai` actually checks before use.

---

## `profiles`

One row per user; user-authored structured contact/preference data (distinct from
AI-extracted `candidate_facts`).

| column                      | type                                                           | notes                                                             |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `user_id`                   | `uuid primary key references auth.users(id) on delete cascade` | also the FK target for most other tables                          |
| `full_name`                 | `text`                                                         |                                                                   |
| `headline`                  | `text`                                                         |                                                                   |
| `email`                     | `text`                                                         | contact email shown on applications; independent of auth email    |
| `phone`                     | `text`                                                         |                                                                   |
| `location`                  | `text`                                                         | current location                                                  |
| `work_authorization`        | `text`                                                         | free text + optional enum tag; sensitive, see below               |
| `relocation_preference`     | `text`                                                         |                                                                   |
| `links`                     | `jsonb`                                                        | `{ linkedin, portfolio, github, website }`                        |
| `public_slug`               | `text unique`                                                  | nullable; reserved for future public profile (Phase 8)            |
| `visible_on_public_profile` | `boolean not null default false`                               | master switch; per-fact switches in `candidate_facts` still apply |
| `onboarding_completed_at`   | `timestamptz`                                                  |                                                                   |

RLS: `select/insert/update/delete` where `auth.uid() = user_id`.
Index: none beyond PK (1 row per user). Unique on `public_slug` (partial, `where public_slug
is not null`).

---

## `candidate_facts`

| column                      | type                                                        | notes                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `uuid pk`                                                   |                                                                                                                                                                                    |
| `user_id`                   | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                                                                    |
| `category`                  | `text not null`                                             | enum: `EDUCATION, EXPERIENCE, LEADERSHIP, RESEARCH, PROJECT, SKILL, LANGUAGE, CERTIFICATION, AWARD, WORK_AUTHORIZATION, LOCATION_PREFERENCE, RELOCATION_PREFERENCE, LINK, CONTACT` |
| `title`                     | `text not null`                                             | short label, e.g. "Backend Engineer @ Acme"                                                                                                                                        |
| `normalized_value`          | `text not null`                                             | the reviewed/editable canonical value used by retrieval and generation                                                                                                             |
| `source_text`               | `text`                                                      | raw excerpt the fact was extracted from                                                                                                                                            |
| `source_resume_id`          | `uuid references resume_uploads(id) on delete set null`     | nullable — not every fact comes from a résumé (table renamed from `resumes` in migration 0020, Phase 7A — see that table's own entry)                                              |
| `user_approved`             | `boolean not null default false`                            |                                                                                                                                                                                    |
| `approved_for_applications` | `boolean not null default false`                            | must also be true, alongside `user_approved`, before `packages/ai` may use this fact                                                                                               |
| `visible_on_public_profile` | `boolean not null default false`                            |                                                                                                                                                                                    |
| `tags`                      | `text[] not null default '{}'`                              | free-form keywords used by retrieval ranking                                                                                                                                       |
| `created_at`, `updated_at`  | `timestamptz`                                               |                                                                                                                                                                                    |

Indexes: `(user_id)`, `(user_id, category)`, GIN on `tags`.
RLS: standard `auth.uid() = user_id` on all operations.

Constraint enforced in application code and documented here as an invariant (not a DB
constraint, since "used by AI" is a query-time condition, not a row-level one):
`packages/ai` and any autofill suggestion path must filter
`user_approved = true and approved_for_applications = true`. See `docs/AI_GROUNDING.md`.

---

## `experiences`

| column                      | type                                                        | notes                                 |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `id`                        | `uuid pk`                                                   |                                       |
| `user_id`                   | `uuid not null references auth.users(id) on delete cascade` |                                       |
| `source_fact_id`            | `uuid references candidate_facts(id) on delete set null`    | nullable                              |
| `company`                   | `text not null`                                             |                                       |
| `title`                     | `text not null`                                             |                                       |
| `location`                  | `text`                                                      |                                       |
| `employment_type`           | `text`                                                      | e.g. full-time, internship            |
| `start_date`                | `date`                                                      |                                       |
| `end_date`                  | `date`                                                      | nullable = current                    |
| `description`               | `text`                                                      | bullet-style summary                  |
| `tags`                      | `text[] not null default '{}'`                              | skills/keywords for retrieval ranking |
| `user_approved`             | `boolean not null default false`                            |                                       |
| `approved_for_applications` | `boolean not null default false`                            |                                       |
| `visible_on_public_profile` | `boolean not null default false`                            |                                       |
| `display_order`             | `int not null default 0`                                    |                                       |

Indexes: `(user_id)`, `(user_id, start_date desc)`, GIN on `tags`.
RLS: standard.

## `education`

| column                      | type                                                        | notes                                    |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `id`                        | `uuid pk`                                                   |                                          |
| `user_id`                   | `uuid not null references auth.users(id) on delete cascade` |                                          |
| `source_fact_id`            | `uuid references candidate_facts(id) on delete set null`    |                                          |
| `school`                    | `text not null`                                             |                                          |
| `degree`                    | `text`                                                      |                                          |
| `field_of_study`            | `text`                                                      |                                          |
| `start_date`                | `date`                                                      |                                          |
| `graduation_date`           | `date`                                                      |                                          |
| `gpa`                       | `text`                                                      | free text to allow "N/A", scale variants |
| `honors`                    | `text[] not null default '{}'`                              |                                          |
| `user_approved`             | `boolean not null default false`                            |                                          |
| `approved_for_applications` | `boolean not null default false`                            |                                          |
| `visible_on_public_profile` | `boolean not null default false`                            |                                          |

Indexes: `(user_id)`. RLS: standard.

## `projects`

| column                      | type                                                        | notes |
| --------------------------- | ----------------------------------------------------------- | ----- |
| `id`                        | `uuid pk`                                                   |       |
| `user_id`                   | `uuid not null references auth.users(id) on delete cascade` |       |
| `source_fact_id`            | `uuid references candidate_facts(id) on delete set null`    |       |
| `name`                      | `text not null`                                             |       |
| `description`               | `text`                                                      |       |
| `role`                      | `text`                                                      |       |
| `start_date`                | `date`                                                      |       |
| `end_date`                  | `date`                                                      |       |
| `url`                       | `text`                                                      |       |
| `tags`                      | `text[] not null default '{}'`                              |       |
| `user_approved`             | `boolean not null default false`                            |       |
| `approved_for_applications` | `boolean not null default false`                            |       |
| `visible_on_public_profile` | `boolean not null default false`                            |       |

Indexes: `(user_id)`, GIN on `tags`. RLS: standard.

## `skills`

| column                      | type                                                        | notes                                      |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `id`                        | `uuid pk`                                                   |                                            |
| `user_id`                   | `uuid not null references auth.users(id) on delete cascade` |                                            |
| `source_fact_id`            | `uuid references candidate_facts(id) on delete set null`    |                                            |
| `name`                      | `text not null`                                             |                                            |
| `category`                  | `text`                                                      | e.g. language, framework, tool, soft skill |
| `proficiency`               | `text`                                                      | free text                                  |
| `user_approved`             | `boolean not null default false`                            |                                            |
| `approved_for_applications` | `boolean not null default false`                            |                                            |
| `visible_on_public_profile` | `boolean not null default false`                            |                                            |

Unique: `(user_id, lower(name))` to avoid duplicate skill rows.
Indexes: `(user_id)`. RLS: standard.

---

## `resume_uploads` (renamed from `resumes` in migration 0020, Phase 7A)

An uploaded résumé *file* awaiting a future Claude extraction pipeline into `candidate_facts`
(docs/USER_FLOWS.md §1) — has no writer anywhere in this codebase yet; upload UI and extraction
still land in a later phase. Distinct from `resumes`/`resume_versions` below (Phase 7A's logical
résumé identity + immutable version history), which is what freed this table's old `resumes` name.

| column              | type                                                        | notes                                                     |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `id`                | `uuid pk`                                                   |                                                           |
| `user_id`           | `uuid not null references auth.users(id) on delete cascade` |                                                           |
| `file_path`         | `text not null`                                             | Supabase Storage path, private bucket scoped by `user_id` |
| `file_name`         | `text not null`                                             | original filename                                         |
| `label`             | `text`                                                      | user-facing version label, e.g. "SWE — 2026"              |
| `is_primary`        | `boolean not null default false`                            |                                                           |
| `extraction_status` | `text not null default 'PENDING'`                           | `PENDING, PROCESSING, COMPLETE, FAILED`                   |
| `extracted_at`      | `timestamptz`                                               |                                                           |

Indexes: `(user_id)`. RLS: standard, and Storage bucket policies mirror the same
`auth.uid() = user_id` check on the object path prefix (when a bucket actually exists — none does
today; see "Storage" note in Phase 7A's own writeup).

---

## `resumes` (Phase 7A)

Logical résumé *identity* — a name, a kind, and optional lineage back to the user's master résumé.
Carries no document content of its own; every actual snapshot of a résumé's content lives in
`resume_versions` below, immutable, one-to-many under this row.

| column             | type                                                        | notes                                                                                                        |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid pk`                                                   |                                                                                                               |
| `user_id`           | `uuid not null references auth.users(id) on delete cascade` |                                                                                                               |
| `name`              | `text not null`                                             | user-facing, renameable                                                                                      |
| `kind`              | `text not null`                                             | `MASTER, TAILORED`                                                                                            |
| `parent_resume_id`  | `uuid`                                                      | nullable; composite FK to `resumes(user_id, id)`, `on delete set null (parent_resume_id)`; must reference a `MASTER` resume owned by the same user (trigger-enforced) |
| `created_at`, `updated_at` | `timestamptz`                                        |                                                                                                               |

Unique (partial): `(user_id) where kind = 'MASTER'` — at most one MASTER résumé per user,
database-enforced. Check: a MASTER résumé cannot itself carry a `parent_resume_id`. Indexes:
`(user_id)`, `(parent_resume_id)`. RLS: standard four-policy pattern (see "RLS policy pattern"
below) — an ordinary user-editable identity row, not immutable history.

---

## `resume_versions` (Phase 7A)

Immutable snapshot of one `resumes` row's state — editing a résumé always creates a new version;
nothing ever updates a version's own row in place (database-enforced, same
`reject_immutable_row_mutation` trigger job_snapshots/submission_packets use).

| column             | type                                                        | notes                                                                                                 |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid pk`                                                   |                                                                                                        |
| `user_id`           | `uuid not null references auth.users(id) on delete cascade` |                                                                                                        |
| `resume_id`         | `uuid not null`                                             | composite FK to `resumes(user_id, id)`, `on delete cascade`                                            |
| `version_number`    | `int not null`                                              | server-computed only (see `create_resume_version` below), never client-supplied; unique per `resume_id` |
| `display_name`      | `text not null`                                             | e.g. "My Resume -- Microsoft -- PM Intern" (see résumé naming helper, `packages/shared`)                |
| `snapshot_format`    | `text not null default 'METADATA_ONLY'`                    | `METADATA_ONLY` (Phase 7A — no content, just identity) or `STRUCTURED_V1` (Phase 7C — `snapshot_payload` is a real `StructuredResumeV1` JSON document); widened additively, never in advance of the format it describes actually existing (migration 0022) |
| `snapshot_payload`  | `jsonb`                                                     | null while `snapshot_format = 'METADATA_ONLY'`; a non-null `StructuredResumeV1` object while `snapshot_format = 'STRUCTURED_V1'` — both directions database-enforced (`resume_versions_snapshot_payload_matches_format`), never a fabricated placeholder either way. The JSON itself also carries its own `schemaVersion` field, independent of this column, so a future `STRUCTURED_V2` can exist without ever reinterpreting an existing `STRUCTURED_V1` row |
| `created_at`        | `timestamptz`                                               |                                                                                                        |

Unique: `(resume_id, version_number)`. Indexes: `(user_id)`, `(resume_id)`. RLS: `select`/`delete`
for `authenticated`, scoped by `user_id` — deliberately **no** ordinary `insert`/`update` policy
(same deviation as `job_snapshots`/`requirement_mapping_runs`): `version_number` must never be
client-supplied or racy, so every version is created exclusively through the `create_resume_version`
RPC below. Deletion *is* ordinary — the real "a submitted version can never be deleted" invariant is
enforced structurally by `submission_packets.resume_version_id`'s `on delete restrict` FK (Phase
7B), not by withholding delete.

**Phase 7C — structured content is canonical, LaTeX is derived.** `StructuredResumeV1`
(`packages/shared`) is the one thing actually snapshotted; LaTeX is generated from it on demand
by a pure function (`renderStructuredResumeToLatex`) and never itself stored — the one exception
is an explicit user-authored "custom LaTeX override," stored as a field *inside* the same JSON
payload (`renderOverride`), since it cannot be derived from anything else. See
`docs/RESUME_STUDIO.md` for the full design record, including why PDF compilation is explicitly
deferred (no sandboxed compilation environment exists in this deployment yet).

### `create_resume_version` (Phase 7A)

The one atomic, concurrency-safe path for creating a version — row-locks the parent `resumes` row
(`select ... for update`, same pattern as `increment_ai_request_usage`/`mark_application_applied`)
so two concurrent calls for the same résumé serialize instead of racing on
`max(version_number) + 1`; `unique(resume_id, version_number)` is the second, independent
guarantee. `security invoker`, granted only to `service_role` — called via the admin client from a
Next.js server action, with `userId` derived from the verified session, never a client-supplied
field.

### `save_reviewed_tailored_resume` (Phase 7F)

The one atomic path for persisting a reviewed Phase 7E tailoring draft (`docs/IMPLEMENTATION_PLAN.md`
"Phase 7F"). Row-locks the `applications` row for the transaction and re-checks two optimistic-
concurrency anchors against it before doing anything else: the caller's claimed
`p_expected_working_resume_version_id`/`p_expected_job_snapshot_id` must still match the row's
current `working_resume_version_id`/`job_snapshot_id`, or the function raises `stale_base_resume`/
`stale_job_context` (with the row's actual current value as the exception `DETAIL`) — the real
concurrency guarantee: two saves generated from the same stale base cannot both succeed, since the
second one observes the first's already-committed pointer update once it acquires the lock.
Either appends the next version to an existing logical résumé (`p_target_resume_id`) or creates a
new TAILORED one first (`p_new_resume_name`/`p_new_resume_parent_id`, reusing
`enforce_resume_parent_is_master`'s existing lineage-validity trigger) — exactly one of the two,
enforced at the top of the function body. Computes the next version number under the same
row-lock-then-insert pattern as `create_resume_version` (a second, independent path, not a
refactor of it — the two have different enough parameter shapes that sharing one function would
obscure both). Sets `applications.working_resume_version_id` to the new version in the same
transaction. `security invoker`, granted only to `service_role`, same calling convention as
`create_resume_version`. Never references `submission_packets` — no parameter, no code path
reaches it, so a submitted résumé's frozen record is structurally unreachable from this function.

---

## `jobs`

Represents an extracted job posting — not tied to a single user, since the same public
posting could be analyzed by multiple users, but the _extraction record_ is user-attributed
because it captures the DOM at the time that user's extension ran.

| column                     | type                                                        | notes                                                             |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `id`                       | `uuid pk`                                                   |                                                                   |
| `user_id`                  | `uuid not null references auth.users(id) on delete cascade` |                                                                   |
| `company`                  | `text`                                                      |                                                                   |
| `title`                    | `text`                                                      |                                                                   |
| `location`                 | `text`                                                      |                                                                   |
| `employment_type`          | `text`                                                      |                                                                   |
| `description`              | `text`                                                      |                                                                   |
| `responsibilities`         | `text[] not null default '{}'`                              |                                                                   |
| `qualifications`           | `text[] not null default '{}'`                              |                                                                   |
| `preferred_qualifications` | `text[] not null default '{}'`                              |                                                                   |
| `skills`                   | `text[] not null default '{}'`                              |                                                                   |
| `source_url`               | `text`                                                      |                                                                   |
| `platform_type`            | `text`                                                      | `GENERIC, GREENHOUSE, LEVER, WORKDAY`                             |
| `raw_extraction`           | `jsonb`                                                     | full adapter output, for debugging/re-ranking without re-scraping |

Indexes: `(user_id)`, `(user_id, source_url)`. RLS: standard.

---

## `applications`

| column                 | type                                                                               | notes                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | `uuid pk`                                                                          |                                                                                                                                                                                                                                                                                                                                                                                      |
| `user_id`              | `uuid not null references auth.users(id) on delete cascade`                        |                                                                                                                                                                                                                                                                                                                                                                                      |
| `job_id`               | `uuid references jobs(id) on delete set null`                                      |                                                                                                                                                                                                                                                                                                                                                                                      |
| `resume_id`            | `uuid references resume_uploads(id) on delete set null`                            | legacy — table renamed from `resumes` in migration 0020; still unused by any code path                                                                                                                                                                                                                                                                                              |
| `working_resume_version_id` | `uuid`                                                                        | nullable; composite FK to `resume_versions(user_id, id)`, `on delete set null` (Phase 7B) — the currently-selected "planning to submit this" résumé version; ordinarily mutable right up until APPLIED, at which point `mark_application_applied` freezes it into the new packet's `resume_version_id` and this column itself keeps changing freely afterward                    |
| `company`              | `text not null`                                                                    | denormalized for fast filtering even if `job_id` is later nulled                                                                                                                                                                                                                                                                                                                     |
| `title`                | `text not null`                                                                    |                                                                                                                                                                                                                                                                                                                                                                                      |
| `status`               | `text not null default 'SAVED'`                                                    | `SAVED, IN_PROGRESS, APPLIED, APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW, ACTION_REQUIRED, OFFER, REJECTED, WITHDRAWN, UNKNOWN`                                                                                                                                                                                                                                                     |
| `notes`                | `text`                                                                             |                                                                                                                                                                                                                                                                                                                                                                                      |
| `applied_at`           | `timestamptz`                                                                      | set only by the explicit "mark as applied" action, alongside `status = 'APPLIED'`                                                                                                                                                                                                                                                                                                    |
| `location`             | `text`                                                                             | denormalized from the job at save time (Phase 4C)                                                                                                                                                                                                                                                                                                                                    |
| `source_url`           | `text`                                                                             | denormalized from the job's `source_url` at save time — survives `job_id` being nulled                                                                                                                                                                                                                                                                                               |
| `canonical_url`        | `text`                                                                             | `source_url` normalized (query string, fragment, trailing slash stripped — `packages/shared`'s `canonicalizeUrl`); tier-2 dedup key                                                                                                                                                                                                                                                  |
| `ats_provider`         | `text`                                                                             | `GENERIC, GREENHOUSE, LEVER, WORKDAY` — denormalized from `jobs.platform_type`                                                                                                                                                                                                                                                                                                       |
| `external_id`          | `text`                                                                             | requisition/job ID, when reliably detected — tier-1 dedup key; no current extractor populates this yet                                                                                                                                                                                                                                                                               |
| `autofill_summary`     | `jsonb`                                                                            | counts only — `{approved, filled, skipped, failed, unresolved, manual}`, validated by `autofillSummarySchema`. No per-field content                                                                                                                                                                                                                                                  |
| `unresolved_fields`    | `jsonb`                                                                            | sanitized array of `{label, classification, status, reason}` — never a value, never a DOM locator, validated by `unresolvedFieldSummarySchema`                                                                                                                                                                                                                                       |
| `job_snapshot_id`      | `uuid references job_snapshots(id) on delete set null (job_snapshot_id)`           | Phase 5A — points at the immutable posting content captured when this application was last saved; **frozen** (never repointed) once `status` moves past `SAVED`/`IN_PROGRESS`, see "Job snapshots" below                                                                                                                                                                             |
| `submission_packet_id` | `uuid references submission_packets(id) on delete set null (submission_packet_id)` | Phase 5B.1 — set exactly once, atomically, the first time `status` becomes `APPLIED` through the canonical `mark_application_applied` function; never repointed afterward. `null` for an application that has never been APPLIED under this mechanism, **including a legacy application that was already `APPLIED` before this migration shipped** — see "Submission packets" below. |

Indexes: `(user_id)`, `(user_id, status)`, `(user_id, company)`, `(user_id, applied_at desc)`,
`(job_snapshot_id)`, `(submission_packet_id)`, unique partial `(user_id, canonical_url) where canonical_url is not null
and external_id is null`, unique partial `(user_id, ats_provider, external_id) where
external_id is not null`.
RLS: standard.

### Extension-save duplicate prevention (`upsert_application_from_extension`, Phase 4C/4D)

The extension's save flow (`POST /api/applications`) never does a plain client-side
select-then-insert — it calls **`upsert_application_with_snapshot`** (Phase 5A, migration
`0010`), a separately-named wrapper that captures/reuses the immutable job snapshot (see below)
and then calls this `security invoker` Postgres function verbatim, unchanged, inside the same
transaction. (A new, separately-named wrapper rather than adding parameters to this function
in place — `CREATE OR REPLACE FUNCTION` cannot change an existing function's argument list
without creating an ambiguous PostgREST overload.) `upsert_application_from_extension` itself
atomically finds-or-creates the tracked application using a strict preference order, each tier
scoped so it can never collapse two genuinely different applications:

1. **`(user_id, ats_provider, external_id)`** — the strongest signal, when a requisition ID is
   available.
2. **`(user_id, canonical_url)`**, excluding rows already claimed by a distinct `external_id`
   — without that exclusion, two different requisitions sharing one generic apply-page URL
   (a canonical URL strips the query string entirely) would incorrectly merge.
3. **`(user_id, lower(company), lower(title))`**, only among rows with neither a canonical URL
   nor an external ID — deliberately _not_ a database uniqueness constraint (a company/title
   match alone can describe two genuinely different openings), so this tier is a best-effort,
   row-locked application-layer check with an accepted narrow race window under true
   concurrency; tiers 1–2 are enforced by real partial unique indexes and are fully race-free
   (`unique_violation` triggers an automatic, bounded retry as an update instead of a
   duplicate insert).

The function also: independently re-verifies `job_id` belongs to the calling `user_id` (it
runs via the service-role admin client, so RLS does not apply — this check is the enforcement
point); never regresses `status` backward once it has moved past `SAVED`/`IN_PROGRESS` (e.g. a
plain save after "mark as applied" leaves `APPLIED` untouched); and normalizes empty-string
`external_id`/`canonical_url` to `null` so an empty string can never masquerade as a distinct
dedup key. Verified against a real Postgres instance: create, repeated-save-updates,
per-tier separation, 8-way true concurrent saves (both keyed tiers), status non-regression,
and job-ownership rejection all pass — see `docs/IMPLEMENTATION_PLAN.md` Phase 4D.

**Phase 5A security fix**: `upsert_application_from_extension` is now granted to
`service_role` only (`revoke ... from public, anon, authenticated`) — previously it was also
granted to `authenticated`, which meant a signed-in user could call it directly via
`supabase.rpc(...)` with a `p_user_id` of their choosing; since the function only re-verifies
"does `p_job_id` belong to `p_user_id`" (not "is the caller actually `p_user_id`"), this was a
confused-deputy privilege-escalation path against any job whose id an attacker could learn.
The same server-only grant pattern is applied to every Phase 5A function below.

Approved/edited generated answers are linked to the saved application by updating the
_existing_ `generated_answers` row (`user_decision`, `final_text`, `application_id` —
`recordOwnGeneratedAnswerDecision`, scoped by `user_id` _and_ `job_id`) rather than inserting a
new row, so repeated saves never duplicate answer-usage records.

### `job_snapshots` (Phase 5A)

Immutable, versioned archive of a job posting's content, captured at save time — the "jobs"
table is mutable (re-analysis overwrites it), so without this table the exact posting an
application was based on could silently disappear or change out from under it.

| column                                                                                                       | type                                                        | notes                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                         | `uuid pk`                                                   |                                                                                                           |
| `user_id`                                                                                                    | `uuid not null references auth.users(id) on delete cascade` |                                                                                                           |
| `source_job_id`                                                                                              | `uuid not null`                                             | **not a foreign key, deliberately** — lineage only; see "Immutability" below                              |
| `company`, `title`                                                                                           | `text not null`                                             |                                                                                                           |
| `location`, `employment_type`, `source_url`, `external_id`, `description`                                    | `text`                                                      |                                                                                                           |
| `required_qualifications`, `preferred_qualifications`, `responsibilities`, `skills`, `locations`             | `text[]`                                                    |                                                                                                           |
| `salary_min`, `salary_max`                                                                                   | `numeric`                                                   | nullable — not currently extracted, see "Field-source honesty" below                                      |
| `salary_currency`, `work_mode`, `remote_location_restrictions`, `work_authorization_language`, `source_type` | `text`                                                      | all nullable, same reason                                                                                 |
| `content_fingerprint`                                                                                        | `text not null`                                             | `"v1:" + sha256hex` of the canonicalized content — see "Fingerprint" below                                |
| `content_truncated`                                                                                          | `boolean not null default false`                            | true if any field was cut down to its storage cap                                                         |
| `truncated_fields`                                                                                           | `text[] not null default '{}'`                              | which fields, so the UI can show an honest notice, never silently present a truncated posting as complete |
| `captured_at`, `created_at`                                                                                  | `timestamptz`                                               |                                                                                                           |

Indexes: unique `(user_id, source_job_id, content_fingerprint)` (dedup/versioning key),
`(user_id)`, `(source_job_id)`.

**Immutability, enforced at the database level, not by convention**: RLS grants `authenticated`
**select only** — no insert/update/delete policy at all, since a direct insert would bypass
sanitization/fingerprinting/capture rules entirely. A `before update` trigger
(`reject_immutable_row_mutation`) unconditionally rejects every update, for _every_ role
including `service_role` — RLS bypass does not bypass triggers. This is also why
`source_job_id` has no foreign key: `jobs(id) on delete set null` would require the FK
enforcement mechanism to issue an `UPDATE` against this table when a `jobs` row is deleted,
which the immutability trigger would reject — removing the FK (keeping the column as plain,
permanent lineage metadata, `not null` since every real capture path starts from a verified
job) resolves the conflict entirely rather than special-casing the trigger.

**Fingerprint**: every stored content field (including `source_url`/`external_id` — excluding
them would let a save with genuinely different values silently reuse an old row) is
NFC-normalized, whitespace-collapsed (case preserved — "US" and "us" are not the same),
serialized as a fixed-key-order JSON object, SHA-256'd, and prefixed `"v1:"` so a future
normalization change can never collide with an old row. A new row is inserted only when the
fingerprint changes; an unchanged re-save reuses the existing row via
`(user_id, source_job_id, content_fingerprint)`.

**Field-source honesty**: `salary_*`, `work_mode`, `remote_location_restrictions`, and
`work_authorization_language` are nullable and currently always `null` — no extractor
populates them yet. The columns exist so a real extraction source can be wired up later without
another migration, not because they're already populated.

### `requirement_mapping_runs` (Phase 5A)

One row per requirement-analysis attempt for a snapshot — `provider`/`model`/`prompt_version`
live here, not duplicated onto every mapping row.

| column                                    | type                                                                                              | notes                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                                      | `uuid pk`                                                                                         |                                                                                    |
| `user_id`                                 | `uuid not null references auth.users(id) on delete cascade`                                       |                                                                                    |
| `job_snapshot_id`                         | `uuid not null references job_snapshots(id) on delete cascade` (composite, see "Ownership" below) |                                                                                    |
| `status`                                  | `text not null`                                                                                   | `PENDING, CURRENT, SUPERSEDED, FAILED`                                             |
| `provider`, `model`, `prompt_version`     | `text not null`                                                                                   |                                                                                    |
| `retrieval_fact_count`                    | `int not null default 0`                                                                          |                                                                                    |
| `failure_category`                        | `text`                                                                                            | `provider_error, validation_failed, refusal, rate_limited`; only set when `FAILED` |
| `created_at`, `completed_at`, `failed_at` | `timestamptz`                                                                                     | exact valid combinations enforced by a CHECK constraint, see below                 |

A CHECK constraint rules out every nonsensical status/timestamp combination (e.g. `PENDING`
with `completed_at` set, or `SUPERSEDED` without one) at the database level. A **partial
unique index** on `(job_snapshot_id) where status = 'CURRENT'` enforces at most one current
run per snapshot — concurrent generation attempts also serialize on a row lock inside
`promote_requirement_mapping_run` (below), so this index is a second, independent guarantee,
not the only one. `SUPERSEDED`/`FAILED` runs are retained (not deleted) for audit; only the
`CURRENT` run is ever surfaced to the UI. RLS: `authenticated` select-only, same reasoning as
`job_snapshots` — no blanket update-blocking trigger here, though, since this table has a
genuine, bounded, RPC-mediated status lifecycle (unlike the two immutable tables).

### `requirement_evidence_mappings` (Phase 5A)

Explainable per-requirement evidence, generated by `packages/ai`'s
`generate-requirement-mapping.ts` — the Phase 5A analog of `generated_answers`, but for "does
my background cover what this posting asks for" rather than one form field.

| column                       | type                                                                                  | notes                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`                         | `uuid pk`                                                                             |                                                                                              |
| `user_id`                    | `uuid not null references auth.users(id) on delete cascade`                           |                                                                                              |
| `run_id`                     | `uuid not null references requirement_mapping_runs(id) on delete cascade` (composite) |                                                                                              |
| `requirement_text`           | `text not null`, ≤500 chars                                                           |                                                                                              |
| `requirement_fingerprint`    | `text not null`                                                                       | dedup key within a run — `unique (run_id, requirement_fingerprint)`                          |
| `requirement_category`       | `text`                                                                                | `SKILL, EXPERIENCE, EDUCATION, CERTIFICATION, WORK_AUTHORIZATION, LOCATION, LANGUAGE, OTHER` |
| `required_or_preferred`      | `text not null`                                                                       | `REQUIRED, PREFERRED`                                                                        |
| `relationship`               | `text not null`                                                                       | `DIRECT, EQUIVALENT, INFERRED, MISSING`                                                      |
| `matched_facts`              | `jsonb not null default '[]'`                                                         | server-derived provenance, never model-generated — see below                                 |
| `explanation`                | `text not null`, ≤400 chars                                                           |                                                                                              |
| `confidence`                 | `numeric(3,2) not null`                                                               |                                                                                              |
| `requires_user_confirmation` | `boolean not null default true`                                                       | always `true` for `INFERRED` (CHECK constraint)                                              |

Two CHECK constraints enforce structural invariants the database, not just the application,
guarantees: `relationship = 'MISSING'` requires an _empty_ `matched_facts`; every other
relationship requires _at least one_. `relationship = 'INFERRED'` requires
`requires_user_confirmation = true`. Immutable once written (same `before update` trigger
pattern as `job_snapshots`) — a run's whole mapping set is inserted once, atomically, and never
touched again; supersession happens on the _run_, not on individual mapping rows.

**`matched_facts` provenance, not a bare `uuid[]`**: `[{"factId", "sourceTable", "factUpdatedAt"}, ...]`.
Approved facts live across five heterogeneous tables (`candidate_facts`, `experiences`,
`education`, `projects`, `skills`) with no common parent to foreign-key against, so — matching
the precedent `generated_answers.source_fact_ids` already set — integrity is enforced by
re-verification against live data (at both generation time and read time), not a DB-level FK.
`(sourceTable, factId)` is always the real compound key; a bare `factId` is never treated as
globally unique. `factUpdatedAt` reuses each fact table's existing `updated_at` column
(maintained by the same `set_updated_at` trigger every table already has) as the version
signal for detecting an edit since generation — deliberately not a new fact-content
fingerprint. On read, each matched fact resolves to one of four distinct states — `valid`,
`changed_since_analysis`, `unapproved`, `deleted` — never collapsed into a single boolean;
fact _content_ is never duplicated into this table, only id/table/timestamp.

**Ownership, enforced structurally, not just in RPC code**: `applications.job_snapshot_id`,
`requirement_mapping_runs.job_snapshot_id`, and
`requirement_evidence_mappings.run_id` are all **composite foreign keys**
(`(user_id, job_snapshot_id) references job_snapshots(user_id, id)`, etc. — each parent table
carries a matching `unique (user_id, id)` constraint to support this). A child row naming a
parent owned by a different user is rejected by the foreign key itself, not by application
logic that could have a bug. `applications`' composite FK uses Postgres 15+'s column-scoped
`on delete set null (job_snapshot_id)` so deleting a snapshot (not a capability this codebase
exposes today, but the FK is written defensively) nulls only that one column, never
`applications.user_id`.

**Generation lifecycle**: user-triggered only (`POST /api/job-snapshots/:id/requirements`),
never automatic on save. `create_pending_requirement_mapping_run` inserts a `PENDING` row
before the Claude call; a failure calls `mark_requirement_mapping_run_failed` (idempotent — a
duplicate report returns `false`, not an error) and never touches any mapping row, so a failed
generation can never disturb the last valid `CURRENT` set. A success calls
`promote_requirement_mapping_run`, which — inside one transaction — row-locks the snapshot,
structurally validates every `matched_facts` entry (shape, allowed `sourceTable` values,
UUID/timestamp validity, live ownership+approval re-check — defense-in-depth beneath the
app-layer allowlist check `packages/ai` already performed), inserts the new mapping rows,
supersedes whatever was `CURRENT`, and promotes the new run — all or nothing; there is no
partial promotion.

**Server-only functions**: `upsert_application_with_snapshot`,
`create_pending_requirement_mapping_run`, `mark_requirement_mapping_run_failed`,
`promote_requirement_mapping_run`, and the internal `_upsert_job_snapshot`/
`_approved_fact_versions` helpers are all granted to `service_role` only (`revoke ... from
public, anon, authenticated`) — the API routes that call them derive `user_id` from a verified
session (cookie or extension bearer token) and pass it explicitly; nothing trusts a
client-supplied id.

**APPLIED snapshot-freezing**: `upsert_application_with_snapshot` only repoints
`applications.job_snapshot_id` at the newly-captured snapshot when the application's status is
still `SAVED` or `IN_PROGRESS`. Once it's `APPLIED` (or any later lifecycle state), the
snapshot is still captured/deduped as usual, but the link is left untouched — an applied
application's historical record can't be silently repointed at a different posting by an
ordinary re-save. There is no amendment/correction workflow in Phase 5A; that's explicitly
deferred to Phase 5B.

### `submission_packets` (Phase 5B.1)

Immutable, historical record of what Career OS actually had persisted at the moment an
application was newly marked `APPLIED` — answers "what did I actually submit?" **This is not a
live projection**: it stores resolved values, never a live-re-resolving pointer, unlike
`requirement_evidence_mappings.matched_facts` — it must never change when the profile, résumé,
job posting, requirement mapping, or AI models change later.

| column                         | type                                                        | notes                                                                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | `uuid pk`                                                   |                                                                                                                                                                                                                                         |
| `user_id`                      | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                                                                                                                         |
| `application_id`               | `uuid not null`                                             | composite FK to `applications(user_id, id)`; `unique (user_id, application_id)` — **at most one packet per application, ever**, enforced structurally                                                                                   |
| `job_snapshot_id`              | `uuid`                                                      | nullable; composite FK to `job_snapshots(user_id, id)` — null if the application had no linked snapshot at freeze time                                                                                                                  |
| `resume_id`                    | `uuid`                                                      | legacy — composite FK to `resume_uploads(user_id, id)` (renamed from `resumes` in migration 0020); null for every packet, since no code path ever writes `applications.resume_id`. Superseded by `resume_version_id` below for every packet frozen from migration 0021 onward — never rewritten on an existing packet                    |
| `resume_version_id`            | `uuid`                                                      | composite FK to `resume_versions(user_id, id)`, `on delete restrict` (Phase 7B) — the exact résumé version actually submitted, frozen once at the same moment as everything else. Null when no working version was selected at freeze time, or when this packet predates migration 0021 (see legacy `resume_id` above) — both honest, distinguishable "no version recorded" states, never fabricated. Never changes after creation, even if the working version later changes or the application is reverted and re-applied |
| `requirement_mapping_run_id`   | `uuid`                                                      | nullable; composite FK to `requirement_mapping_runs(user_id, id)` — a reference into an already-immutable table, never duplicated content; null if no `CURRENT` run existed for the snapshot at freeze time                             |
| `answers_snapshot`             | `jsonb not null default '[]'`                               | the literal, already-persisted `generated_answers` content for this application at freeze time — see "Truthfulness" below                                                                                                               |
| `autofill_summary`             | `jsonb`                                                     | copied from `applications.autofill_summary` at freeze time — that column stays ordinarily mutable after `APPLIED` (an extension "Save" overwrites it unconditionally regardless of status), so this is the frozen copy, not a live read |
| `unresolved_fields`            | `jsonb`                                                     | copied from `applications.unresolved_fields` at freeze time, same reasoning                                                                                                                                                             |
| `consistency_findings`         | `jsonb not null default '[]'`                               | the deterministic consistency-firewall findings (Phase 5B.2) computed and gated on at the exact moment this packet was created                                                                                                          |
| `consistency_acknowledgements` | `jsonb not null default '[]'`                               | which WARNING findings the user acknowledged, and when                                                                                                                                                                                  |
| `content_fingerprint`          | `text not null`                                             | `"v1:" + sha256hex` of the canonicalized packet content — `computeSubmissionPacketFingerprint`, same pattern as `job_snapshots.content_fingerprint`                                                                                     |
| `created_at`                   | `timestamptz`                                               |                                                                                                                                                                                                                                         |

**Truthfulness of `answers_snapshot`**: sourced exclusively from this application's own
`generated_answers` rows (`{generatedAnswerId, fieldLabel, fieldClassification, originalAnswer,
finalText, userDecision, sourceFactIds, confidence}` per entry) — Career OS only ever has a
literal value for a field if the user requested an AI suggestion for it, whether or not they
ultimately approved/edited/skipped it. A field the user typed directly into the employer's page,
or that the browser's own autofill completed, was never sent to Career OS and has **no entry
here** — this is a deliberate, documented limitation, not an oversight. Nothing is ever
reconstructed from today's profile and presented as historical.

**Immutability, enforced at the database level, exactly like `job_snapshots`**: RLS grants
`authenticated` **select only**; the same `before update` trigger
(`reject_immutable_row_mutation`) rejects every update for every role including `service_role`.
The only writer is `mark_application_applied` (below), `service_role`-only, called from
`markOwnApplicationApplied` (`packages/database`).

**Legacy `APPLIED` rows (temporal invariant)**: an application already `APPLIED` before this
migration shipped has `submission_packet_id = null` and stays that way forever. A repeated
"Mark as Applied" call on such a row is a pure no-op (current status is already `APPLIED`) — it
never fabricates a packet from today's data and labels it historical. There is no "generate a
packet now" action anywhere in this product; that would create fake history.

### `mark_application_applied` (Phase 5B.1)

The one atomic Postgres function for the entire canonical APPLIED transition — supersedes Phase
5B.0's plain multi-step `markOwnApplicationApplied` now that packet creation must be atomic with
the status transition. Inside one transaction: row-locks and re-verifies ownership of the
application, preserves (or sets, the first time) `applied_at`, creates at most one
`submission_packets` row (only when `applications.submission_packet_id` is still null — reused,
never re-created, on every later transition back into `APPLIED`), updates `applications.status`/
`applied_at`/`submission_packet_id`, and records a `STATUS_CHANGE` `application_events` row only
on a real transition (never on an idempotent repeat while already `APPLIED`). `service_role`-only,
same grant pattern as every Phase 5A function — `revoke ... from public, anon, authenticated`.
Deterministic consistency-firewall gating (Phase 5B.2) happens in TypeScript immediately before
this function is called, since the rule engine is explicitly pure/database-free; this function
trusts its `p_consistency_findings`/`p_consistency_acknowledgements` arguments as already-final,
validated content to freeze, not something it re-derives itself.

**Phase 7B**: gained one trailing parameter, `p_resume_version_id uuid default null`, frozen into
`resume_version_id` on a new packet exactly like every other `p_*` content argument — accepted but
ignored on the idempotent already-`APPLIED` branch, so a repeated call never swaps the frozen
résumé version even if the application's `working_resume_version_id` has since changed.

## `application_events`

Append-only timeline. Powers both manual status changes and confirmed Gmail-driven updates,
plus "undo for automated updates."

| column            | type                                                          | notes                                             |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `id`              | `uuid pk`                                                     |                                                   |
| `user_id`         | `uuid not null references auth.users(id) on delete cascade`   |                                                   |
| `application_id`  | `uuid not null references applications(id) on delete cascade` |                                                   |
| `event_type`      | `text not null`                                               | `STATUS_CHANGE, NOTE, EMAIL_MATCHED, MANUAL_EDIT` |
| `from_status`     | `text`                                                        | nullable                                          |
| `to_status`       | `text`                                                        | nullable                                          |
| `source`          | `text not null`                                               | `USER, GMAIL_SYNC, SYSTEM`                        |
| `email_signal_id` | `uuid references email_signals(id) on delete set null`        | nullable, set when `source = 'GMAIL_SYNC'`        |
| `reverted_at`     | `timestamptz`                                                 | set when the user undoes an automated update      |

Indexes: `(user_id)`, `(application_id, created_at)`. RLS: standard.

---

## `generated_answers`

| column                 | type                                                        | notes                                                                            |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                   | `uuid pk`                                                   |                                                                                  |
| `user_id`              | `uuid not null references auth.users(id) on delete cascade` |                                                                                  |
| `application_id`       | `uuid references applications(id) on delete cascade`        |                                                                                  |
| `job_id`               | `uuid references jobs(id) on delete set null`               |                                                                                  |
| `field_label`          | `text`                                                      | the form question/field this answers                                             |
| `field_classification` | `text`                                                      | see `docs/EXTENSION_DESIGN.md` taxonomy                                          |
| `answer`               | `text not null`                                             |                                                                                  |
| `confidence`           | `numeric(3,2) not null`                                     | 0.00–1.00                                                                        |
| `source_fact_ids`      | `uuid[] not null default '{}'`                              | provenance — every fact the answer relied on                                     |
| `reasoning_summary`    | `text`                                                      | short, user-facing only — never raw model chain-of-thought                       |
| `unsupported_claims`   | `text[] not null default '{}'`                              | non-empty means this row must never have been surfaced as usable; kept for audit |
| `requires_user_review` | `boolean not null default true`                             |                                                                                  |
| `user_decision`        | `text`                                                      | `APPROVED, EDITED, SKIPPED`, nullable until reviewed                             |
| `final_text`           | `text`                                                      | user-edited version, if any                                                      |

Indexes: `(user_id)`, `(application_id)`. RLS: standard.
Application-level invariant (enforced in `packages/ai`, not just documented): a row is only
ever created for the user to see if `unsupported_claims = '{}'` at generation time — see
`docs/AI_GROUNDING.md`.

---

## `extension_sessions`

Tracks active Chrome extension authentication so sessions can be listed/revoked from
`/settings` independent of web sessions.

| column         | type                                                        | notes                            |
| -------------- | ----------------------------------------------------------- | -------------------------------- |
| `id`           | `uuid pk`                                                   |                                  |
| `user_id`      | `uuid not null references auth.users(id) on delete cascade` |                                  |
| `token_hash`   | `text not null`                                             | hashed, never the raw token      |
| `device_label` | `text`                                                      | e.g. browser + OS, user-editable |
| `last_used_at` | `timestamptz`                                               |                                  |
| `expires_at`   | `timestamptz not null`                                      |                                  |
| `revoked_at`   | `timestamptz`                                               |                                  |

Indexes: `(user_id)`, unique `(token_hash)`. RLS: standard.

---

## `email_connections`

| column                    | type                                                        | notes                                                                 |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`                      | `uuid pk`                                                   |                                                                       |
| `user_id`                 | `uuid not null references auth.users(id) on delete cascade` |                                                                       |
| `provider`                | `text not null default 'gmail'`                             |                                                                       |
| `email_address`           | `text not null`                                             | the connected mailbox                                                 |
| `encrypted_refresh_token` | `text not null`                                             | encrypted at rest, see `docs/SECURITY_AND_PRIVACY.md`                 |
| `scopes`                  | `text[] not null default '{}'`                              |                                                                       |
| `status`                  | `text not null default 'ACTIVE'`                            | `ACTIVE, DISCONNECTED, ERROR`                                         |
| `last_synced_at`          | `timestamptz`                                               |                                                                       |
| `created_at`              | `timestamptz not null default now()`                        |                                                                       |
| `updated_at`              | `timestamptz not null default now()`                        | tracks `status` transitions (e.g. a failed refresh moving to `ERROR`) |

Unique: `(user_id, email_address)`, `(user_id, id)` (lets `email_signals` reference this table via
a composite FK — see below). Indexes: `(user_id)`. RLS: standard.

## `email_signals`

Deliberately minimal — never full email bodies (see `docs/EMAIL_INTEGRATION.md`).

| column                   | type                                                        | notes                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | `uuid pk`                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `user_id`                | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `email_connection_id`    | `uuid not null`                                             | composite FK `(user_id, email_connection_id) references email_connections(user_id, id) on delete cascade` — never a plain `id`-only reference, so a cross-user link is rejected by the database itself                                                                                                                                                                                                                                             |
| `provider_message_id`    | `text not null`                                             | for dedup                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sender`                 | `text`                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sender_domain`          | `text`                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `subject`                | `text`                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `received_at`            | `timestamptz`                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `matched_application_id` | `uuid references applications(id) on delete set null`       |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `classification`         | `text`                                                      | `APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW, ACTION_REQUIRED, OFFER, REJECTED, OTHER`                                                                                                                                                                                                                                                                                                                                                             |
| `confidence`             | `numeric(3,2)`                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `evidence`               | `text`                                                      | short snippet/reason, not the full email                                                                                                                                                                                                                                                                                                                                                                                                           |
| `confirmation_status`    | `text not null default 'PENDING'`                           | `PENDING, CONFIRMED, DECLINED, AUTO_APPLIED, NOT_APPLICABLE` — tracks whether a below-threshold match has been reviewed, so a declined suggestion never resurfaces identically on a later sync. Same role as `generated_answers.user_decision`. `AUTO_APPLIED` is set at insert time for matches meeting the 0.85 auto-apply threshold (already written to `application_events`); `NOT_APPLICABLE` for a zero-match or `OTHER`-classified message. |
| `processed_at`           | `timestamptz not null default now()`                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Unique: `(email_connection_id, provider_message_id)` — the dedup constraint referenced in
`docs/EMAIL_INTEGRATION.md`. Indexes: `(user_id)`, `(matched_application_id)`. RLS: standard.

---

## `user_settings`

| column                         | type                                                           | notes                                                                                 |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `user_id`                      | `uuid primary key references auth.users(id) on delete cascade` |                                                                                       |
| `gmail_integration_enabled`    | `boolean not null default false`                               | user's own toggle, still gated by the global `gmail_integration_enabled` feature flag |
| `ai_requests_this_period`      | `int not null default 0`                                       |                                                                                       |
| `ai_request_period_started_at` | `timestamptz not null default now()`                           |                                                                                       |
| `ai_request_limit`             | `int not null default 50`                                      | reserved for future plan-based limits, see `docs/IMPLEMENTATION_PLAN.md` Phase 8      |
| `theme`                        | `text not null default 'system'`                               |                                                                                       |

RLS: standard.

## `feature_flags`

Not user-owned — small global/admin table. No `user_id`; RLS restricts writes to
service-role only, reads to authenticated users (flags are not secret, just admin-controlled).

| column        | type                             | notes                                                      |
| ------------- | -------------------------------- | ---------------------------------------------------------- |
| `key`         | `text primary key`               | e.g. `public_signups_enabled`, `gmail_integration_enabled` |
| `enabled`     | `boolean not null default false` |                                                            |
| `description` | `text`                           |                                                            |
| `updated_at`  | `timestamptz`                    |                                                            |

RLS: `select` for any authenticated (or even anon, for the signup-gate check) role; no
`insert/update/delete` policy for regular users — changed only via service-role/migration.

---

## `contacts` (Phase 6A, extended in Phase 6C)

Private, user-owned networking data — one row per person the user knows, reusable across many
applications (never duplicated per application). Ordinary editable CRM data, not
immutable-history like `job_snapshots`/`submission_packets`: a user can freely edit or delete
their own contacts. Only `display_name` and `source` are required — a contact like "Jane — UF
alum at Microsoft" is valid with nothing else filled in.

| column            | type                                                        | notes                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `uuid pk`                                                   |                                                                                                                                                                                                                       |
| `user_id`         | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                                                                                                       |
| `display_name`    | `text not null`                                             | the only required human-identity field; `check (length(trim(display_name)) > 0)`                                                                                                                                      |
| `first_name`      | `text`                                                      | nullable                                                                                                                                                                                                              |
| `last_name`       | `text`                                                      | nullable                                                                                                                                                                                                              |
| `email`           | `text`                                                      | nullable; not unique — duplicate detection is advisory only, see below                                                                                                                                                |
| `phone`           | `text`                                                      | nullable                                                                                                                                                                                                              |
| `linkedin_url`    | `text`                                                      | nullable                                                                                                                                                                                                              |
| `current_company` | `text`                                                      | nullable; free text, **not** a foreign key — there is no `companies` table in Phase 6A                                                                                                                                |
| `current_title`   | `text`                                                      | nullable                                                                                                                                                                                                              |
| `location`        | `text`                                                      | nullable                                                                                                                                                                                                              |
| `notes`           | `text`                                                      | nullable; never logged (see `docs/SECURITY_AND_PRIVACY.md`)                                                                                                                                                           |
| `source`          | `text not null`                                             | `MANUAL, APPLICATION_CONTEXT, OTHER` — only values Phase 6A can actually produce; widened additively (like `ai_usage_events.task_type`) when a real new source ships, e.g. Gmail suggestions in a later Phase 6 slice |
| `follow_up_at`    | `timestamptz`                                               | nullable (Phase 6C, migration 0019) — an explicit, user-chosen reminder date/time; null (the default) means no reminder. Career OS never invents or infers this value; see "Networking follow-up reminders" below     |
| `created_at`      | `timestamptz`                                               |                                                                                                                                                                                                                       |
| `updated_at`      | `timestamptz`                                               |                                                                                                                                                                                                                       |

`unique (user_id, id)` lets `contact_tags`/`application_contacts` below use a composite FK back
to this table, the same pattern `applications`/`resume_uploads` (named `resumes` at the time)
adopted in migration 0013. A partial
index `(user_id, follow_up_at) where follow_up_at is not null` (Phase 6C) backs the "due
reminders" query — see "Networking follow-up reminders" below.

**No `companies` table**: `current_company` stays free text, same posture as `applications.
company`. An application's People section may copy the application's `company` into a new
contact's `current_company` as a one-time prefill convenience — it is never a live-syncing
relationship.

**Duplicate detection is advisory, never auto-merge**: before creating or editing a contact,
`findOwnPossibleDuplicateContacts` (`packages/database`) checks the user's own contacts for an
exact normalized email match, an exact normalized LinkedIn URL match, or a normalized
`display_name` + `current_company` match (`packages/shared`'s `contact-duplicate-detection.ts`
normalizers). The UI shows candidates and lets the user cancel or proceed anyway — nothing here
ever blocks creation or silently reuses an existing row.

RLS: standard four-policy pattern (see "RLS policy pattern" below).

## `contact_tags` (Phase 6A)

Multi-select, longer-lived relationship classification per contact (e.g. `ALUMNI`, `RECRUITER`,
`FRIEND`) — distinct from `application_contacts.role` below, which is the person's function on
one specific application. Linking a contact to an application with a given role never mutates
their tags, and vice versa.

| column       | type                                                        | notes                                                                                                                                             |
| ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`    | `uuid not null references auth.users(id) on delete cascade` | part of the primary key                                                                                                                           |
| `contact_id` | `uuid not null`                                             | composite FK to `contacts(user_id, id)` on delete cascade; part of the primary key                                                                |
| `tag`        | `text not null`                                             | `RECRUITER, HIRING_MANAGER, EMPLOYEE, ALUMNI, MENTOR, PROFESSOR, FRIEND, CLASSMATE, REFERRER, NETWORKING_CONTACT, OTHER`; part of the primary key |
| `created_at` | `timestamptz`                                               |                                                                                                                                                   |

Primary key `(user_id, contact_id, tag)` — a contact may hold many tags; the exact same tag
twice is a structural no-op, not a new fact. No `update` policy/trigger: every column is part of
the key, so changing a contact's tags is a delete-then-insert
(`packages/database`'s `replaceOwnContactTags`), not a row update. RLS: `select`/`insert`/
`delete` for `authenticated`, scoped by `user_id`.

## `application_contacts` (Phase 6A)

Join table linking a reusable `contacts` row to one specific `applications` row, with a role
describing that person's function on **this** application.

| column           | type                                                        | notes                                                                                                |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `user_id`        | `uuid not null references auth.users(id) on delete cascade` | part of the primary key                                                                              |
| `application_id` | `uuid not null`                                             | composite FK to `applications(user_id, id)` on delete cascade; part of the primary key               |
| `contact_id`     | `uuid not null`                                             | composite FK to `contacts(user_id, id)` on delete cascade; part of the primary key                   |
| `role`           | `text not null`                                             | `RECRUITER, HIRING_MANAGER, REFERRER, INTERVIEWER, EMPLOYEE_CONTACT, OTHER`; part of the primary key |
| `created_at`     | `timestamptz`                                               |                                                                                                      |

Primary key `(user_id, application_id, contact_id, role)` — one contact may hold more than one
role on the same application (e.g. both `REFERRER` and `EMPLOYEE_CONTACT`), but the exact same
`(application, contact, role)` triple twice is rejected structurally, not just by application
logic. Both composite FKs make a cross-user application/contact pairing impossible at the
database level, not merely checked in `packages/database`. Deleting a contact removes its
`application_contacts` rows but never the application; deleting an application removes its
`application_contacts` rows but never the contact — neither cascade reaches the other entity.
Index `(user_id, contact_id)` supports "applications linked to this contact" (the reverse of the
primary key's own `application_id`-first order). No `update` policy/trigger, same reasoning as
`contact_tags`. RLS: `select`/`insert`/`delete` for `authenticated`, scoped by `user_id`.

**Deferred to a later Phase 6 slice (not in 6A)**: `contact_interactions` (added in Phase 6B,
below), `follow_up_at`/reminders, `source_email_signal_id`/Gmail contact suggestions, a
`companies` table, AI-generated outreach/coffee-chat prep. See `docs/IMPLEMENTATION_PLAN.md`
"Phase 6" for the full list of what each slice deliberately excludes.

## `contact_interactions` (Phase 6B)

A factual, user-editable record of past interactions with a contact — answers "what history do
I have with this person?" Ordinary editable CRM data like `contacts` itself (not immutable-
history like `job_snapshots`/`submission_packets`): a user can freely correct or remove their own
interaction records.

| column             | type                                                        | notes                                                                                                                             |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | `uuid pk`                                                   |                                                                                                                                   |
| `user_id`          | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                   |
| `contact_id`       | `uuid not null`                                             | composite FK to `contacts(user_id, id)` on delete cascade                                                                         |
| `interaction_type` | `text not null`                                             | `EMAIL, CALL, COFFEE_CHAT, MEETING, LINKEDIN_MESSAGE, EVENT, INTRODUCTION, NOTE, OTHER` — the medium, not the purpose (see below) |
| `direction`        | `text`                                                      | nullable; `INBOUND, OUTBOUND, MUTUAL` — many interaction types have no natural direction and this is never forced                 |
| `occurred_at`      | `timestamptz not null`                                      | when the interaction actually happened (user-editable, defaults to "now" in the UI) — not the row's `created_at`                  |
| `subject`          | `text`                                                      | nullable                                                                                                                          |
| `notes`            | `text`                                                      | nullable; never logged (see `docs/SECURITY_AND_PRIVACY.md`)                                                                       |
| `application_id`   | `uuid`                                                      | nullable; composite FK to `applications(user_id, id)`, `on delete set null (application_id)` — see "Application context" below    |
| `source`           | `text not null default 'MANUAL'`                            | only `MANUAL` exists in Phase 6B — the user's own "Log interaction" form                                                          |
| `created_at`       | `timestamptz`                                               |                                                                                                                                   |
| `updated_at`       | `timestamptz`                                               |                                                                                                                                   |

**Medium, not purpose**: `interaction_type` deliberately excludes purpose-shaped values like
`THANK_YOU`, `FOLLOW_UP`, or `REFERRAL_REQUEST` — those describe _why_ an interaction happened,
which belongs in `subject`/`notes` (or a later, explicit purpose field if actually needed), not a
second axis conflated onto the medium.

**Application context**: `application_id` is optional, and when set must be one of _this
contact's_ already-linked applications — an `application_contacts` row for the same
`(user_id, contact_id, application_id)` must already exist. This is a business-rule check
enforced in `packages/database` (`createOwnContactInteraction`/`updateOwnContactInteraction`),
not a table constraint — a CHECK constraint can't reference another table, and unlike the
composite FK below, this isn't a cross-user security boundary.

**Deletion semantics** — deliberately asymmetric, matching what history should and shouldn't
survive:

- Deleting the **contact** cascades to delete its interactions (`on delete cascade`) — an
  interaction has no meaning once the contact it's about is gone.
- Deleting the **application** does _not_ delete the interaction: only `application_id` on that
  row is set to null (`on delete set null (application_id)`, Postgres 15+'s column-scoped
  variant for a composite FK — the same pattern `applications.submission_packet_id` established
  in migration 0013). `user_id` is never touched. A real conversation with a real person must
  survive losing its application context.
- Deleting the **interaction** never deletes the contact, the application, contact tags, or
  `application_contacts` rows — only that one row is removed.

RLS: the ordinary four-policy pattern (see "RLS policy pattern" below) — unlike Phase 6A's
`contact_tags`/`application_contacts`, every column here besides the key is real mutable payload,
so `update` is a genuine row update (users can correct mistakes), not a delete-then-insert.

Index `(user_id, contact_id, occurred_at desc)` backs the one query this table's UI actually
needs: one contact's timeline, most recent first.

**Deferred to a later Phase 6 slice (not in 6B)**: a `GMAIL_SIGNAL` source, `follow_up_at`/
reminders, a networking next-action engine, a denormalized `last_interaction_at` anywhere, any
AI (coffee-chat prep, outreach drafting, summaries). See `docs/IMPLEMENTATION_PLAN.md` "Phase 6B"
for the full list.

## Networking follow-up reminders (Phase 6C)

`contacts.follow_up_at` (see the `contacts` table above) is the entire persisted model — no
`networking_reminders` table, no recurrence, no reminder history. Setting, rescheduling, or
clearing it is ordinary contact editing under the existing `contacts` RLS; no new policy exists
because none is needed.

**Derived, never persisted**: the networking next action (`FOLLOW_UP_WITH_CONTACT` when
`follow_up_at` is due, `NO_ACTION` otherwise) is computed at read time by
`deriveNetworkingNextAction` (`packages/shared`) — the same posture as Phase 5C's application
next-action engine, and for the same reason: a persisted `next_action` column would go stale the
moment a reminder is set, rescheduled, or cleared, requiring careful invalidation Phase 5C
already decided isn't worth the correctness risk. There is no `next_actions` table and no
`next_action_due_at` column anywhere in this schema.

**"Mark follow-up done" only clears the column** — it does not insert a `contact_interactions`
row or any other completion record. Career OS cannot know the user actually contacted the
person just because they dismissed a reminder; a user who wants that history logs an interaction
separately (Phase 6B). This is a deliberate distinction, not an oversight.

**Not a background reminder**: `follow_up_at` being due means only that Career OS will show it
the next time the user opens the product. No browser notification, email, SMS, or cron job of
any kind reads this column — see `docs/SECURITY_AND_PRIVACY.md` if that ever changes.

**`SEND_THANK_YOU` was considered and explicitly deferred** — see
`docs/IMPLEMENTATION_PLAN.md` "Phase 6C" for the full reasoning (short version: the Phase 6B
interaction model has no way to tell whether a thank-you was already sent, so a rule based on
"no later interaction" would be guessing, not deriving).

---

## RLS policy pattern

Every user-owned table above follows the same four policies (illustrated for `applications`,
identical shape elsewhere):

```sql
alter table applications enable row level security;

create policy "select own applications" on applications
  for select using (auth.uid() = user_id);

create policy "insert own applications" on applications
  for insert with check (auth.uid() = user_id);

create policy "update own applications" on applications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own applications" on applications
  for delete using (auth.uid() = user_id);
```

`packages/database` wraps every query so `user_id` is never taken from client input — it is
always read from the verified session server-side, so RLS and the application-layer check
agree by construction rather than by convention.

**Deliberate exception (Phase 5A, extended in Phase 5B.1)**: `job_snapshots`,
`requirement_mapping_runs`, `requirement_evidence_mappings`, and `submission_packets` ship with
`select`-only RLS for `authenticated` — no `insert`/`update`/`delete` policy. All writes to these
four tables happen exclusively through server-only Postgres functions (see "Server-only
functions" above and `mark_application_applied`), which are granted to `service_role` only and
bypass RLS entirely as a role property, so an RLS write policy for `authenticated` was never
actually required for them to function — keeping one would only have opened a
direct-PostgREST-write bypass around sanitization/fingerprinting/contract validation.
`job_snapshots`, `requirement_evidence_mappings`, and `submission_packets` additionally have a
`before update` trigger blocking every update unconditionally, for every role — the true
immutability guarantee, since RLS alone can't stop `service_role`.

**A second, narrower deliberate exception (Phase 5B hardening, migration 0015)**: `applications`
keeps the ordinary four-policy shape above — an authenticated user can still freely
insert/update/delete their own rows — but an adversarial review found that this alone let a
direct PostgREST call (using a user's own legitimate session JWT, never a stolen credential)
set `status = 'APPLIED'` (or `applied_at`/`submission_packet_id`) without ever going through
`mark_application_applied`, bypassing packet creation and the consistency firewall entirely. RLS
was left exactly as-is (weakening it was explicitly out of scope); instead, migration 0015 adds a
`before insert or update` trigger (`reject_direct_applied_transition`) that rejects any write
transitioning `status` into `'APPLIED'`, or setting `applied_at`/`submission_packet_id` from null
to non-null, unless `current_user = 'service_role'` — which is exactly the role
`mark_application_applied` always executes as. Every ordinary write that doesn't attempt one of
those three transitions (a new non-APPLIED application, an edit to any column on an application
regardless of its current status, a later-status move via `changeOwnApplicationStatus`) is
completely unaffected. See docs/IMPLEMENTATION_PLAN.md's "Phase 5B hardening" section for the
full design, including how `revertApplicationEvent`'s one accepted exception to this rule
(restoring a genuinely historical APPLIED state) stays safe.
