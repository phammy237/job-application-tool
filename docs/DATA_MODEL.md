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
| `public_slug`               | `text unique`                                                  | nullable; reserved for future public profile (Phase 7)            |
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
| `source_resume_id`          | `uuid references resumes(id) on delete set null`            | nullable — not every fact comes from a résumé                                                                                                                                      |
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

## `resumes`

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
`auth.uid() = user_id` check on the object path prefix.

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

| column               | type                                                        | notes                                                                                                                            |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid pk`                                                   |                                                                                                                                  |
| `user_id`            | `uuid not null references auth.users(id) on delete cascade` |                                                                                                                                  |
| `job_id`             | `uuid references jobs(id) on delete set null`               |                                                                                                                                  |
| `resume_id`          | `uuid references resumes(id) on delete set null`            |                                                                                                                                  |
| `company`            | `text not null`                                             | denormalized for fast filtering even if `job_id` is later nulled                                                                 |
| `title`              | `text not null`                                             |                                                                                                                                  |
| `status`             | `text not null default 'SAVED'`                             | `SAVED, IN_PROGRESS, APPLIED, APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW, ACTION_REQUIRED, OFFER, REJECTED, WITHDRAWN, UNKNOWN` |
| `notes`              | `text`                                                      |                                                                                                                                  |
| `applied_at`         | `timestamptz`                                               | set only by the explicit "mark as applied" action, alongside `status = 'APPLIED'`                                              |
| `location`           | `text`                                                      | denormalized from the job at save time (Phase 4C)                                                                                |
| `source_url`         | `text`                                                      | denormalized from the job's `source_url` at save time — survives `job_id` being nulled                                          |
| `canonical_url`      | `text`                                                      | `source_url` normalized (query string, fragment, trailing slash stripped — `packages/shared`'s `canonicalizeUrl`); tier-2 dedup key |
| `ats_provider`       | `text`                                                      | `GENERIC, GREENHOUSE, LEVER, WORKDAY` — denormalized from `jobs.platform_type`                                                   |
| `external_id`        | `text`                                                      | requisition/job ID, when reliably detected — tier-1 dedup key; no current extractor populates this yet                          |
| `autofill_summary`   | `jsonb`                                                     | counts only — `{approved, filled, skipped, failed, unresolved, manual}`, validated by `autofillSummarySchema`. No per-field content |
| `unresolved_fields`  | `jsonb`                                                     | sanitized array of `{label, classification, status, reason}` — never a value, never a DOM locator, validated by `unresolvedFieldSummarySchema` |

Indexes: `(user_id)`, `(user_id, status)`, `(user_id, company)`, `(user_id, applied_at desc)`,
unique partial `(user_id, canonical_url) where canonical_url is not null and external_id is
null`, unique partial `(user_id, ats_provider, external_id) where external_id is not null`.
RLS: standard.

### Extension-save duplicate prevention (`upsert_application_from_extension`, Phase 4C/4D)

The extension's save flow (`POST /api/applications`) never does a plain client-side
select-then-insert — it calls this `security invoker` Postgres function (pinned
`search_path`), which atomically finds-or-creates the tracked application using a strict
preference order, each tier scoped so it can never collapse two genuinely different
applications:

1. **`(user_id, ats_provider, external_id)`** — the strongest signal, when a requisition ID is
   available.
2. **`(user_id, canonical_url)`**, excluding rows already claimed by a distinct `external_id`
   — without that exclusion, two different requisitions sharing one generic apply-page URL
   (a canonical URL strips the query string entirely) would incorrectly merge.
3. **`(user_id, lower(company), lower(title))`**, only among rows with neither a canonical URL
   nor an external ID — deliberately *not* a database uniqueness constraint (a company/title
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

Approved/edited generated answers are linked to the saved application by updating the
*existing* `generated_answers` row (`user_decision`, `final_text`, `application_id` —
`recordOwnGeneratedAnswerDecision`, scoped by `user_id` *and* `job_id`) rather than inserting a
new row, so repeated saves never duplicate answer-usage records.

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

| column                    | type                                                        | notes                                                 |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `id`                      | `uuid pk`                                                   |                                                       |
| `user_id`                 | `uuid not null references auth.users(id) on delete cascade` |                                                       |
| `provider`                | `text not null default 'gmail'`                             |                                                       |
| `email_address`           | `text not null`                                             | the connected mailbox                                 |
| `encrypted_refresh_token` | `text not null`                                             | encrypted at rest, see `docs/SECURITY_AND_PRIVACY.md` |
| `scopes`                  | `text[] not null default '{}'`                              |                                                       |
| `status`                  | `text not null default 'ACTIVE'`                            | `ACTIVE, DISCONNECTED, ERROR`                         |
| `last_synced_at`          | `timestamptz`                                               |                                                       |

Unique: `(user_id, email_address)`. Indexes: `(user_id)`. RLS: standard.

## `email_signals`

Deliberately minimal — never full email bodies (see `docs/EMAIL_INTEGRATION.md`).

| column                   | type                                                               | notes                                                                                  |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `id`                     | `uuid pk`                                                          |                                                                                        |
| `user_id`                | `uuid not null references auth.users(id) on delete cascade`        |                                                                                        |
| `email_connection_id`    | `uuid not null references email_connections(id) on delete cascade` |                                                                                        |
| `provider_message_id`    | `text not null`                                                    | for dedup                                                                              |
| `sender`                 | `text`                                                             |                                                                                        |
| `sender_domain`          | `text`                                                             |                                                                                        |
| `subject`                | `text`                                                             |                                                                                        |
| `received_at`            | `timestamptz`                                                      |                                                                                        |
| `matched_application_id` | `uuid references applications(id) on delete set null`              |                                                                                        |
| `classification`         | `text`                                                             | `APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW, ACTION_REQUIRED, OFFER, REJECTED, OTHER` |
| `confidence`             | `numeric(3,2)`                                                     |                                                                                        |
| `evidence`               | `text`                                                             | short snippet/reason, not the full email                                               |
| `processed_at`           | `timestamptz not null default now()`                               |                                                                                        |

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
| `ai_request_limit`             | `int not null default 50`                                      | reserved for future plan-based limits, see `docs/IMPLEMENTATION_PLAN.md` Phase 7      |
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
