# Implementation Plan

This plan is deliberately sequential — each phase produces a working, testable slice, and no
phase depends on a later phase's output.

## Status (updated 2026-09-06)

- [x] Phase 1 — Repository setup, authentication, database, candidate profile, manual tracker
- [x] Phase 2 — Chrome extension shell, page extraction, generic form-field detection
- [x] Phase 3 — Job matching, candidate-fact retrieval, Claude-generated suggestions
- [x] Phase 4 — Approved-field autofill and application-saving workflow
  - [x] Phase 4A — Field review and approval state
  - [x] Phase 4B — Safe autofill engine
  - [x] Phase 4C — Application saving and tracker integration
  - [x] Phase 4D — End-to-end integration and safety verification
- [x] Phase 5A — Opportunity intelligence foundation: immutable job snapshots, requirement-evidence mapping
- [x] Phase 5 — Manual Gmail synchronization, email classification, status matching (migration +
      pgTAP verified against a real linked Supabase project; live-OAuth/test-Gmail-account pass still
      pending, see "Verification status" below)
- [x] Phase 5B.0 — Unify every APPLIED transition behind one canonical operation (prerequisite
      plumbing for 5B.1/5B.2, no schema change — see "Phase 5B.0" below)
- [x] Phase 5B.1 — Frozen submission packets + the atomic canonical APPLIED transition (migration
      0013, pgTAP-verified live against the linked Supabase project — see "Phase 5B.1" below)
- [x] Phase 5B.2 — Deterministic consistency firewall, wired into the canonical transition's gate,
      dashboard + extension review UI (see "Phase 5B.2" below)
- [x] Phase 5B.3 — Explicit, user-triggered AI-assisted unsupported-claim check, advisory-only
      (migration 0014, ephemeral, never part of the authoritative gate — see "Phase 5B.3" below)
- [x] Phase 5B.4 — Historical "what you submitted" viewer, including the requirement-mapping-run
      summary and component test coverage deferred out of 5B.2's first pass (see "Phase 5B.4"
      below)
- [x] Phase 5B hardening — closes a direct-PostgREST APPLIED bypass an adversarial review found,
      separates relocation's rule ids from work-authorization's, and adds a schema-level guard
      against an AI-assisted BLOCKING finding (migration 0015 — see "Phase 5B hardening" below)
- [x] Phase 5C.1 — Deterministic next-action engine: one primary recommended action per
      application, derived entirely from already-persisted state, no model call, no persistence
      (see "Phase 5C.1" below)
- [x] Phase 5C.2 — Dashboard intelligence: attention-sorted overview, follow-up suggestions,
      pipeline stages, recent activity, and a next-action column on the applications list (no
      schema change — see "Phase 5C.2" below)
- [x] Phase 5C hardening — corrects the follow-up heuristic to anchor on the more recent of
      appliedAt and the last confirmed employer-driven status change, not appliedAt alone (see
      "Phase 5C hardening — follow-up anchor" below)
- [ ] Phase 5C.3 — Follow-up drafting/interview-prep content (AI-assisted) — not started, out of
      scope for this pass by explicit instruction
- [ ] Phase 6 — Multi-user beta hardening, privacy controls, testing, deployment
- [ ] Phase 7 — Optional mypham.space integration, public onboarding, future sharing

The whole Phase 5B line (5B.0 through 5B.4, plus the hardening pass) is complete. Phase 5C.1/5C.2
are now complete too; only 5C.3 (AI-assisted follow-up/interview-prep content drafting) remains
unstarted within Phase 5C.

Phase 4A shipped: the popup classifies every detected field into a review state (sensitive /
unsupported / already-completed / pending-suggestion / ready / suggested / needs-input),
requests suggestions from POST /api/jobs/:id/suggestions one field at a time, and supports
approve/edit/skip + bulk "approve all ready." Decisions persist in chrome.storage.local keyed
per job, reconciled field-by-field against a live fingerprint on every reopen (never trusted
wholesale — see lib/field-fingerprint.ts) so a changed page, field, or current-value snapshot
can never silently reuse a stale decision; the fingerprint stores a hash of a field's current
value, never the raw text, and never anything at all for DEMOGRAPHIC/LEGAL/AUTHENTICATION
fields. See packages/shared/src/schemas/field-review.ts, apps/extension/src/popup/state/
review-reducer.ts, apps/extension/src/lib/{field-fingerprint,review-storage}.ts.

Phase 4B shipped: a centralized fill engine (apps/extension/src/content-script/fill/
fill-engine.ts) that re-resolves every approved field against the live page immediately before
writing, fails closed for missing/ambiguous (`requires_rescan`), drifted-content (`stale`),
hidden/disabled/readonly (`failed`), and sensitive/unrecognized (`unsupported`) targets, never
overwrites a value that changed since review, writes via native prototype setters + input/
change/blur events (React-compatible), and never touches a submit/button/file-upload control.
Reachable from the popup via a new "Autofill approved fields" button (useAutofill.ts), which
sends the approved ReviewableField[] to a newly-injected content-script entry
(content-script/autofill-entry.ts) through the existing typed messaging architecture — the fill
engine re-validates approval/classification independently regardless of what that message
claims.

Phase 4C shipped: POST /api/applications (create/update, atomic tiered dedup — requisition id >
canonical URL > company/title, via the upsert_application_from_extension Postgres function),
GET /api/applications?jobId=... ("already tracked?"), and PATCH /api/applications/:id/mark-applied
(the only path to APPLIED, a separate explicit popup action with its own confirm step — never a
side effect of saving or filling). `applications` gained source_url/canonical_url/ats_provider/
external_id/autofill_summary/unresolved_fields columns (supabase/migrations/
0008_applications_extension_fields.sql) — no new table, no parallel status model. Approved
answers are recorded by updating the _existing_ generated_answers row's user_decision/
final_text/application_id (packages/database's recordOwnGeneratedAnswerDecision) rather than
duplicating content. Only sanitized counts and {label, classification, status, reason} summaries
are persisted — never raw DOM data, full ReviewableField/DetectedField objects, or sensitive
field values. Fixed a Phase 4B compatibility gap along the way: autofill results now persist to
chrome.storage.local per job (lib/fill-result-storage.ts) so they survive popup closure, same
pattern as Phase 4A's review-storage.ts.

Phase 4D shipped: end-to-end verification of the full Phase 4 workflow plus targeted hardening,
all found and fixed by exercising the real system rather than by inspection alone —

- **Cross-tab/stale-response fix**: `chrome.runtime.sendMessage` is a broadcast with no
  built-in request/response correlation; a late `ANALYZE_JOB_RESULT`/`AUTOFILL_RESULT` from a
  previous tab, a closed-and-reopened popup, or a duplicate click could have silently
  overwritten the current job's state. Every request/result pair (`ANALYZE_JOB`,
  `AUTOFILL_APPROVED_FIELDS`) now carries a `requestId` the popup generates and checks on
  receipt, discarding anything stale. The accept/reject decision itself is extracted into a
  small pure helper (`apps/extension/src/lib/request-correlation.ts` — `startRequest`/
  `isCurrentRequest`) rather than left as inline ref comparisons, specifically so it can be
  unit-tested directly: 6 focused tests cover a normal matching response, an idle popup with
  nothing pending, a stale response arriving after a newer request superseded it, a response
  carrying an id that was never issued as the pending request at all (another tab/context), and
  many-simultaneous-requests (only the latest is ever accepted). `useAnalysis.ts` and
  `useAutofill.ts` both consume the shared helper instead of duplicating the comparison inline.
- **Missing `location` column**: `upsert_application_from_extension` referenced
  `applications.location` from Phase 4C onward, but migration 0008 never added it — caught only
  by calling the RPC against a real database (no mocked test could catch a column that neither
  side's mocks knew was missing). Because 0008 was already committed (and, by the time this was
  caught, already applied to a real database), the fix was **not** made by editing 0008 in
  place — `supabase db push` tracks applied migrations by filename, so a database that already
  ran 0008 would never pick up an in-place edit to it, silently diverging from a fresh
  database's schema. Instead, migration 0008 was restored to its exact original committed form
  and a new forward migration, `supabase/migrations/
0009_applications_extension_fields_fixes.sql`, carries the `location` column addition plus
  the other Phase 4D corrections below. A fresh database (0001→0009) and a database already at
  0008 (0009 alone) are verified to converge on the identical final schema.
- **Dedup-index/query mismatch**: the `canonical_url` unique index didn't exclude rows already
  claimed by a distinct `external_id`, so two different requisitions sharing one generic
  apply-page URL could collide at the database level even though the RPC's own SELECT logic
  already knew to treat them as separate — fixed in migration 0009 by dropping and recreating
  the index with the matching predicate, then confirmed race-free under genuine 8-way
  concurrency.
- **RPC hardening** (also migration 0009): pinned `search_path`, independently re-verified
  `job_id` ownership inside the function (it runs via service-role, bypassing RLS), bounded the
  `unique_violation` retry loop, normalized empty-string `external_id`/`canonical_url` to `null`.
- **`recordOwnGeneratedAnswerDecision` hardening**: now scoped by `job_id` in addition to
  `user_id`, so a same-user answer generated for a _different_ job can never be silently
  re-pointed onto the application being saved.
- **CI-crash fix, reassessed**: `applicationSchema` required the Phase 4C columns to always be
  present; any database without migrations 0008/0009 applied (e.g. a CI Supabase project, since
  migrations aren't run in CI) returns rows missing those keys entirely, not `null` — changed to
  `.nullable().default(null)` so those rows parse instead of throwing. Making the fields
  optional this way trades a loud crash for a quiet gap, so it is deliberately narrow: it only
  affects the _read_ path's 7 Phase 4C/4D columns, `rowToApplication` is a pure mapper (no
  writes, nothing gets corrupted by defaulting to null), and the _write_ path
  (`upsert_application_from_extension`) still fails loudly with a real Postgres error if those
  columns don't exist — a missing migration can never silently succeed at saving an
  application. What the schema relaxation alone would have left silent is a production
  environment quietly reading degraded (all-null) data with no signal anything is wrong; that
  gap is closed by `warnIfMigrationColumnsMissing` in `packages/database/src/queries/
applications.ts`, which logs a warn-once-per-process message the first time a row is missing
  these columns, naming migrations 0008/0009 explicitly. The schema was not broadened beyond
  the original 7 fields.

Verified against a real (confirmed-disposable) linked Supabase project, not mocks, starting
from a genuine already-at-0008 state and again from a fresh 0001–0009 apply — both converge on
the same schema: create/repeated-update/all three dedup tiers/status-non-regression/
empty-string-normalization/job-ownership-rejection all pass (12/12 scenario checks); 8-way true
concurrent saves for both the canonical-URL and requisition-ID tiers each produce exactly one
row with zero errors; the pgTAP RLS suite (`supabase/tests/database/0009_applications.test.sql`
— an independently, pre-existingly numbered pgTAP file, unrelated to migration 0009 above; no
naming collision, different directories) passes 5/5 against the post-migration schema.

**E2E status — honest, not rounded up.** The existing Playwright e2e suite
(`apps/web/e2e/signup-flow.spec.ts`) does **not** pass as a whole. Root-caused and reproduced
twice with identical results: run against an isolated dev server (the default `reuseExistingServer:
true` config was previously and silently reusing an unrelated dev server already on port 3000 —
worked around for diagnosis only, by running on an isolated port, not by editing repo config),
the suite exercises the full flow through the application status change successfully, then fails
at the final sign-out assertion. This is not asserted as a harmless flake by default assumption —
`--trace on` was captured and the resulting `error-context.md` accessibility-tree snapshot at the
moment of timeout was read directly. It shows two concrete facts: the page never navigated away
from `/applications` (the sign-out form's submit never actually went through), and the Next.js
Dev Tools overlay menu was open/expanded and sitting on top of the page in the accessibility tree
at that exact moment. That is proof, not inference, that the dev-mode-only overlay intercepted
the click — consistent with this test file's own pre-existing inline comment about the overlay,
and consistent with CI never seeing this failure mode (CI runs `npm run start`, a production
build, where this overlay does not render). So: **core application flow through status-change is
proven to work end-to-end; the full suite did not pass; the sign-out failure has a proven,
reproduced root cause rather than an assumed one.** It does not exercise the extension's own
save/autofill code paths directly (no extension-level browser-automation harness exists in this
repo yet); those paths are covered instead by the real-database RPC verification above plus the
unit/integration suite (271+ tests, see the Phase 4D report for the exact final count).

**Phase 5 shipped**: server-side Google OAuth (`packages/email`), AES-256-GCM refresh-token
encryption (`packages/database/src/crypto/token-encryption.ts`, resolving the encryption-key
question `docs/SECURITY_AND_PRIVACY.md` §12 had left open in favor of an application-level key
over Supabase Vault), manual-only Gmail sync capped at 25 messages per click (no background jobs;
later extended by a throttled, attended auto-sync-on-page-load — see the note below),
a deterministic keyword classifier tried first (`packages/email/src/deterministic-classifier.ts`)
with a Claude fallback for ambiguous messages only (`packages/ai/src/generate-email-classification.ts`,
reusing the Phase 3/5A pipeline's rate-limiting, untrusted-content tagging, and rejection-gate
conventions), and a weighted company/sender-domain/title matcher (`packages/email/src/matcher.ts`)
against the user's tracked applications. High-confidence matches (`combinedConfidence >= 0.85`,
never ambiguous) write directly to `application_events` with `source = 'GMAIL_SYNC'` and are
undoable through the existing `revertApplicationEvent`/`RevertEventButton` mechanism with zero new
UI code; below-threshold matches sit in a new `/settings` confirmation queue
(`PATCH`-free — `POST /api/email-signals/:id/confirm`) until the user explicitly confirms or
declines. New `email_connections`/`email_signals` tables (migration `0012`) ship with the standard
four-policy RLS pattern (no service-role RPC boundary needed here, unlike Phase 5A — every write
goes through a normal RLS-scoped web-session client since the extension is never involved), a
composite `(user_id, id)` FK from `email_signals` to `email_connections`, and a `confirmation_status`
column added beyond `docs/DATA_MODEL.md`'s original spec (documented there now) so a declined
low-confidence match never resurfaces identically on a later sync. Connecting Gmail is itself the
per-user opt-in (`user_settings.gmail_integration_enabled` flips true in the OAuth callback, false
on disconnect) — the connect/callback routes gate only on the global `gmail_integration_enabled`
feature flag, since gating them on the per-user flag too would make it impossible to ever opt in.

**Verification status — honest, not rounded up.** Every touched package typechecks clean and the
full unit suite passes (395 tests across all workspaces, 19 new: 13 deterministic-classifier
fixture cases, 6 matcher scenarios covering clean/zero/ambiguous/domain-learned matches, plus 7
`classifyEmail` pipeline tests and 6 token-encryption round-trip/tamper-detection tests already
counted in `packages/ai`/`packages/database`'s totals), and `next lint` passes with zero warnings.

Migration `0012` was pushed to and its pgTAP suite verified against the same real, previously-
paused (restored for this session), linked Supabase project used in Phase 4D/5A's verification —
`supabase db push --linked` applied cleanly, and 13/13 assertions in `supabase/tests/database/
0018_email_connections_and_signals.test.sql` passed (`1..13`, all `ok`): cross-user RLS isolation
on both new tables, both unique constraints (`(user_id, email_address)` and `(email_connection_id,
provider_message_id)`), the composite `(user_id, email_connection_id)` FK rejecting a cross-owner
connection reference, `application_events.email_signal_id` correctly nulling on the referenced
signal's deletion, and `ai_usage_events` accepting `'email_classification'` as a `task_type`. This
sandbox has neither Docker nor Podman, so `supabase test db`'s normal runner couldn't execute
directly; the suite was instead run via `supabase db query --linked --file`, which only surfaces a
final statement's result set, so every `is`/`throws_ok` call was captured into a session-local
temp table and selected back as one result — the test file itself was not modified, only how its
output was observed. The verification ran inside a `begin ... rollback` transaction (the test
file's own structure), so no test data persists in the real database.

**Live OAuth verified** against a real Google Cloud OAuth client and the product owner's own
Gmail account (added as a consent-screen test user): Connect → Google consent → callback →
`email_connections` row created with the encrypted refresh token and correct `gmail.readonly`
scope, confirmed directly in the database. Sync was also exercised live against a real inbox (25
messages processed); one bug was caught only by this live pass, not by unit tests — a stray
trailing backslash accidentally included in the local `ANTHROPIC_API_KEY` value corrupted the key
and made every Claude fallback classification call fail with `provider_error` (visible in
`ai_usage_events`), which a mocked-Claude-client unit test could never have caught since it never
exercises a real API key. Confirm/Decline and Disconnect were not yet exercised live as of this
writing.

**Auto-sync-on-page-load (deviation from the original Phase 5 design)**: the Phase 5 spec above
(`## Phase 5 — Manual Gmail synchronization...`) specified sync as manual-only — a button click,
nothing else. The implementation now adds a second trigger: `apps/web/app/(app)/settings/
gmail-section.tsx`'s `SyncGmailButton` also fires a sync automatically when `/settings` loads or
reloads, if the connection's last sync was more than `AUTO_SYNC_THROTTLE_MS` (5 minutes) ago,
guarded against firing twice under React 18 Strict Mode's dev-only double-invoke of effects via a
`hasAutoSyncedRef` ref set before the throttle check runs.

This changes v1's interaction model; it is not a background-sync feature. The prohibition this
repo actually cares about — no cron job, no webhook, no push notification, no IMAP idle
connection, no polling while the user is away from the app — is unchanged and still holds: both
the manual click and the auto-check only ever run inside a real request made while the signed-in
user has the `/settings` tab open in that moment, and neither runs if the user isn't there. The
distinction that matters is **attended vs. unattended**, not **click vs. no-click**.
`docs/EMAIL_INTEGRATION.md` §1 and `docs/USER_FLOWS.md` §9 have been updated to state this
distinction directly rather than the narrower "click-triggered, never automatic" language they
used before.

There is no record in this repo of this specific change being raised with the product owner as a
discussion before implementation — this note does not claim that happened. If it wasn't raised,
it still should be, per this file's own "raise it explicitly rather than quietly working around
it" rule: continuous/background Gmail access patterns are scrutinized more heavily in Google's
OAuth verification process than click-triggered access, and while a throttled, attended,
per-page-load check is not the same as unattended polling, it is a materially different access
pattern than what Phase 5 originally scoped and was verified against. If this product ever gains
a second real user, this decision should be revisited — the throttle is a reasonable default for
one person's own inbox, not a validated design for arbitrary Gmail-API/Claude cost exposure
across many accounts.

Update this checklist when a phase's definition of done is met and the next one starts —
this is the single source of truth for "what phase are we on," so it needs to stay current,
not be reconstructed from git log each time.

---

## Phase 1 — Repository setup, authentication, database, candidate profile, manual tracker

### Goals

Stand up the monorepo tooling, get a real user able to sign up, log in, build a candidate
profile by hand (no AI extraction yet), and manually track applications — with full
multi-tenant RLS from the first migration.

### User stories

- As a new user, I can create an account and log in.
- As a user, I can fill out my profile (contact info, education, experience, skills, links,
  work authorization, preferences) by hand.
- As a user, I can manually create, edit, and delete application records with a status.
- As a user, my data is invisible to every other account, including via direct API calls.

### Required files (representative, not exhaustive)

- Root: `package.json` (npm workspaces), `tsconfig.base.json`, `.eslintrc`, `.prettierrc`,
  `.env.example`, `.gitignore`
- `apps/web`: Next.js app scaffold, `app/(public)/page.tsx`, `app/(app)/dashboard/page.tsx`,
  `app/(app)/profile/page.tsx`, `app/(app)/applications/page.tsx`, auth middleware
- `packages/database`: Supabase client factory, typed query helpers for `profiles`,
  `candidate_facts`, `experiences`, `education`, `projects`, `skills`, `applications`
- `packages/shared`: base Zod schemas for the above
- `packages/ui`: base component set (button, input, card, table, kanban primitives)
- `supabase/migrations`: initial schema for `profiles`, `candidate_facts`, `experiences`,
  `education`, `projects`, `skills`, `resumes` (table only, no extraction yet), `jobs`
  (minimal), `applications`, `application_events`, `user_settings`, `feature_flags`, all with
  RLS

### Database changes

First migration: every table in `docs/DATA_MODEL.md` except `generated_answers`,
`extension_sessions`, `email_connections`, `email_signals` (added in later phases as their
features land), with full RLS policies from day one.

### API endpoints

- `POST /api/profile`, `PATCH /api/profile`
- `GET/POST/PATCH/DELETE /api/candidate-facts`
- `GET/POST/PATCH/DELETE /api/experiences`, `/api/education`, `/api/projects`, `/api/skills`
- `GET/POST/PATCH/DELETE /api/applications`
- `POST /api/account/delete`

### Security risks

- RLS policy gaps on any new table — mitigated by a checklist requiring an RLS test per table
  before merge (see Tests below).
- Auth middleware not covering a route correctly, leaking an authenticated page to anonymous
  users — mitigated by explicit route-group tests.

### Tests

- Vitest: RLS policy tests (user A cannot read/write user B's rows) for every table added.
- Vitest: Zod schema round-trip tests for every shared type.
- Playwright: signup → login → edit profile → create application → logout.

### Definition of done

- A real account can complete the full manual workflow (profile + application tracker) with
  no AI or extension involvement.
- Two test accounts, verified via automated test, cannot see each other's data through the UI
  or a direct API call.
- CI runs lint, typecheck, unit tests, and the Playwright smoke flow on every PR.

### Explicitly excluded from Phase 1

- Résumé upload/parsing, AI fact extraction, the extension, Claude tailoring, Gmail — all
  later phases.

---

## Phase 2 — Chrome extension shell, page extraction, generic form-field detection

### Goals

Ship an extension that can authenticate, analyze a job page with `GenericHtmlAdapter`, detect
and classify form fields, and display results in the popup — with no AI suggestions or
autofill yet.

### User stories

- As a user, I can install the extension and connect it to my Career OS account.
- As a user, I can click "Analyze Job" on a job posting and see the detected company, title,
  and classified form fields in the popup.

### Required files

- `apps/extension`: Vite + React scaffold, `manifest.json` (per `docs/EXTENSION_DESIGN.md`
  §1), `background.ts` (service worker), `content-script.ts`, `popup/` UI
- `packages/shared`: `JobExtractionPayload`, `DetectedField` schemas, field classification
  enum
- Extension-side adapter: `GenericHtmlAdapter` only (`GreenhouseAdapter` etc. deferred)

### Database changes

Add `extension_sessions` table + RLS. `jobs` table gains the full extraction columns from
`docs/DATA_MODEL.md` (company, description, responsibilities, etc. — Phase 1 only needed a
minimal shape for manually-created applications).

### API endpoints

- `POST /api/auth/extension-token` (exchange web session → extension-scoped token)
- `DELETE /api/auth/extension-token/:id` (revoke)
- `POST /api/jobs/analyze` (accepts extraction payload, creates/updates `jobs` row, returns
  stored job id — no AI ranking yet, that's Phase 3)

### Security risks

- Extension permission scope creep — mitigated by sticking to the `activeTab` + `scripting` +
  `storage` set defined in `docs/EXTENSION_DESIGN.md`; any addition requires a documented
  justification.
- Extension token leakage — mitigated by hashed storage, short expiry, per-session
  revocability.

### Tests

- Unit tests for `GenericHtmlAdapter` against a fixture set of saved job-page HTML snapshots.
- Unit tests for field classification heuristics against a fixture set of labeled form
  fields.
- Manual QA pass across a handful of real job boards (documented, not automated, given DOM
  fixtures drift).

### Definition of done

- Extension authenticates against a real account and analysis produces a correctly-classified
  field list, verified against fixtures, on at least generic/non-ATS job pages.

### Explicitly excluded from Phase 2

- Platform-specific adapters (Greenhouse/Lever/Workday) — added opportunistically after
  generic extraction is solid.
- Any AI-generated suggestion content.
- Any autofill (write) behavior — extraction is read-only this phase.

---

## Phase 3 — Job matching, candidate-fact retrieval, Claude-generated suggestions

### Goals

Implement the deterministic retrieval + ranking pipeline and the Claude tailoring call, fully
gated by the grounding rules in `docs/AI_GROUNDING.md`.

### User stories

- As a user, after analyzing a job, I see a ranked summary of which of my approved
  experiences are most relevant.
- As a user, I see proposed answers for detected fields, each showing which approved facts it
  relied on, and I never see a fabricated claim.

### Required files

- `packages/ai`: retrieval/ranking module, prompt construction, Zod response validation,
  rejection-gate logic
- `packages/shared`: `GeneratedAnswer` schema (`docs/AI_GROUNDING.md` §3)
- `apps/web` API routes calling into `packages/ai`

### Database changes

Add `generated_answers` table + RLS.

Also added: `ai_usage_events` table + RLS, and `generated_answers`'s `insufficient_data`/
`rejection_reason`/`available_fact_ids`/`generation_run_id`/`attempt_number` audit columns.
These are schema-level groundwork for a future multi-provider AI routing/escalation system (a
`deterministic -> normal -> premium` ladder across providers) — **not implemented in Phase 3**.
The actual Phase 3 implementation (`generate-suggestion.ts`) is single-provider (Claude Sonnet
only, one retry) and never writes to `ai_usage_events`
(`packages/database`'s `recordAiUsageEvent` has no call site yet). The table exists now so a
future routing implementation has telemetry storage from day one rather than needing its own
schema change. See `packages/shared/src/schemas/ai-usage-event.ts` for the full modeled shape.

### API endpoints

- `POST /api/jobs/:id/suggestions` — runs retrieval + Claude, returns validated
  `GeneratedAnswer[]`, persists as `generated_answers` rows with `requiresUserReview = true`

### Security risks

- Prompt injection via job-description text (e.g. a job posting containing text designed to
  manipulate the model into ignoring grounding instructions) — mitigated by treating the job
  description as untrusted data within a structured prompt, not concatenated as instructions,
  and by the independent Zod + unsupportedClaims gate regardless of what the model was told.
- Over-broad data sent to Claude — mitigated by the top-N ranked selection in retrieval
  (`docs/AI_GROUNDING.md` §2, §6).

### Tests

- Unit tests for ranking determinism (same inputs → same ranked order).
- Unit tests asserting the rejection gate actually rejects: fixtures with non-empty
  `unsupportedClaims` and malformed responses must never reach a "usable" state.
- Integration test: a fact set with no relevant match produces an "insufficient information"
  result, not a fabricated one.

### Definition of done

- For a realistic job description and a realistic approved-fact set, generated suggestions
  are traceable to real `sourceFactIds` and pass the rejection gate; a deliberately
  fact-sparse profile produces honest "cannot answer" results instead of invented content.

### Explicitly excluded from Phase 3

- Autofill (writing suggestions into the page) — Phase 4.
- Any Gmail-related classification (separate Claude usage path, Phase 5).
- Multi-provider AI routing/escalation (choosing between providers/models across a
  deterministic/normal/premium ladder, retrying via a second provider, cost-based routing) —
  `ai_usage_events`' schema anticipates this (see "Database changes" above) but no phase in
  this plan has scoped the actual routing logic yet. Needs its own planning pass before
  implementation starts, rather than being built ad hoc against the existing schema.

---

## Phase 4 — Approved-field autofill and application-saving workflow

### Goals

Close the loop: user can approve/edit/skip suggestions in the popup, autofill only approved
fields, and save the resulting application to the dashboard.

### User stories

- As a user, I can approve, edit, or skip each suggested field in the popup.
- As a user, clicking "Autofill Approved Fields" fills only what I approved, nothing else.
- As a user, clicking "Save Application" creates/updates the application on my dashboard,
  visible immediately in `/applications`.

### Required files

- `apps/extension`: popup approve/edit/skip UI, content-script autofill writer
- `apps/web`: application detail page showing generated-answer history

### Database changes

None beyond Phase 1/3 tables — this phase is about wiring existing tables (`applications`,
`generated_answers`, `application_events`) together end to end.

### API endpoints

- `POST /api/applications` (create/update from extension save)
- `PATCH /api/generated-answers/:id` (record `userDecision`: approved/edited/skipped)

### Security risks

- Autofill writing to an unintended field due to a classification mismatch — mitigated by
  requiring the content script to re-validate the target field's identity (label/name/id)
  immediately before writing, not just trusting the earlier analysis snapshot.
- Accidental fill of `DEMOGRAPHIC`/`LEGAL`/`AUTHENTICATION` fields — structurally prevented
  per `docs/EXTENSION_DESIGN.md` §6 (no suggestion is ever generated for these, so there is
  nothing to approve).

### Tests

- Playwright/extension test harness: approve a subset of fields, autofill, assert only
  approved fields changed in a fixture page's DOM.
- Unit test: skip-all path results in zero DOM writes.

### Definition of done

- End-to-end flow works on at least the `GenericHtmlAdapter` fixture set: analyze → suggest →
  approve subset → autofill → save → visible on dashboard with correct generated-answer
  history and event timeline entry.

### Explicitly excluded from Phase 4

- Any form of automatic submission.
- Platform-specific adapters beyond whatever Phase 2 already added opportunistically.

---

## Phase 5 — Manual Gmail synchronization, email classification, status matching

### Goals

Implement the full flow in `docs/EMAIL_INTEGRATION.md`: connect, manual sync, deterministic +
Claude-fallback classification, application matching, confirmation UX for low-confidence
matches.

### User stories

- As a user, I can connect Gmail and click "Sync Gmail" to check for status updates.
- As a user, high-confidence matches update my application timeline automatically (and are
  undoable); low-confidence matches ask me to confirm first.
- As a user, I can disconnect Gmail and delete all stored signals at any time.

### Required files

- `packages/email`: OAuth flow, Gmail search, deterministic classifier, Claude fallback,
  matcher
- `apps/web`: `/settings` Gmail connect/disconnect UI, sync trigger, confirmation UI for
  low-confidence matches

### Database changes

Add `email_connections`, `email_signals` tables + RLS (per `docs/DATA_MODEL.md`).

### API endpoints

- `POST /api/gmail/connect` (OAuth init), `GET /api/gmail/callback`
- `POST /api/gmail/sync` (manual trigger)
- `POST /api/gmail/disconnect`
- `POST /api/email-signals/:id/confirm` (user confirms a low-confidence match)

### Security risks

- See `docs/EMAIL_INTEGRATION.md` §6 (OAuth verification) and §5 (token encryption) in full.
- Over-retention of email content — mitigated by the "never store full body" rule (§3 of that
  doc), enforced by only persisting the fixed `email_signals` column set.

### Tests

- Unit tests for the deterministic classifier against a labeled fixture set of email
  subject/sender/snippet combinations.
- Unit test: dedup constraint actually prevents reprocessing the same `provider_message_id`.
- Unit test: confidence-threshold branching (≥0.85 auto-proposed vs. below requires
  confirmation).

### Definition of done

- Connecting a real (test) Gmail account, syncing, and correctly classifying/matching at
  least the common ATS email patterns (application received, interview invite, rejection)
  end to end, with disconnect fully revoking and deleting signals.

### Explicitly excluded from Phase 5

- Continuous/background mailbox monitoring.
- Any Gmail write access (labeling, sending, modifying).
- Public rollout of Gmail integration (stays behind the feature flag and test-user list).

---

## Phase 6 — Multi-user beta hardening, privacy controls, testing, deployment

### Goals

Get the product safely usable by a small group of real test users beyond the product owner:
harden RLS/security-review findings, finish deletion/privacy UX, get CI/deployment solid.

### User stories

- As a test user, I have full confidence my data is isolated from every other account.
- As the product owner, I can add/remove test users without a code change (feature-flag/
  allowlist driven).
- As a user, I can see and exercise every deletion flow from the UI, not just the API.

### Required files

- Admin-only tooling for managing the test-user allowlist and feature flags (internal, not
  public UI).
- `/settings` privacy section surfacing all deletion flows explicitly.

### Database changes

None structurally new; this phase is about policy review and possibly tightening/adding
missing RLS policies found during review, plus indexes found necessary under real usage.

### API endpoints

None new in principle; existing endpoints get hardened (rate limiting, input validation
completeness).

### Security risks

- This phase's entire purpose is finding these before real strangers use the product — a
  dedicated security review pass (self-review at minimum; `/code-review` or `ultrareview`
  tooling if available) against `docs/SECURITY_AND_PRIVACY.md`'s checklist is the deliverable.

### Tests

- Full RLS test matrix across every table with at least two test accounts.
- Playwright coverage of every deletion flow.
- Load/rate-limit test for AI request limits under concurrent use.

### Definition of done

- A written security review pass completed against every item in
  `docs/SECURITY_AND_PRIVACY.md` §12, with each item resolved or consciously deferred with
  reasoning.
- Staging deployment matches the target architecture in `docs/DEPLOYMENT.md`.
- A small set of real test users (beyond the product owner) can use the full workflow.

### Explicitly excluded from Phase 6

- Public signups (`public_signups_enabled` stays off).
- Billing.

---

## Phase 7 — Optional mypham.space integration, public onboarding, future sharing

### Goals

Build the explicitly optional, loosely-coupled integration with the personal site, and
prepare (without necessarily flipping) the path to public signups.

### User stories

- As the product owner, I can generate a sanitized public JSON profile export.
- As a visitor to mypham.space, I might (if this ships) see linked Career OS project data
  sourced from that export.
- As a prospective public user, if `public_signups_enabled` is turned on, I can join through
  a real onboarding flow, not a stub.

### Required files

- `apps/web`: `GET /api/public-profile/:userId` returning only `visible_on_public_profile =
true` facts, per `docs/ARCHITECTURE.md` §6.
- Documentation of the export/import JSON format (versioned).

### Database changes

None required beyond what already exists (`visible_on_public_profile` columns are already in
place from Phase 1). Possibly a `public_slug`-based lookup index on `profiles`.

### API endpoints

- `GET /api/public-profile/:slug` (public, read-only, filtered at the query level)

### Security risks

- Public export accidentally including unapproved or private facts — mitigated by filtering
  `visible_on_public_profile = true` in the database query itself, not in a post-processing
  step that could be bypassed by a code path change.
- Public signups reintroducing all Phase 6 isolation concerns at greater scale — mitigated by
  treating the feature-flag flip as a deliberate go/no-go decision gated on Phase 6 sign-off,
  not an automatic consequence of this phase shipping code.

### Tests

- Unit test: a fact with `visible_on_public_profile = false` never appears in the public
  export response, including for facts added after the endpoint was written (regression
  guard).

### Definition of done

- Public export endpoint ships and is verified to leak nothing private, per the test above.
- A documented (not necessarily executed) decision on whether/when to flip
  `public_signups_enabled`.

### Explicitly excluded from Phase 7

- Billing implementation. This phase documents how plan limits could attach to the existing
  `user_settings.ai_request_limit` field and a future `plan` column, but does not build
  billing, payment processing, or plan enforcement beyond the existing per-user AI rate
  limit.
- Live/scraped integration with mypham.space — only the versioned JSON export/import format.

---

## Cross-phase notes

- **Feature flags** (`public_signups_enabled`, `gmail_integration_enabled`) exist from Phase
  1's migration onward, even though nothing reads them meaningfully until Phase 5/7 — this
  avoids a schema change later just to introduce the gating mechanism.
- **Billing** is intentionally never implemented in this plan. `user_settings.ai_request_limit`
  is the seam a future plan/billing system would hang off of (per-user limit already exists;
  a `plan` enum and Stripe integration would be additive, not a restructure).

---

## Phase 5A — Opportunity Intelligence Foundation (shipped)

Went through four rounds of design review before implementation (immutability, RPC-overload
safety, generation-run lifecycle, fact-provenance versioning, fingerprint correctness, field
nullability, AI grounding controls; then a security/lifecycle addendum covering RPC
authorization, internal-helper grants, direct-write RLS exposure, structural ownership, the
APPLIED-freeze rule, run-lifecycle constraints, `matched_facts` validation, and truncation
visibility) before any code was written — see the git history on this branch for the full
review trail. First of three independently shippable subphases (5A here; 5B: consistency
firewall + frozen submission packet; 5C: next actions + dashboard integration — both
unscoped, not started).

**Mandatory prerequisite, fixed first**: `upsert_application_from_extension` (Phase 4) was
grantable to `authenticated` and trusted a `p_user_id` parameter rather than deriving the
caller's identity from `auth.uid()` — a confused-deputy privilege-escalation path (an
authenticated user could call it directly via `supabase.rpc(...)` on behalf of any other user
whose job id they could learn). Repository-wide audit confirmed the only real caller was
`apps/web/app/api/applications/route.ts` via `createAdminClient()` (service-role) after
deriving `userId` from a verified bearer token — no legitimate `authenticated`-role caller
existed. Fixed in migration `0010` by revoking `public`/`anon`/`authenticated` and granting
`service_role` only; the function's signature and body are otherwise byte-for-byte unchanged.
The same server-only grant pattern is applied to every new Phase 5A function.

**Shipped**: immutable, versioned job-posting snapshots (`job_snapshots` — see
`docs/DATA_MODEL.md`), captured automatically and atomically alongside every application save
via the new `upsert_application_with_snapshot` RPC (a separately-named wrapper, not an
extension of `upsert_application_from_extension`'s signature — `CREATE OR REPLACE FUNCTION`
cannot change an existing function's argument list without creating an ambiguous PostgREST
overload); a frozen snapshot pointer once an application reaches `APPLIED` or later; a
deterministic, versioned content fingerprint (`"v1:" + sha256hex`, case-preserving, covering
every stored content field so a fingerprint reuse can never carry stale data); user-triggered
requirement-evidence mapping (`requirement_mapping_runs` + `requirement_evidence_mappings`),
grounded exclusively in the user's own approved facts, with server-derived (never
model-generated) provenance that detects an edited/unapproved/deleted supporting fact on read;
and a "Requirements & evidence" panel on the application detail page with real loading/empty/
success/stale-evidence/failure/regenerate states.

**Database-enforced, not just application-level**: composite foreign keys tie every
application → snapshot → run → mapping link to `(user_id, id)`, so a cross-user link is
rejected by the database itself; a `before update` trigger makes `job_snapshots` and
`requirement_evidence_mappings` genuinely immutable against every role including
`service_role`, not just against normal clients via RLS; a partial unique index guarantees at
most one `CURRENT` run per snapshot; CHECK constraints rule out every nonsensical
status/timestamp combination on a run and enforce the `MISSING`/`INFERRED` relationship
invariants on a mapping. `job_snapshots`/`requirement_mapping_runs`/
`requirement_evidence_mappings` deliberately ship with `select`-only RLS for `authenticated` —
no insert policy, since a direct PostgREST insert would bypass sanitization/fingerprinting/
contract validation entirely; every write goes through a `service_role`-only function instead.

**AI grounding** (`packages/ai/src/generate-requirement-mapping.ts`, `docs/AI_GROUNDING.md`
§8): reuses the Phase 3 pipeline's controls rather than inventing new ones — untrusted-data
tagging, no `tools`, rate limiting before any provider call, the same allowlist-check pattern
for cited fact ids, one retry on rejection (never on a hard provider error). New: the
`ai_usage_events` table (Phase 3 schema groundwork with no live caller before now) gets its
first real caller; validation is all-or-nothing across the whole array response, so there is
no partial promotion of a run where only some requirements passed; no aggregate "ATS score" or
hiring/interview probability is ever computed.

**Verified against the same real, disposable, linked Supabase project used throughout Phase
4D** — not mocks: 29/29 pgTAP assertions (`supabase/tests/database/
0017_job_snapshots_and_requirement_evidence.test.sql` — RLS isolation, grant denial for
`authenticated`/`anon` against every new function and the Phase 4 fix, composite-FK cross-user
rejection, immutability-trigger firing regardless of role, CHECK/unique-constraint rejection)
and 25/25 live scenario checks covering the RPC orchestration directly (snapshot create/reuse/
version, 8-way concurrent identical-content saves producing exactly one row, the APPLIED-freeze
behavior end-to-end, atomic promotion including rejection of a foreign user's fact and of a
structurally malformed `matched_facts` entry, run supersession, and `mark_requirement_mapping_run_failed`'s idempotency) — one real bug (a
`GET DIAGNOSTICS` boolean/integer type mismatch in `mark_requirement_mapping_run_failed`) was
caught and fixed by this live verification, not by inspection.

### Explicitly excluded from Phase 5A

- Snapshot-history _browsing UI_ — the database supports multiple immutable versions per job
  and retains superseded runs, but there is no UI to browse anything but the current one.
- Salary, work-mode, remote-location-restriction, and work-authorization-language
  _extraction_ — the columns exist, nullable, unpopulated; no current extractor produces them.
- The consistency firewall and frozen submission packet (Phase 5B).
- Next actions/deadlines and the dashboard overview section (Phase 5C).
- Any change to the extension's autofill/save/mark-applied flow verified in Phase 4D — the
  extension itself was not touched.

---

## Phase 5B.0 — Unify every APPLIED transition behind one canonical operation

Prerequisite plumbing for Phase 5B, done as its own slice before any consistency-firewall or
submission-packet work starts. **This slice adds no table, no migration, and no new concept —
it only consolidates existing status-transition code.** `submission_packets`, consistency
findings, acknowledgements, a consistency-check endpoint, the deterministic rule engine, any
AI-assisted unsupported-claim checking, a "what you submitted" viewer, and résumé-version
selection are all still entirely unimplemented; none of that starts until 5B.1.

### Why the two known APPLIED paths had to be unified

Before this slice, two independent code paths could set `applications.status = 'APPLIED'`, with
observably different behavior:

1. The extension's `PATCH /api/applications/:id/mark-applied` → `markOwnApplicationApplied` —
   set `applied_at` (unconditionally, to `now()`, even on a repeat call) and recorded a
   `STATUS_CHANGE` event.
2. The dashboard's generic status `<select>` → `changeApplicationStatus` server action →
   `changeOwnApplicationStatus` — accepted `APPLIED` like any other status and never touched
   `applied_at` at all.

A future consistency-firewall gate (5B.2) and frozen submission packet (5B.1) both need to run
at the exact moment status becomes `APPLIED` — with two divergent entry points, wiring the gate
into only one would make it trivially bypassable through the other. This had to be fixed first,
not as a side effect of 5B.1.

**A repository-wide search for every APPLIED-capable call site turned up two more, beyond the
two already known:**

3. **`createOwnApplication`** (the dashboard's "Add application" form, `apps/web/app/(app)/
applications/page.tsx`) originally let a user pick any status — including `APPLIED` —
   directly at creation time. This was a real, separate bug, not just an architectural gap: the
   form had no `appliedAt` field, so a row created this way ended up with `status = 'APPLIED'`
   and `applied_at = null` forever, directly violating `docs/DATA_MODEL.md`'s own documented
   invariant. A first pass fixed only the `applied_at` symptom (defaulting it to `now()`) —
   **superseded by a follow-up fix in this same slice**: that still left a structural bypass
   around the canonical operation, which matters concretely for 5B.1, where atomic
   submission-packet creation attaches to `markOwnApplicationApplied` — an application that
   reached `APPLIED` via `createOwnApplication` would never pass through that seam and would
   have no packet. **Direct `APPLIED` creation is now removed entirely, not patched further**:
   `ApplicationInput.status` is typed as `CreatableApplicationStatus`
   (`packages/shared/src/schemas/application.ts`), a Zod enum that structurally excludes
   `APPLIED` — `applicationInputSchema.parse(...)` rejects it, and no TS caller can construct an
   `ApplicationInput` with `status: 'APPLIED'` at all, the same way
   `saveApplicationRequestSchema` already made `APPLIED` unrepresentable for the extension's save
   flow. `createOwnApplication` additionally rejects it at runtime (`(input.status as string) ===
'APPLIED'` → throw) as defense-in-depth beneath that type boundary, for any caller that reaches
   the function via an unsafe cast or untyped JS rather than a real `ApplicationInput` — the
   invariant does not depend on every caller staying correctly typed, let alone on the UI. The
   "Add application" form's status `<select>` no longer offers `APPLIED` as an option, but that's
   a consequence of the type change, not the enforcement mechanism itself. `applied_at` is now
   unconditionally
   `null` at creation (there is no longer any status pairing that would make it non-null), and the
   now-vestigial `appliedAt` input field was removed from `applicationInputSchema` along with it
   — a historical-import workflow (backdating `appliedAt` for an application already submitted
   before the user started tracking it here) is a real, plausible future feature, but is
   deliberately not built in this slice.
4. **`revertApplicationEvent`** (`packages/database/src/queries/application-events.ts`, the
   "undo for automated updates" mechanism, `docs/USER_FLOWS.md` §6) can restore
   `status = 'APPLIED'` when undoing an event whose `fromStatus` was `APPLIED` — e.g. undoing a
   Gmail-driven or manual move away from `APPLIED`. **Deliberately left unmodified — this does
   not constitute an independent user-facing mark-as-applied path.** It cannot _originate_ an
   `APPLIED` transition: it only restores a status that already, verifiably, existed on this same
   application's own timeline (`event.fromStatus`, read from a `STATUS_CHANGE` row that itself
   only exists because `APPLIED` was reached once already, through a real canonical-operation
   call). There is no way to fabricate an `APPLIED`-`fromStatus` event out of nothing, and nothing
   about it looks like a user clicking "I just applied" — it is exclusively "undo," gated on an
   event that was genuinely recorded. Consistent with that, it already never touches `applied_at`,
   which is precisely correct: an untouched `applied_at` is a _preserved_ `applied_at`, satisfying
   the "later transition back to APPLIED: preserve the original `applied_at`" rule below by
   construction. Routing it through the canonical mark-applied operation would be semantically
   wrong (it would either fabricate a fresh "explicit user action" event where the real action was
   "undo", or need special-casing to suppress that) for a case its current behavior already gets
   right.

`Gmail sync` (`packages/email/src/sync.ts`) and the user-confirmed Gmail path
(`confirmOwnEmailSignal`) were checked and are **structurally incapable** of ever producing
`APPLIED`: both derive their target status exclusively from `EMAIL_CLASSIFICATION_TO_STATUS`
(`packages/shared/src/schemas/email-signal.ts`), whose value type never includes `APPLIED` — this
is a compile-time guarantee, not just an observed absence. `POST /api/applications` (the
extension's save endpoint) was already correctly guarded at the schema level
(`saveApplicationRequestSchema` restricts `status` to `SAVED`/`IN_PROGRESS`; a test already
asserts `APPLIED` is rejected with 400) and needed no change.

### The canonical integration point

`markOwnApplicationApplied` (`packages/database/src/queries/applications.ts`) is now the _one_
function responsible for the entire APPLIED transition: verifying ownership, setting
`status = 'APPLIED'`, applying the `applied_at` rule below, recording the `STATUS_CHANGE` event
(only when the status actually changes), and returning the updated application. Both known entry
points call it exclusively:

- The extension route (`PATCH /api/applications/:id/mark-applied`) — unchanged, already called it.
- The dashboard's `changeApplicationStatus` server action (`apps/web/app/(app)/applications/
actions.ts`) — now branches: `status === 'APPLIED'` calls `markOwnApplicationApplied`; every
  other status still goes through `changeOwnApplicationStatus` unchanged.

`changeOwnApplicationStatus` itself now throws immediately (before touching the database) if
ever called with `toStatus === 'APPLIED'` — a defensive guard, not just documentation, so a
future call site cannot silently reintroduce a second implementation. This was a plain-TS-function
change, not a new Postgres RPC: unlike Phase 5A's snapshot/evidence tables, this operation
touches no new table, requires no cross-table atomic promotion, and needs no immutability
enforcement (that begins in 5B.1) — the smallest change that satisfies "one canonical operation"
is consolidating the existing function, matching this codebase's existing idiom for this class of
operation (`markOwnApplicationApplied` and `changeOwnApplicationStatus` were already both
plain functions doing a table update plus a separate event-insert call, not wrapped in an
explicit transaction — this slice preserves that same shape rather than inventing stricter
transactionality other functions in this file don't have either).

### `applied_at` semantics

No existing code or doc previously stated an idempotency rule explicitly — `docs/DATA_MODEL.md`
only said `applied_at` is "set only by the explicit 'mark as applied' action, alongside
`status = 'APPLIED'`," which is consistent with, but doesn't fully specify, the rule below. The
prior implementation actually violated the intended intent: it overwrote `applied_at` to `now()`
on _every_ call, so calling mark-applied twice (or the dashboard reaching `APPLIED` a second
time) would silently bump the timestamp. Adopted rule, now enforced by a single line
(`current.appliedAt ?? new Date().toISOString()`) rather than a branchy special case:

- First transition to `APPLIED` → `applied_at = now()`.
- Repeated mark-applied while already `APPLIED` → idempotent; `applied_at` is preserved (and no
  duplicate `STATUS_CHANGE` event is recorded).
- `APPLIED` → another status → `applied_at` is preserved (`changeOwnApplicationStatus` never
  touches this column, for any status).
- Later transition back to `APPLIED` → `applied_at` is preserved (still non-null from the first
  time, so the `??` never re-fires).

Rationale, matching the product intent: `applied_at` records when the application was
_originally_ submitted, not the most recent status-toggle timestamp.

### Explicit-user-action semantics preserved

`APPLIED` is still never inferred from autofill, saving, generated answers, Gmail, page state, or
generic application creation — `EMAIL_CLASSIFICATION_TO_STATUS` structurally cannot produce it,
`saveApplicationRequestSchema` rejects it at the schema level, and `applicationInputSchema` now
does too (see item 3 above). The only way an application reaches `APPLIED` for the first time is
an explicit "Mark as Applied" click, in either the extension or the dashboard, both of which call
`markOwnApplicationApplied`.

### The architectural invariant this slice establishes

> An existing application reaches `APPLIED` only through the canonical
> `markOwnApplicationApplied` operation. Generic creation and generic status mutation cannot
> independently produce `APPLIED`.
>
> `revertApplicationEvent` may restore a previously-held `APPLIED` state (undoing a later
> automated or manual change away from it) without changing `applied_at` — this is a restore of
> real prior state on the same application's own timeline, not an independent way to originate
> `APPLIED`, and is not a second mark-as-applied path.

### `docs/USER_FLOWS.md` — checked, not changed

§5 step 6 already reads carefully: "User explicitly clicks Mark as Applied in the popup (a
dedicated action with its own inline confirm step), or selects `APPLIED` from the status dropdown
on the dashboard's generic manual-status-change control." The parenthetical confirm-step claim is
scoped to the popup clause only — the dashboard clause never claims a confirmation step, and the
dashboard's actual UI (a `<select>` + "Update status" submit button) still has none. No
discrepancy was found, so no change was made here.

### Files changed

- `packages/shared/src/schemas/application.ts` — new `creatableApplicationStatusSchema`/
  `CREATABLE_APPLICATION_STATUSES` (every status except `APPLIED`); `applicationInputSchema`'s
  `status` narrowed to it; `appliedAt` removed from `applicationInputSchema`/`ApplicationInput`.
- `packages/database/src/queries/applications.ts` — `markOwnApplicationApplied` (idempotent
  `applied_at` + conditional event), `changeOwnApplicationStatus` (rejects `APPLIED`),
  `createOwnApplication` (`APPLIED` now unrepresentable via its input type; `applied_at` always
  `null` at creation).
- `apps/web/app/(app)/applications/actions.ts` — `changeApplicationStatus` branches on `APPLIED`.
- `apps/web/app/(app)/applications/page.tsx` — "Add application" form's status `<select>` uses
  `CREATABLE_APPLICATION_STATUSES`, not the full `APPLICATION_STATUSES` list (the filter dropdown
  above it is unaffected — an already-`APPLIED` application must still be filterable).
- Tests: `packages/shared/src/schemas/schemas.test.ts`, `packages/database/src/queries/
applications.test.ts`, `apps/web/app/(app)/applications/actions.test.ts`.

### Tests

Coverage for: a first `IN_PROGRESS → APPLIED` transition (status, `applied_at`, event); idempotent
repeat invocation (no `applied_at` rewrite, no duplicate event); transitioning back to `APPLIED`
after moving away (preserves the original `applied_at`); not-found/not-owned (throws, no write
attempted); `changeOwnApplicationStatus` refusing `APPLIED` without any database call; the
dashboard action routing `APPLIED` through `markOwnApplicationApplied` and every other status
through `changeOwnApplicationStatus`, each exclusively; `createOwnApplication` no longer accepting
`APPLIED` at all (schema-level rejection, and a TS-level construction check); and
`applicationInputSchema` rejecting `status: 'APPLIED'` directly. The pre-existing
`mark-applied/route.test.ts` suite was re-run unmodified and still passes, confirming the
extension's entry point is unaffected. No pgTAP suite was added — this slice makes no database
schema change.

### Definition of done

- One function (`markOwnApplicationApplied`) implements the entire APPLIED transition; every
  known entry point calls it; the generic status function refuses to handle `APPLIED` at all.
- `applied_at` follows the documented idempotent rule above, verified by tests, not just asserted
  in prose.
- `packages/database`, `apps/web` typecheck and lint clean; the full `@career-os/database` and
  `@career-os/web` unit/route-test suites pass.

### Explicitly excluded from Phase 5B.0

Everything named at the top of this section — `submission_packets`, consistency findings and
acknowledgements, the consistency-check endpoint, the deterministic rule engine, AI-assisted
unsupported-claim checking, the "what you submitted" viewer, and résumé-version selection. All of
Phase 5B's actual firewall/packet behavior starts at 5B.1.

---

## Phase 5B.1 — Frozen submission packets + the atomic canonical APPLIED transition

**Goal**: when an application newly passes through the canonical mark-applied transition,
atomically create and link exactly one immutable historical packet representing what Career OS
actually knew and had persisted at that moment. The packet is a historical record, not a live
projection — it must never silently change when the profile, résumé, job posting, requirement
mapping, or AI models change later.

### Schema (migration `0013_submission_packets.sql`)

- `applications` and `resumes` each gain a `unique (user_id, id)` constraint — a cheap, additive
  index required so each can be the parent side of a new composite FK (the same treatment
  `job_snapshots`/`requirement_mapping_runs` got in migration 0010; `id` was already globally
  unique, this only adds the exact-pair constraint Postgres requires for the FK target).
- New table `submission_packets` — see `docs/DATA_MODEL.md`'s "submission_packets" section for
  the full column-by-column reference. In summary: `application_id` (composite FK, `unique
(user_id, application_id)` — one packet per application, structurally enforced), nullable
  `job_snapshot_id`/`resume_id`/`requirement_mapping_run_id` (composite FKs), `answers_snapshot`/
  `autofill_summary`/`unresolved_fields`/`consistency_findings`/`consistency_acknowledgements`
  (jsonb, each CHECK-constrained to be a real JSON array where applicable), `content_fingerprint`,
  `created_at`. Immutable via the exact same `reject_immutable_row_mutation` trigger `job_snapshots`
  already uses (reused, not redefined) plus `select`-only RLS for `authenticated` — no
  insert/update/delete policy at all, identical posture to `job_snapshots`/
  `requirement_evidence_mappings`.
- `applications` gains `submission_packet_id` (nullable, composite FK back to
  `submission_packets`, Postgres 15+ column-scoped `on delete set null`).
- New function `mark_application_applied(p_user_id, p_application_id, p_answers_snapshot,
p_autofill_summary, p_unresolved_fields, p_consistency_findings, p_consistency_acknowledgements,
p_job_snapshot_id, p_resume_id, p_requirement_mapping_run_id, p_content_fingerprint)` — see
  "Atomic transition" below. `security invoker`, pinned `search_path`, revoked from
  `public`/`anon`/`authenticated`, granted to `service_role` only — same Part-1 grant pattern as
  every Phase 5A function.

### Atomic transition — replacing Phase 5B.0's plain multi-step operation

Phase 5B.0 made `markOwnApplicationApplied` the one canonical _TypeScript-level_ operation, safe
at the time because it only ever touched one table (a plain update, then a separate event insert).
That stopped being sufficient once packet creation had to join the same transition — there must
never be a window where an application is `APPLIED` without a packet, or a packet exists without
the application actually being `APPLIED`. `mark_application_applied` now performs the _entire_
transition inside one Postgres transaction: row-locks and re-verifies ownership
(`for update`, scoped by both `id` and `user_id` — this function runs via the service-role admin
client, so RLS does not apply; this is the enforcement point), determines current status,
preserves-or-sets `applied_at`, creates at most one packet (only when
`applications.submission_packet_id` is still null), updates
`status`/`applied_at`/`submission_packet_id`, and records a `STATUS_CHANGE` event only on a real
transition. `markOwnApplicationApplied` (`packages/database`) remains the clean abstraction every
caller (the extension route, the dashboard action) already uses unchanged — neither needed to
change to get this atomicity, since the function's public signature and behavior contract didn't
change, only its internals.

**Division of labor**: the deterministic consistency-firewall gate (Phase 5B.2) is explicitly
pure and database-free, so it cannot run inside Postgres — it runs in TypeScript, immediately
before `mark_application_applied` is called, inside the same server-side request handler. The
Postgres function trusts `p_consistency_findings`/`p_consistency_acknowledgements` as
already-validated, final content to freeze; it does not re-derive or re-check them itself. That is
safe because both the gating decision and this call happen in the same request, with no
client-controlled step in between — the same posture `POST /api/applications` already uses for
sanitizing/fingerprinting a job snapshot before calling its own RPC.

`markOwnApplicationApplied`'s TypeScript side now does exactly this much, and no more: read the
current application; if already `APPLIED`, skip straight to calling the RPC with an empty payload
(never assemble or discard packet content for a pure no-op — see "Legacy APPLIED" below); otherwise
gather this application's own `generated_answers` rows and map them into
`SubmissionPacketAnswer[]`, resolve the `CURRENT` requirement-mapping run for the linked snapshot
(if any), compute the content fingerprint (`computeSubmissionPacketFingerprint`,
`packages/shared` — same canonical-JSON/SHA-256/`"v1:"`-prefix pattern as
`computeJobSnapshotFingerprint`), and call the RPC. **Phase 5B.2 has not landed yet in this
commit**, so `consistencyFindings`/`consistencyAcknowledgements` are always empty arrays here —
the RPC parameters and the packet's own columns exist and are exercised, but nothing populates
them with real findings until the next phase.

### Idempotency — all five cases, one rule each in the database function

1. **First transition** (`IN_PROGRESS → APPLIED`): creates the packet, sets `applied_at = now()`,
   links the pointer, records one `STATUS_CHANGE` event.
2. **Repeated mark-applied while already `APPLIED`**: pure no-op — returns current state, no
   second packet, no `applied_at` rewrite, no duplicate event. (Live-verified: pgTAP test "repeated
   mark-applied on an already-APPLIED application returns the current state" plus three more
   asserting no second packet/event/timestamp change.)
3. **`APPLIED → another status`**: unaffected — handled entirely by `changeOwnApplicationStatus`,
   which never touches `applied_at` or `submission_packet_id` for any status (Phase 5B.0).
4. **Another status `→ APPLIED` again**: reuses the existing packet verbatim (never mutated, never
   replaced — the immutability trigger would reject an update attempt anyway), preserves the
   original `applied_at`, records a real `STATUS_CHANGE` event for _this_ transition.
5. **Legacy `APPLIED` row with no packet** (predates this migration): a repeated mark-applied call
   is the same as case 2 — status is already `APPLIED`, so it is a pure no-op. **No packet is ever
   fabricated from today's data and labeled historical.** `submission_packet_id` stays `null`
   forever for that row unless it later genuinely transitions away from and back into `APPLIED`
   (case 4's path, which _does_ create a fresh packet the first time `submission_packet_id` is
   null and a real transition happens — that is a legitimate new submission, not a backfill).

### `applied_at` semantics (unchanged from Phase 5B.0, now enforced inside the atomic function)

Still the single rule: `applied_at = coalesce(current.applied_at, now())`, evaluated once per
transition attempt, inside the same transaction as everything else — first transition sets it,
every later call (idempotent repeat, or a genuine return to `APPLIED`) preserves it.

### Truthful `answers_snapshot` — what the packet does and does not capture

`answers_snapshot` is sourced exclusively from this application's own already-persisted
`generated_answers` rows. Career OS only ever has a literal value for a field if the user
requested an AI suggestion for it — whether they ultimately approved, edited, or skipped it. **A
field the user typed directly into the employer's page, or that the browser's own autofill
completed, was never sent to Career OS and has no entry in the packet.** This is a deliberate,
documented limitation, not an oversight: inventing a value for such a field, or reconstructing one
from today's profile and presenting it as "what was submitted," would be exactly the kind of
fabricated historical data this phase exists to avoid. `autofillSummary`/`unresolvedFields` are
copied at freeze time rather than read live later, because `applications.autofill_summary`/
`unresolved_fields` remain ordinarily mutable after `APPLIED` (an extension "Save" overwrites them
unconditionally regardless of status) — the live columns are not a safe historical source on their
own.

### `resume_id` — honestly nullable

Inspected before building this: `applications.resume_id` has no writer anywhere in this
codebase (confirmed already in the Phase 5B.0 inspection). `submission_packets.resume_id` is
therefore always `null` today — never inferred from a "current" or "primary" résumé, never
defaulted. A résumé-selection feature that would let this column actually get populated is a
real, plausible future addition, deliberately not built in this phase.

### Content fingerprint

`computeSubmissionPacketFingerprint` (`packages/shared/src/lib/submission-packet-fingerprint.ts`)
canonicalizes `applicationId`/`jobSnapshotId`/`resumeId`/`requirementMappingRunId`/
`answersSnapshot`/`autofillSummary`/`unresolvedFields`/`consistencyFindings`/
`consistencyAcknowledgements` into a fixed-key-order object (answer `sourceFactIds` sorted for
order-independence; answer order itself preserved, since it reflects meaningful generation order)
and SHA-256-hashes the JSON, prefixed `"v1:"`. Deliberately excludes `id`/`createdAt` (identity/
system metadata, not content). Unit-tested: identical logical content produces an identical
fingerprint regardless of `sourceFactIds` array order; changing any participating field changes
the fingerprint.

### Packet read plumbing

`getOwnSubmissionPacket`/`getOwnSubmissionPacketByApplicationId` (`packages/database`) — read-only,
owner-scoped, no service-role needed (the table's own `select`-only RLS is sufficient). `GET
/api/applications/:id/packet` (cookie-session-authenticated, same posture as `GET
/api/job-snapshots/:id/requirements`) — returns `{ packet: null }` as a legitimate 200 for both
"not APPLIED yet" and "legacy APPLIED, no packet," never as an error; a nonexistent/not-owned
_application_ is the only 404, indistinguishable from not-found on purpose. No polished UI yet —
deferred to Phase 5B.4.

### Files changed

- `supabase/migrations/0013_submission_packets.sql` (new)
- `supabase/tests/database/0019_submission_packets.test.sql` (new) — 30 pgTAP assertions
- `packages/shared/src/schemas/submission-packet.ts`, `consistency-finding.ts` (new — the
  consistency-finding schema is included here because `submission_packets.consistency_findings`/
  `consistency_acknowledgements` need it at the type level even though nothing populates real
  findings until 5B.2)
- `packages/shared/src/lib/submission-packet-fingerprint.ts` (+ test, new)
- `packages/shared/src/schemas/application.ts` — `submissionPacketId` added to `applicationSchema`
- `packages/database/src/queries/submission-packets.ts` (new) — packet reads + the
  `mark_application_applied` RPC wrapper
- `packages/database/src/queries/applications.ts` — `markOwnApplicationApplied` rewritten to
  orchestrate trusted-content assembly + the atomic RPC call instead of a plain update
- `packages/database/src/types/database.types.ts` — `submission_packets` table,
  `applications.submission_packet_id`, `mark_application_applied` function types (hand-maintained,
  per this file's own header comment)
- `apps/web/app/api/applications/[id]/packet/route.ts` (+ test, new)
- `docs/DATA_MODEL.md` — new "submission_packets"/"mark_application_applied" sections, RLS
  exception note extended

### Tests

`packages/shared`: fingerprint determinism/change-detection (6 tests). `packages/database`: a
first transition assembling and passing the right packet content to the RPC, the idempotent
already-`APPLIED` path skipping assembly entirely, the no-job-snapshot path never calling the
requirement-run lookup, and not-found rejection (4 tests, `markOwnApplicationApplied`'s
dependencies — `listOwnGeneratedAnswersForApplication`, `getCurrentOwnRequirementMappingRun`,
`markApplicationAppliedAtomic` — mocked at module scope so these tests assert orchestration, not
re-test already-covered internals). `apps/web`: the new packet route's auth/ownership/empty/
present cases (4 tests); the pre-existing `mark-applied/route.test.ts` and
`applications/actions.test.ts` suites were re-run unmodified and still pass, confirming both
canonical-transition entry points are unaffected by the internal rewrite.

**pgTAP — live-verified against the real linked Supabase project** (this sandbox has no
Docker/Podman, so `supabase test db`'s normal runner can't execute directly; run via `supabase db
query --linked -f`, with each assertion's TAP line captured into a session-local temp table and
aggregated into one final `select` before `rollback`, same technique Phase 5A's live verification
used): **30/30 assertions pass** — owner select, cross-user isolation, anon denial (with the
`request.jwt.claims` GUC deliberately reset before the anon check, since it is a plain session
variable independent of `role` and would otherwise silently keep resolving to whichever user's
claims a prior `set local` left behind), authenticated direct insert/update/delete all
ineffective (a table with only a `select` policy and no `update`/`delete` policy silently matches
zero rows for those commands rather than raising an error — verified by content still present/
unchanged afterward, not by expecting an exception), immutability-trigger enforcement against a
role that bypasses RLS entirely, one-packet-per-application uniqueness, composite-FK cross-user
rejection (application and job-snapshot references), a JSON-array CHECK constraint, grant denial
for `authenticated`/`anon` on `mark_application_applied`, all five idempotency cases from the
section above end-to-end, and confused-deputy rejection (a caller cannot mark `APPLIED` an
application it doesn't own by passing a mismatched `p_user_id`, nor reach a nonexistent
`application_id`). The whole file runs inside `begin … rollback`, so none of this left residue in
the real database.

**Typecheck/lint/format**: `@career-os/shared`, `@career-os/database`, `@career-os/web` typecheck
clean; `@career-os/extension` typechecks clean as a sanity check (unaffected); `next lint` zero
warnings; `prettier --check` clean on every touched file.

### Definition of done

- An application newly reaching `APPLIED` always gets exactly one immutable packet, created
  atomically with the status transition — verified live, not just asserted.
- A legacy `APPLIED` application never receives a fabricated packet, verified live.
- `applied_at`'s idempotent rule holds across all five cases, verified live.
- No table/function exposes packet content beyond the owning user — select-only RLS, service-role-
  only writes, composite FKs, verified live including the anon and confused-deputy cases.

### Explicitly excluded from Phase 5B.1

Consistency findings/acknowledgements are structurally supported (columns, RPC parameters, Zod
schemas) but never populated with anything but empty arrays in this slice — the deterministic rule
engine that would compute them (`packages/shared/src/lib/consistency-rules.ts`) already exists in
this same commit's tree for Phase 5B.2 to wire up next, but nothing calls it yet. Also not yet
built: the consistency-check endpoint, the mark-applied gate/acknowledgement flow, any dashboard
or extension UI for warnings/blockers, AI-assisted unsupported-claim checking, the "what you
submitted" viewer, and résumé-version selection.

---

## Phase 5B.2 — Deterministic consistency firewall

**Goal**: before a _new_ canonical submission is marked APPLIED, detect meaningful
contradictions between the persisted application answers and trusted persisted candidate/
profile/evidence data — without turning ordinary wording differences into errors. BLOCKING:
two current answers inside the same application are structurally contradictory and cannot both
be true. WARNING: an answer differs from stored profile/evidence, where either side might
legitimately be stale or intentionally different. Warnings can be acknowledged; BLOCKING
findings cannot.

### Rule engine (`packages/shared/src/lib/consistency-rules.ts`, shipped in the 5B.1 commit, wired

up here)

Pure, deterministic, no database/network/Claude/embeddings access — a plain function of its
arguments. Deterministic finding ids (`computeFindingId`, a non-cryptographic FNV-1a hash of the
rule id + normalized comparison identity — never `randomUUID()`) so an acknowledgement collected
from an earlier `GET /consistency-check` still matches the identical finding recomputed a moment
later at the authoritative `PATCH /mark-applied`, as long as nothing actually changed.

**Rules implemented** (all WARNING unless noted):

- `GRADUATION_DATE_MISMATCH` / `GPA_MISMATCH` — only when **exactly one** approved education
  record exists (never fuzzy-selects between several); dates compared at month granularity via
  `extractMonthYear` (recognizes "May 2028"/"05/2028"/"2028-05"/"2028-05-01" as equal; a bare
  year is ambiguous and never extracted); GPA requires an explicit decimal point to be extracted
  at all ("4" alone is too ambiguous — years of experience, a 1-5 rating, etc. are equally
  plausible readings).
- `EMPLOYMENT_DATE_MISMATCH` / `JOB_TITLE_COMPANY_MISMATCH` — only when **exactly one** approved
  experience record exists, and only for a field whose own label names what it's asking for
  ("company"/"employer", "title"/"position" — deliberately excludes a looser word like "role",
  which is as likely to be a narrative free-response prompt as a structured title field). Company
  names normalize through `normalizeCompanyName` (strips Inc/LLC/Corp/etc. and punctuation) with
  containment treated as equivalence — "Deloitte" and "Deloitte LLP" never mismatch.
- `ELIGIBILITY_SELF_CONTRADICTION` (**BLOCKING**) / `ELIGIBILITY_PROFILE_MISMATCH` (WARNING) —
  "question identity" is never inferred from label text or token overlap (no fuzzy semantic
  guess): two answers are only ever compared for self-contradiction when they share the exact
  same, already-trustworthy `fieldClassification` (`WORK_AUTHORIZATION` or `RELOCATION`), which
  Career OS already assigns deterministically at field-detection time — a structural proxy for
  "these are the same kind of eligibility question," not a guess. Polarity extraction
  (`extractYesNoPolarity`) is deliberately narrow: only a bare "yes"/"no" or a sentence's first
  word — never an attempt to parse "I do not require sponsorship"-style double-negative phrasing,
  since a wrong guess there would be a BLOCKING-severity mistake. Everything else resolves to
  `UNKNOWN`, which never produces a finding. A self-contradiction inside the one application
  takes priority over a profile-mismatch check for the same classification (reporting both would
  be noise once the BLOCKING finding already exists).
- `RELOCATION_MISMATCH` is folded into `ELIGIBILITY_PROFILE_MISMATCH` above rather than a
  separate rule id — `profiles.relocationPreference` is a real, trustworthy stored field, so it
  gets the identical conservative polarity-comparison treatment as work authorization, not a
  bespoke rule.
- `UNSUPPORTED_CLAIM` is reserved in the shared enum (`consistencyRuleIdSchema`) but **not
  implemented as a deterministic rule** — free-text "does this claim have evidence" support-
  checking needs semantic judgment a keyword heuristic can't safely provide; it's Phase 5B.3's
  job, explicitly AI-assisted and always WARNING (`AI_ASSISTED_RULE_IDS`), never BLOCKING.

44 unit tests per rule/helper (definite positive, definite negative/equivalent-formatting,
ambiguous-input, no-false-positive, and finding-id-stability cases for every rule; dedicated
normalization tests for dates/GPA/companies/titles/yes-no).

### Trusted input assembler + gate (`packages/database/src/queries/consistency.ts`)

`evaluateOwnConsistencyFindings(ForAnswers)` gathers only already-persisted, already-approved
data: this application's own `generated_answers` rows filtered to `userDecision IN ('APPROVED',
'EDITED')` (a SKIPPED or never-decided suggestion was never going to be submitted, so checking it
would be checking content that isn't real; uses `finalText` when edited, else the original AI
answer), and `education`/`experiences` filtered to `userApproved && approvedForApplications`
(docs/AI_GROUNDING.md's standing rule, applied here even though this isn't an AI call — an
unreviewed record shouldn't be trusted enough to contradict a real answer). Exempted from the
repo's `user-id-filtering.test.ts` structural guard with an explicit, documented reason: it issues
no direct table query of its own, only composes already-independently-scoped functions.

`enforceConsistencyGate(findings, acknowledgedFindingIds)` is the actual authorization boundary:
any BLOCKING finding rejects immediately, before `acknowledgedFindingIds` is even consulted — a
BLOCKING finding can never be satisfied by anything a caller sends, including its own id. A
WARNING finding is satisfied only if its exact, freshly-recomputed id appears in
`acknowledgedFindingIds`; a stale id from an earlier GET, or an invented one, simply isn't in the
current findings list and can never suppress a real current warning. Throws
`ConsistencyCheckFailedError` (`reason: 'blocking_findings' | 'unacknowledged_warnings'`, carrying
the full findings list) otherwise; returns the acknowledgement records to freeze (with a fresh
`acknowledgedAt` timestamp) only for findings actually satisfied this way.

### Wired into `markOwnApplicationApplied` (the one integration seam, unchanged in shape since

5B.0)

Every **real transition attempt** (current status is not already `APPLIED` — covers both a first
transition and reaching `APPLIED` again after moving away) now: fetches `generated_answers` once
(reused for both the packet's `answers_snapshot` and the gate's input — no duplicate fetch),
recomputes findings via `evaluateOwnConsistencyFindingsForAnswers`, and calls
`enforceConsistencyGate` — authoritatively, from scratch, never trusting anything the caller
sends beyond which ids it acknowledged. The idempotent already-`APPLIED` path (and the legacy-
APPLIED-no-packet path, which is the same case) skips the gate entirely — nothing new is being
submitted, so there's nothing to check. A packet that already exists (reaching `APPLIED` again
after moving away) is still gated on **this** transition's current findings — the gate can still
block a re-submission — but the packet itself is never mutated with a later evaluation's result;
only a **newly-created** packet ever freezes `consistencyFindings`/`consistencyAcknowledgements`.
Live-pgTAP-verified: a non-empty findings/acknowledgements payload is frozen into a newly-created
packet exactly as given, including the acknowledgement's timestamp (assertions 29–31 in
`0019_submission_packets.test.sql`).

### API — GET is advisory, PATCH is authoritative

`GET /api/applications/:id/consistency-check` (cookie-session auth, same posture as the packet
route) — fresh recomputation on every call, nothing persisted, returns
`{findings, blockingCount, warningCount}`. Exists purely for UX; deliberately not authoritative.

`PATCH /api/applications/:id/mark-applied` — body is now optional but may carry
`{acknowledgedFindingIds}` (`markAppliedRequestSchema`, defaults to `[]` on a missing/malformed
body — correct for a clean application and fully backward-compatible with the extension's
pre-5B.2 bodyless calls). Catches `ConsistencyCheckFailedError` specifically and returns
`consistencyBlockedResponseSchema`'s shape at **409**, distinct from the existing 404
not-found/not-owned response. This closes the GET/PATCH race by construction: the PATCH call
never reads what GET returned, it recomputes independently at the moment it actually matters.

### Dashboard UI

The application detail page's generic status `<select>` no longer offers `APPLIED` at all
(`CREATABLE_APPLICATION_STATUSES`, reused from Phase 5B.0's create-form exclusion — the same
constant, a different call site) — `changeApplicationStatus`'s existing APPLIED branch (Phase
5B.0) stays as defense-in-depth only, since an HTML form is not a security boundary, but the
primary path is now a dedicated `MarkAppliedPanel` client component: idle → "Mark as Applied"
click → `GET /consistency-check` → clean result submits immediately (identical to pre-5B.2
behavior), otherwise renders BLOCKING findings (no acknowledgement control at all) and WARNING
findings (one unchecked-by-default checkbox each) → a new `markApplicationApplied` server action
(distinct from `changeApplicationStatus`) is called directly from the client component with the
acknowledged ids, returning a discriminated result instead of throwing across the server/client
boundary — a `consistency_check_failed` result re-renders the review panel with the _server's_
findings, never the earlier client-fetched ones.

**A real bug found and fixed while wiring this up**: `changeApplicationStatus`'s APPLIED branch
was still passing the plain session-scoped Supabase client into `markOwnApplicationApplied` —
correct before Phase 5B.1, but `mark_application_applied` has been a `service_role`-only RPC
since that migration, so this would have failed with a permission-denied error the first time
anyone actually clicked through the dashboard's status dropdown to APPLIED. No existing test
caught it, because `actions.test.ts` mocked `@career-os/database` entirely and only asserted
"was `markOwnApplicationApplied` called," never "called with _which_ client" — exactly the class
of gap this repo's own docs have flagged before as something only real integration exercise
catches. Fixed by switching that branch (and the new `markApplicationApplied` action) to
`createAdminClient()`, the same pattern already established for
`apps/web/app/(app)/settings/actions.ts`; a new test now explicitly asserts which client each
branch receives, not just that a function was called.

### Extension UI

`useApplicationTracker` gained `reviewFindings`/`acknowledgedIds` state and
`startMarkAsApplied`/`confirmMarkAsApplied`/`toggleAcknowledgement`/`cancelReview`. The popup's
existing confirm step ("Mark this application as applied?") now calls `startMarkAsApplied`, which
advisory-checks consistency first and either proceeds straight through (clean) or surfaces a
compact review step in `ApplicationTracker.tsx` — BLOCKING findings shown with no acknowledgement
control, WARNING findings with a checkbox each, confirm disabled until every current warning is
checked. No consistency-rule logic exists anywhere in the extension — every finding rendered came
from the server, and a `consistency_check_failed` PATCH response replaces whatever the earlier
GET showed, same "server is authoritative" posture as the dashboard. No new extension permission
was added (manifest untouched) — this only uses the popup's existing authenticated-fetch
infrastructure. `@testing-library/react`/`@testing-library/jest-dom` were added as explicit
devDependencies (already present via npm workspace hoisting from `apps/web`, now correctly
declared rather than relied on implicitly) so `useApplicationTracker`'s new flow could be tested
with `renderHook`.

### "What you submitted" viewer — a first version shipped alongside this phase

Not originally staged until 5B.4, but small enough to build now that the packet and findings
exist: `SubmissionPacketSection` (server component, application detail page, rendered only when
`status === 'APPLIED'`) shows `applied_at`, the reviewed answers (with an explicit, honest note
when there are none — "Career OS has no literal field values recorded... never records what you
typed directly into the employer's page"), autofill summary, consistency findings with
acknowledgement timestamps, and résumé state ("not recorded" when `resumeId` is null, which is
every application today). A legacy APPLIED application with no packet gets the honest, explicit
"marked applied before submission snapshots were introduced" message — never an offer to generate
one from current data. **Still deferred to a dedicated Phase 5B.4 pass**: a requirement-mapping-
run summary in the viewer, and any polish beyond this first pass.

### Files changed

- `packages/database/src/queries/consistency.ts` (+ test, new) — assembler, gate,
  `ConsistencyCheckFailedError`
- `packages/database/src/queries/applications.ts` — `markOwnApplicationApplied` gate wiring
- `packages/database/src/queries/user-id-filtering.test.ts` — documented `consistency.ts`
  exemption
- `apps/web/app/api/applications/[id]/consistency-check/route.ts` (+ test, new)
- `apps/web/app/api/applications/[id]/mark-applied/route.ts` (+ test) — acknowledgement body, 409
  handling
- `apps/web/app/(app)/applications/actions.ts` — admin-client fix, new `markApplicationApplied`
  action
- `apps/web/app/(app)/applications/actions.test.ts` — client-identity assertions, new action tests
- `apps/web/app/(app)/applications/mark-applied-panel.tsx` (+ test, new)
- `apps/web/app/(app)/applications/submission-packet-section.tsx` (new, Phase 5B.4 first pass)
- `apps/web/app/(app)/applications/[id]/page.tsx` — dropdown exclusion, panel + viewer wiring
- `apps/extension/src/lib/api-client.ts` — `checkConsistency`, `markApplied` acknowledgement body
  - 409 handling
- `apps/extension/src/popup/hooks/useApplicationTracker.ts` (+ test, new) — review-flow state
- `apps/extension/src/popup/components/ApplicationTracker.tsx`, `App.tsx` — review UI
- `apps/extension/package.json` — `@testing-library/react`/`jest-dom` declared explicitly
- `supabase/tests/database/0019_submission_packets.test.sql` — 3 more live assertions (33 total)

### Tests / verification

`packages/shared`: 125 tests (44 new for the rule engine). `packages/database`: 72 tests (9 new
for the assembler/gate, 5 new gate-integration cases in `applications.test.ts`). `apps/web`: 92
tests (4 consistency-check route, 4 more mark-applied route cases, 3 more actions cases, 6
`MarkAppliedPanel`). `apps/extension`: 125 tests (6 new for the review flow). pgTAP: 33/33 live
against the linked project (3 new, verifying non-empty findings/acknowledgements are frozen
exactly as given). Typecheck clean across shared/database/web/extension; `next lint` and the
extension's `eslint` both zero warnings.

### Definition of done

- A BLOCKING finding can never be bypassed by any client input — verified by both a unit test
  (`enforceConsistencyGate` ignoring an acknowledgement id matching the blocking finding) and the
  live pgTAP suite's packet-freezing assertions.
- A stale or invented WARNING acknowledgement can never suppress a real current warning —
  verified by dedicated unit tests in both `consistency.test.ts` and
  `useApplicationTracker.test.ts`.
- Both entry points (dashboard, extension) reach the same authoritative gate; neither can bypass
  it — verified live for the dashboard (the admin-client bug fix) and by mock-based tests for both.
- No consistency-rule logic is duplicated in the extension — every finding it ever shows came
  from a server response.

### Explicitly excluded from Phase 5B.2

AI-assisted unsupported-claim checking — shipped separately as Phase 5B.3, below. Résumé-version
selection remains out of scope for the whole 5B line.

## Phase 5B.3 — Explicit AI-assisted unsupported-claim check (advisory only)

See `docs/AI_GROUNDING.md` §9 for the full pipeline design (retrieval, prompting, contract,
citation allowlist, retry policy, telemetry, and the ephemeral/advisory design rationale) — not
duplicated here. In short: `POST /api/applications/:id/unsupported-claims-check` is the only call
site for `generateUnsupportedClaimsCheck`; every finding is `severity: 'WARNING'`
(`ruleId: 'UNSUPPORTED_CLAIM'`), never fed into `markOwnApplicationApplied`'s
`acknowledgedFindingIds` gate, and never frozen into `submission_packets.consistencyFindings` —
the deterministic gate (Phase 5B.2) remains the sole authority over what a submission is actually
required to satisfy. The dashboard's `MarkAppliedPanel` exposes it as a separate, clearly-labeled
"Check unsupported claims" button inside the review step — explicit click only, never auto-fired
alongside the deterministic `GET /consistency-check` that opens the review step. No extension UI
was added for this phase (optional per the original scoping — the dashboard's review step is the
one place a user reviews before submitting either way).

Migration `0014` widens `ai_usage_events.task_type` to accept `'unsupported_claim_check'` —
live-verified against the linked Supabase project (`supabase db push --linked` succeeded after
fixing an initial oversight that would have dropped the already-live `'email_classification'`
value out of the CHECK constraint; caught by the push itself failing with `SQLSTATE 23514` before
any damage, root-caused via a live `select task_type, count(*) ... group by task_type` query
against real data from the Phase 5 Gmail verification pass). The existing 33-assertion
`0019_submission_packets.test.sql` pgTAP suite was re-run live after the migration as a
regression check (it does not touch `ai_usage_events` at all, but re-verifying rather than
assuming was judged worth the low cost) — still 33/33.

### Files changed (Phase 5B.3)

- `supabase/migrations/0014_ai_usage_events_unsupported_claim_check.sql` (new)
- `packages/shared/src/schemas/unsupported-claim-contract.ts` (new — model response contract),
  `consistency-finding.ts` (added `unsupportedClaimCheckResponseSchema`, a three-way
  discriminated union matching the route's actual `ok`/`no_claims_to_check`/`unavailable`
  shapes), `ai-usage-event.ts` (widened `aiUsageEventTaskTypeSchema`)
- `packages/ai/src/generate-unsupported-claims-check.ts` (new — the orchestrator),
  `contract/validate-unsupported-claim-contract.ts` (new), `prompt/build-unsupported-claim-
  system-prompt.ts` + `build-unsupported-claim-user-prompt.ts` (new), `claude/call-claude.ts`
  (added `callClaudeForUnsupportedClaimCheck`), `config.ts` (added the pipeline's token cap,
  prompt version, and answer-text char cap)
- `apps/web/app/api/applications/[id]/unsupported-claims-check/route.ts` (new — the only call
  site), `apps/web/app/(app)/applications/mark-applied-panel.tsx` (added the optional AI-check
  affordance, entirely separate state from the deterministic acknowledgement flow)

### Tests (Phase 5B.3)

`packages/ai`: 40 new tests (orchestrator: rate limit, retrieval short-circuits, success path,
contract-rejection + one-retry-only policy, `provider_error` never retried, usage telemetry
including the `'wrong_length'` → `'validation_failed'` mapping; contract validator: 12 cases;
system/user prompt builders: 14 cases covering untrusted-data tagging, truncation, and the
positional-no-echoed-id contract). `apps/web`: 13 new tests (10 route-level status-mapping cases,
3 `MarkAppliedPanel` cases covering no-auto-fire, rendered findings, and unavailable handling).
Typecheck clean across shared/database/ai/web/extension/email; `next lint` and the extension's
`eslint` both zero warnings; prettier clean.

### Definition of done (Phase 5B.3)

- No caller anywhere in the codebase invokes `generateUnsupportedClaimsCheck` except the one
  route — verified by inspection (only call site) and by the "never fires automatically" UI test.
- Every finding this pipeline can produce is `severity: 'WARNING'` — enforced in code (hardcoded
  in `generate-unsupported-claims-check.ts`, not read from the model), not just convention.
- A malformed model response, an unallowlisted citation, or a length mismatch is rejected and
  retried once, never surfaced as a fabricated finding — verified by the contract-validator and
  orchestrator test suites.
- A `provider_error`, rate limit, or any exhausted rejection maps to HTTP 200
  `status: 'unavailable'`, never an error the client has to specially handle to keep the
  Mark-Applied flow usable — verified by the route's status-mapping tests.
- This pipeline's output never reaches `submission_packets` — confirmed by inspection (no write
  path from `generate-unsupported-claims-check.ts` or its route touches
  `markApplicationAppliedAtomic`/`mark_application_applied` at all).

### Explicitly excluded from Phase 5B.3

Extension UI for this check (dashboard-only for now). A persisted run history for AI-assisted
checks (deliberately ephemeral — see `docs/AI_GROUNDING.md` §9's rationale). Freezing AI-assisted
findings into the submission packet under any circumstance.

## Phase 5B.4 — Historical "what you submitted" viewer (polish pass)

A first-pass `SubmissionPacketSection` shipped already, alongside 5B.1/5B.2's UI work (see "Phase
5B.2" above). This pass closes the two items that section's own doc comment left explicitly
deferred:

- **Requirement-mapping-run summary**: `submission_packets.requirementMappingRunId`, when set, is
  now resolved and summarized — requirement count (via the new, count-only
  `countOwnRequirementMappingsForRun`, which deliberately does not re-fetch mapping content or
  re-resolve live fact validity the way `listCurrentOwnRequirementMappings` does, since a frozen
  historical record doesn't need a live-refreshed breakdown) and the run's original analysis
  date. Looked up by the new `getOwnRequirementMappingRunById` (by id, not "current for this
  snapshot" — unlike `getCurrentOwnRequirementMappingRun`), since the run a packet references may
  since have been superseded by a newer analysis of the same job posting. Honest in every
  direction this can go: a still-`CURRENT` run is summarized plainly; a `SUPERSEDED` run is
  summarized with an explicit "a newer analysis has since replaced this run" note rather than
  silently implying it's still current; a run id that somehow no longer resolves (should not
  normally happen, since runs are never deleted, but nothing here assumes it) states that
  honestly instead of fabricating a count.
- **Component test coverage**: `submission-packet-section.test.tsx` (new — previously untested)
  covers the legacy-no-packet state, reviewed-answer rendering (including the edited-vs-original
  text distinction), résumé-id honesty, all three requirement-analysis-summary states above, and
  consistency-finding/acknowledgement rendering.

### Files changed (Phase 5B.4)

- `packages/database/src/queries/requirement-mapping-runs.ts` (added
  `getOwnRequirementMappingRunById`), `requirement-evidence-mappings.ts` (added
  `countOwnRequirementMappingsForRun`) — both with new unit tests
- `apps/web/app/(app)/applications/submission-packet-section.tsx` (requirement-analysis summary
  block), `submission-packet-section.test.tsx` (new)

### Tests (Phase 5B.4)

`packages/database`: 4 new tests (2 for `getOwnRequirementMappingRunById`, 2 for
`countOwnRequirementMappingsForRun`). `apps/web`: 9 new tests (the previously-untested
`SubmissionPacketSection`, all five states above). Typecheck clean across database/web; `next
lint` zero warnings; prettier clean.

### Explicitly excluded from Phase 5B.4

Any broader visual/design pass beyond this content addition — `SubmissionPacketSection` still
uses the same plain bordered-card layout as its first pass. No résumé-version display beyond the
existing honest "not recorded" state (no résumé-versioning system exists yet to display). No
extension-side historical viewer (dashboard-only, consistent with the extension's popup being a
review-and-fill surface, not a records surface).

## Phase 5B hardening — closing an adversarial-review finding

A focused follow-up pass, not a new numbered sub-phase, addressing three findings from an
adversarial review of the 5B.1–5B.4 commit stack after it was already on `origin/main`. Landed as
its own commit, never rewriting or amending the existing Phase 5B history.

### 1. The direct-PostgREST APPLIED bypass (the important one)

**The finding**: `applications`' RLS policies (migration 0001) are the ordinary four-policy
shape — `update own applications ... using (auth.uid() = user_id) with check (auth.uid() =
user_id)` — with no column restriction. Every "cannot produce APPLIED" claim from Phase 5B.0
onward (`createOwnApplication`/`changeOwnApplicationStatus` both throw on `'APPLIED'`) was true
only of the TypeScript layer. Nothing stopped a user from calling PostgREST directly with their
own legitimate session JWT (`PATCH /rest/v1/applications {status: 'APPLIED'}`, or setting
`applied_at`/`submission_packet_id` directly) and bypassing `mark_application_applied`, packet
creation, and the consistency firewall entirely. This does not cross the multi-tenant boundary
(RLS's `auth.uid() = user_id` still holds — no cross-user exposure), but it does mean a user
could defeat their own Consistency Firewall by going around the app.

**Why not just block every UPDATE with `NEW.status = 'APPLIED'`**: that would also reject any
ordinary edit (e.g. `notes`) to an application that is *already* APPLIED, since Postgres's `NEW`
row reflects every unchanged column too — a real false-positive regression, not merely a
theoretical one.

**Enforcement chosen**: migration `0015_applied_transition_db_guard.sql` adds a `before insert or
update on applications` trigger (`reject_direct_applied_transition`) that rejects a write only
when it is an actual *transition*: `NEW.status = 'APPLIED'` and (`TG_OP = 'INSERT'` or `OLD.status
IS DISTINCT FROM 'APPLIED'`), or `applied_at`/`submission_packet_id` moving from null to
non-null — and only when `current_user <> 'service_role'`. `current_user` (not `session_user`)
was chosen and empirically verified live against the linked project (`set local role X; select
current_user`) precisely because it is the same primitive Postgres's own GRANT/REVOKE system
already relies on for `mark_application_applied`'s access control — reusing an already-proven
mechanism rather than inventing a new one. RLS itself is untouched: this is a second, independent
database-boundary check (CLAUDE.md: "RLS is the backstop, not the only check"), narrowly scoped to
the one case that matters.

**`mark_application_applied` is unaffected**: it always executes as `service_role` (granted
execute only to that role since migration 0013), so `current_user = 'service_role'` inside its own
internal `update applications` statement, regardless of who called the RPC.

**`revertApplicationEvent`'s exception, and closing a second-order bypass it would otherwise
reopen**: restoring APPLIED via undo is the one accepted, pre-existing exception to "only
`mark_application_applied` produces APPLIED." Its one `applications`-table write now runs via the
admin/service-role client (`apps/web/app/(app)/applications/actions.ts`'s `revertEvent` action) —
the same "privileged operation, independently `user_id`-scoped" pattern already used for
`markApplicationApplied`/`changeApplicationStatus`'s APPLIED branch. That alone was not
sufficient, though: `application_events` keeps its ordinary `authenticated` insert policy
unchanged (legitimate code — `changeOwnApplicationStatus`'s move-away-from-APPLIED path — also
inserts real events with `from_status='APPLIED'` via the session-scoped client), so a user could
otherwise insert a *fabricated* event row (`event_type='STATUS_CHANGE', from_status='APPLIED',
reverted_at=null`) for an application that was never genuinely applied, then call the real revert
flow on it to manufacture a fake APPLIED state without ever touching
`mark_application_applied`. `revertApplicationEvent` (`packages/database/src/queries/
application-events.ts`) now refuses to trust the event log's `fromStatus` claim alone: before
restoring APPLIED, it additionally requires the *current* application row's own `applied_at` to
already be non-null — which, thanks to the same migration 0015 trigger, can only ever have been
set by `mark_application_applied` in the first place, making it an unforgeable anchor. A
genuinely-legacy pre-Phase-5B.1 application (which has `applied_at` set by whatever code produced
it at the time, even though it has no packet) still passes this check correctly; a fabricated
event for an application that was never really applied does not.

**Files changed**: `supabase/migrations/0015_applied_transition_db_guard.sql` (new);
`packages/database/src/queries/application-events.ts` (the `applied_at` verification + updated
doc comment); `apps/web/app/(app)/applications/actions.ts` (`revertEvent` now uses the admin
client); `supabase/tests/database/0019_submission_packets.test.sql` (fixture/RPC-invocation role
switched from `postgres` to `service_role` where it touches `applications`' guarded columns — see
that file's own updated comment for why a bare superuser role is not equivalent to `service_role`
under a trigger, even though it was for the `mark_application_applied` grant check alone);
`supabase/tests/database/0020_applied_transition_db_guard.test.sql` (new — 16 assertions
specifically simulating the direct-PostgREST bypass, not just the TypeScript-facing surface).

**Live verification**: migration 0015 applied cleanly against the linked Supabase project. The
existing 33-assertion `0019` suite still passes in full after the fix (with its fixture/RPC-call
roles corrected). The new `0020` suite's 16 assertions were each individually dry-run inside a
`begin...rollback` transaction before being committed to the real migration, and pass live:
direct authenticated/anon INSERT or UPDATE into APPLIED (or directly setting
`applied_at`/`submission_packet_id`) is rejected; ordinary non-APPLIED writes, edits to an
already-APPLIED row's other columns, and moving away from APPLIED are all unaffected;
`service_role` can still perform every one of the writes authenticated was denied, including the
full `mark_application_applied` RPC end-to-end.

### 2. Separating relocation's rule ids from work-authorization's

**The finding**: `evaluateEligibilityGroup` (`packages/shared/src/lib/consistency-rules.ts`) was
called once for `WORK_AUTHORIZATION` and once for `RELOCATION`, but both calls passed the
identical `ELIGIBILITY_SELF_CONTRADICTION`/`ELIGIBILITY_PROFILE_MISMATCH` rule ids — a relocation
finding and a work-authorization finding were indistinguishable by `ruleId` alone, only by
free-text `description`/`fieldBLabel`.

**Fix, backward-compatible by construction**: `consistencyRuleIdSchema` gained two new members —
`RELOCATION_SELF_CONTRADICTION`, `RELOCATION_PROFILE_MISMATCH` — without removing or renaming
anything. `ELIGIBILITY_SELF_CONTRADICTION`/`ELIGIBILITY_PROFILE_MISMATCH` are unchanged and remain
exactly what `WORK_AUTHORIZATION` findings use; only the `RELOCATION` call site in
`evaluateConsistencyFindings` now passes the new dedicated ids. A historical
`submission_packets.consistency_findings` JSON blob — whichever pair of ids it used, for whichever
classification — still parses against the exact same `consistencyFindingSchema`, since a Zod
`z.enum` only ever gained members here, never lost or renamed one. No migration was needed: the
rule engine is pure TypeScript with no database representation of its own, and `consistency_findings`
has no DB-level `CHECK` constraint on its JSON array's element shape (only "is an array" is
enforced at that layer).

**`ConsistencyFieldSource` improved the same way**: both eligibility comparisons tagged their
profile-side value `PROFILE_CONTACT`, a semantic misnomer (neither is contact information).
`consistencyFieldSourceSchema` gained `PROFILE_ELIGIBILITY`; `PROFILE_CONTACT` stays in the enum
unchanged for historical-JSON compatibility, but `evaluateEligibilityGroup` now tags every newly-
generated finding (both classifications) `PROFILE_ELIGIBILITY` instead.

**Viewer/packet compatibility, checked, not assumed**: grepped the whole repo for every reference
to `ELIGIBILITY_SELF_CONTRADICTION`/`ELIGIBILITY_PROFILE_MISMATCH`/`PROFILE_CONTACT` outside
`packages/shared` itself — zero hits. `MarkAppliedPanel`, `ApplicationTracker`, and
`SubmissionPacketSection` all render a finding generically (`description`/`severity`/
`fieldALabel`/`fieldBLabel`), never branching on a specific `ruleId` string — so a historical
packet frozen under the old shared ids renders identically to how it always did, and nothing
needed updating on the display side.

**Files changed**: `packages/shared/src/schemas/consistency-finding.ts` (both enum expansions, plus
doc comments explaining the backward-compatibility contract explicitly);
`packages/shared/src/lib/consistency-rules.ts` (widened `evaluateEligibilityGroup`'s rule-id
parameter types to a union of the old/new pairs, the `RELOCATION` call site, and the
`PROFILE_ELIGIBILITY` field-source tag).

**Tests**: new `RELOCATION_SELF_CONTRADICTION`/`RELOCATION_PROFILE_MISMATCH` describe blocks in
`consistency-rules.test.ts` mirroring the `WORK_AUTHORIZATION` suite one-for-one, including a test
proving the same answer ids under `RELOCATION` vs. `WORK_AUTHORIZATION` classification produce
*different* finding ids (the whole point of the split) and a test proving the fixed existing
`ELIGIBILITY_PROFILE_MISMATCH`/`RELOCATION` test now asserts the new dedicated id; two new
backward-compatibility tests directly `.parse()`-ing a historical finding shaped with the old
`ELIGIBILITY_*` ids and the old `PROFILE_CONTACT` source, proving they still validate.

### 3. The missing AI-severity schema guard

**The finding**: `consistencyFindingSchema`'s own doc comment claimed "enforced both by the
rejection refinement below" for the invariant that an AI-assisted finding (currently only
`UNSUPPORTED_CLAIM`) can never be BLOCKING — but no `.refine`/`.superRefine` existed anywhere in
that file. The claim was false; the actual load-bearing control was, and remains, that
`generate-unsupported-claims-check.ts` hardcodes `severity: 'WARNING'` and never reads severity
from the model's response at all.

**Fix**: `consistencyFindingSchema` now has a `.superRefine` that rejects any finding pairing
`AI_ASSISTED_RULE_IDS.has(ruleId)` with `severity === 'BLOCKING'`. `AI_ASSISTED_RULE_IDS` was moved
earlier in the file (it previously came after the schema that would have needed to reference it)
so the refinement can use the real set directly rather than duplicating the rule-id list inline —
meaning a future addition to that set is automatically covered by this guard with no further
schema change. This is explicitly defense in depth, not a replacement for the hardcoded severity —
the doc comment was rewritten to say exactly that, not to overclaim protection the code doesn't
have. No other rule→severity pairing was made structurally rigid: `ELIGIBILITY_SELF_CONTRADICTION`/
`RELOCATION_SELF_CONTRADICTION` are the only deterministic rules that ever produce BLOCKING, and
locking every other rule's severity in the schema itself was judged not worth the brittleness for
this pass (a future rule needing a different fixed severity can extend `AI_ASSISTED_RULE_IDS`'s
pattern, or add a sibling set, without disturbing this one).

**Files changed**: `packages/shared/src/schemas/consistency-finding.ts` only.

**Tests**: new `packages/shared/src/schemas/consistency-finding.test.ts` — `UNSUPPORTED_CLAIM` +
`WARNING` parses; `UNSUPPORTED_CLAIM` + `BLOCKING` fails schema validation with a message on the
`severity` path; a genuinely deterministic BLOCKING rule (`ELIGIBILITY_SELF_CONTRADICTION`) still
parses successfully, proving the guard is scoped to AI-assisted rules only, not a blanket ban on
BLOCKING; and a direct assertion that `AI_ASSISTED_RULE_IDS` still contains exactly
`UNSUPPORTED_CLAIM` today.

### Re-audit after implementing the above

Re-checked, not just re-asserted: every APPLIED-producing path (still exactly one ordinary
new-submission path at the TypeScript layer, `mark_application_applied`, now also the only
database-layer path unless the caller is `service_role`); every direct write to `applications`
(guarded only on the three APPLIED-related columns, nothing else); `revertApplicationEvent` (now
requires the admin client and the `applied_at` anchor, both proven by dedicated tests);
`mark_application_applied`'s grants (untouched — still `service_role`-only); ordinary
authenticated INSERT/UPDATE behavior on `applications` (fully unaffected for every non-APPLIED
write, live-pgTAP-proven); `submission_packet_id`/`applied_at` mutation (now guarded the same way
as `status`); `application_events` permissions (deliberately left unchanged — the fix lives in
`revertApplicationEvent`'s own verification, not in restricting that table's RLS, since legitimate
code needs to keep inserting `from_status='APPLIED'` events for ordinary APPLIED→something-else
moves); consistency rule ids and old-packet parsing (both confirmed backward-compatible, see
above); `UNSUPPORTED_CLAIM` severity (still hardcoded in code, now also schema-enforced). No
confused-deputy path was introduced: every new/changed write still filters explicitly by
`user_id` in code, matching the pattern every existing service-role write in this codebase already
follows.

### Tests (Phase 5B hardening)

`packages/shared`: 136 tests (11 new: 4 in the new `consistency-finding.test.ts`, 7 net new in
`consistency-rules.test.ts` after also fixing the one pre-existing assertion that asserted the
old shared relocation id). `packages/database`: 82 tests (6 new in the new
`application-events.test.ts`). `apps/web`: 115 tests (1 new `revertEvent` client-identity
assertion in `actions.test.ts`). `packages/ai`/`apps/extension`/`packages/email` unaffected, still
118/125/19 passing. pgTAP: 33/33 (`0019`, fixture roles corrected) + 16/16 (`0020`, new) = 49
live assertions against the linked Supabase project. Typecheck clean across
shared/database/web/extension/ai/email; `next lint` and the extension's `eslint` both zero
warnings; prettier clean.

### Explicitly excluded from this hardening pass

No change to `application_events`' own RLS (deliberately — see the re-audit above for why).
No re-running of the consistency gate on a revert (unchanged, pre-existing, already-accepted
Phase 5B design: a revert restores a historical state, it does not re-review one). No attempt to
cryptographically sign or otherwise make `application_events` rows tamper-evident beyond the
`applied_at`-anchor check — a narrower, sufficient fix for the one exploit path this pass actually
needed to close. No Phase 5C work of any kind.

## Phase 5C.1 — Deterministic next-action engine

**Goal**: for any tracked application, derive one primary "what should I do next" recommendation
from already-persisted state — deterministic, explainable, no model call, no persistence.

### Repository-reality inspection that shaped this design

Before writing any rule, the actual schema was inspected (not assumed): `applications.status`,
`application_events`, `email_signals`, `submission_packets`, and every migration that touches
them. Two findings directly shaped the design:

1. **No deadline of any kind is ever persisted anywhere** — not on `applications`, not on
   `email_signals`, not on `application_events`. There is no "interview date," "assessment due
   date," or "employer deadline" column to read, so "never invent a deadline" isn't a discipline
   this code needs to exercise — it's a structural fact: the type system has no field to invent
   one into (`NextAction.dueAt` is typed `z.null()`, not a nullable date, specifically so it
   cannot silently start being populated without a deliberate type change first).
2. **`applications.status` is already the single, fully-reconciled fact by the time any dashboard
   code sees it.** Every path that could change it based on an email signal
   (`confirmOwnEmailSignal`'s CONFIRM branch, the sync pipeline's AUTO_APPLIED case) routes
   through `changeOwnApplicationStatus`, which writes `status` directly — a `PENDING`
   (unconfirmed) `email_signals` row never touches `status` at all, and neither does a `DECLINED`
   one. This means the engine does not need to separately consult `email_signals` to decide what
   to recommend: `status` alone tells it which of the two eligible statuses it's looking at, and
   whether that status changed at all is never ambiguous. Precedence therefore reduces to a
   straightforward per-status dispatch, not a multi-signal-fusion problem — because Phase 5B
   already made `status` the sole reconciled input for *which stage* an application is in.

   **This finding was originally taken to mean the engine never needed `application_events`
   either — that was incomplete, and was corrected before this reached `origin/main` (see "Phase
   5C hardening — follow-up anchor" below).** `status` being reconciled proves *whether* a
   status change happened, but not *when* — and `APPLIED`/`APPLICATION_RECEIVED` are two distinct
   statuses being handled by the same follow-up branch, so "status is still `APPLIED`" and
   "status is now `APPLICATION_RECEIVED`" are not equivalent for timing purposes: the latter can
   have happened well after the original `appliedAt`. The engine still needs zero *new* queries
   for the pure decision logic itself (it remains a plain function of its arguments), but the
   *caller* now supplies one additional, already-reconciled fact —
   `lastMeaningfulEmployerActivityAt` — assembled from one extra bounded query
   (`listOwnStatusChangeEvents`). `listOwnApplications` alone is no longer sufficient on its own;
   see the hardening section below for exactly what changed and why.

### 5C.1A — Domain model (`packages/shared/src/schemas/next-action.ts`)

- `NextActionType` — `REVIEW_UNRESOLVED_FIELDS`, `COMPLETE_APPLICATION`, `MARK_APPLIED`,
  `REVIEW_ACTION_REQUIRED`, `COMPLETE_ASSESSMENT`, `PREPARE_INTERVIEW`, `REVIEW_OFFER`,
  `CONSIDER_FOLLOW_UP`, `REVIEW_APPLICATION`, `NO_ACTION`. Deliberately narrower than "one per
  `applications.status` value" — `SAVED`/`IN_PROGRESS` collapse into three different types
  depending on real recorded progress (5C.1C below), not the status label alone.
- `NextActionPriority` — `URGENT`/`HIGH`/`MEDIUM`/`LOW`/`NONE`. Five discrete levels, never a
  numeric score (a score would invite false precision this engine has no basis for).
- `NextActionSource` — `APPLICATION_STATUS`/`UNRESOLVED_FIELDS`/`TIME_SINCE_APPLICATION`/
  `UNKNOWN_STATUS`. Every value corresponds to a field the engine actually reads; there is no
  `AI_JUDGMENT` source, because nothing here ever calls a model.
- `NextAction` — `{type, priority, source, appliedAt, daysSinceApplied, followUpAnchorAt,
  daysSinceFollowUpAnchor, dueAt}`. Deliberately has **no title/reason string fields** — see
  5C.1I. `followUpAnchorAt`/`daysSinceFollowUpAnchor` were added in the Phase 5C hardening pass
  (see below) — kept distinct from `appliedAt`/`daysSinceApplied`, which always stay the true
  original-submission fact, never the follow-up clock's own (possibly later) reference point.

### 5C.1B — Rule precedence

Because `status` is single-valued and already reconciled (see above), "precedence" is a plain
switch over `status` with no default case (a new `ApplicationStatus` enum member is a compile
error here until handled), plus two small nested decisions:

```
ACTION_REQUIRED -> REVIEW_ACTION_REQUIRED (URGENT)
ASSESSMENT      -> COMPLETE_ASSESSMENT    (HIGH)
INTERVIEW       -> PREPARE_INTERVIEW      (HIGH)
OFFER           -> REVIEW_OFFER           (URGENT)
REJECTED        -> NO_ACTION              (NONE) -- never a follow-up suggestion
WITHDRAWN       -> NO_ACTION              (NONE) -- never a follow-up suggestion
SAVED/IN_PROGRESS      -> unresolved fields present?  -> REVIEW_UNRESOLVED_FIELDS (MEDIUM)
                          IN_PROGRESS, none left?      -> MARK_APPLIED             (MEDIUM)
                          SAVED, none left/never ran?  -> COMPLETE_APPLICATION     (LOW)
APPLIED/APPLICATION_RECEIVED -> days since max(appliedAt, lastMeaningfulEmployerActivityAt)
                                >= threshold? -> CONSIDER_FOLLOW_UP (LOW)
                                otherwise      -> NO_ACTION         (NONE)
UNKNOWN         -> REVIEW_APPLICATION     (LOW) -- reachable in the type, unwritten today
```

Written down here and in `next-action-rules.ts`'s own comments/tests, not left accidental.
"Known employer deadline outranks heuristic timing" is honored by construction rather than by an
explicit rule: no deadline field exists to ever compete with the heuristic in the first place —
if one is ever added, it would need its own explicit precedence entry here, not a silent
override.

### 5C.1C — Application-status rules, exactly

- **SAVED/IN_PROGRESS**: a non-empty `unresolvedFields` always wins (`REVIEW_UNRESOLVED_FIELDS`),
  regardless of which of the two statuses it is. Otherwise: `IN_PROGRESS` (meaning at least one
  field was approved/edited — see `useApplicationTracker.ts`'s `save()`) with nothing left
  unresolved becomes `MARK_APPLIED`; `SAVED` with no unresolved-field record at all (either a
  manually-created dashboard application that never touched the extension flow, or a run that
  approved nothing and left nothing unresolved) becomes `COMPLETE_APPLICATION`. `null` vs. `[]`
  for `unresolvedFields` is a real, meaningful distinction here, not treated as equivalent.
- **APPLIED/APPLICATION_RECEIVED**: `NO_ACTION` until the follow-up threshold (5C.1F), then
  `CONSIDER_FOLLOW_UP`. `APPLICATION_RECEIVED` uses the same original `appliedAt`, since no
  separate "received at" timestamp is persisted on `applications`.
- **ASSESSMENT** -> `COMPLETE_ASSESSMENT`. **INTERVIEW** -> `PREPARE_INTERVIEW`. **OFFER** ->
  `REVIEW_OFFER`. **ACTION_REQUIRED** -> `REVIEW_ACTION_REQUIRED`.
- **REJECTED**/**WITHDRAWN** -> `NO_ACTION` (a UX choice: nothing is actionable for the user on a
  closed application, and — per the explicit self-review requirement — neither ever produces a
  follow-up suggestion).
- **UNKNOWN** -> `REVIEW_APPLICATION`. This status exists in `applicationStatusSchema` but no
  code path in this repository writes it today (confirmed by inspection, not assumed) — handled
  anyway so the switch has no default case to silently swallow a future real use of it.

### 5C.1D — Unresolved/autofill awareness

Only `applications.unresolvedFields` drives actionability — `autofillSummary`'s raw counts
(`filled`/`approved`/`skipped`/`failed`/`manual`) are deliberately **not** separately branched
on. A `FILL_FAILED` unresolved field is already a `unresolvedFieldSummarySchema` entry (one of
`unresolvedFieldStatusSchema`'s four values), so anything `autofillSummary` could tell the
engine that actually implies user action is already captured there; branching on the raw counts
too would risk exactly the noisy, redundant alert the spec warns against.

### 5C.1E — Email/Gmail signal awareness

No separate email-signal input exists in `NextActionRuleInput` at all — see the repository-reality
finding above. A `PENDING` (unconfirmed) signal is real repository state, but it is surfaced
through the existing Settings-page confirmation flow (`listOwnEmailSignalsNeedingConfirmation`),
not duplicated as a new next-action type here; adding one would have meant either treating an
unconfirmed signal as if it were authoritative (explicitly forbidden) or building a second,
parallel "please confirm" surface next to the one that already exists. Deliberately deferred, not
overlooked — noted as a considered-and-declined option below.

### 5C.1F — Follow-up recommendation

`FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS = 7`, a named constant in `next-action-rules.ts` (not a
magic number at each call site). No existing product doc specifies a threshold (checked
`docs/PRODUCT_SPEC.md`, `docs/USER_FLOWS.md`, and this file before choosing one) — 7 days is a
conservative default: long enough that a follow-up isn't premature, short enough to still be
useful. `CONSIDER_FOLLOW_UP` only ever fires for an `APPLIED`/`APPLICATION_RECEIVED` application
once at least `FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS` whole days have passed **since the more
recent of `appliedAt` and the most recent trustworthy employer-driven status change** (see "Phase
5C hardening — follow-up anchor" below for the full anchor design — an earlier version of this
heuristic used `appliedAt` alone, which was corrected before this reached `origin/main`). It is
always `LOW` priority and always `type: 'CONSIDER_FOLLOW_UP'` — never conflated with a fact,
never escalated to "overdue" past the threshold (there is no upper bound/escalation at all), and
always suppressed outright by every higher-priority state (`ACTION_REQUIRED`/`ASSESSMENT`/
`INTERVIEW`/`OFFER` are their own switch branches and never reach the follow-up computation at
all; `REJECTED`/`WITHDRAWN` always resolve to `NO_ACTION`).

### 5C.1G — Real known dates only

`NextAction.appliedAt` is the one real fact ever surfaced — always `applications.appliedAt`
verbatim, never inferred, never defaulted to "today." `dueAt` is typed `z.null()` (not a nullable
date) specifically because nothing in this schema can ever produce a non-null value for it yet —
see 5C.1A. "Prepare for interview," not "interview due tomorrow"; "Complete the assessment," not
"assessment due in 2 days" — enforced by `format-next-action.ts` never having a date-shaped
template for either.

### 5C.1H — Architecture: three separated layers

1. **Server-side data assembly** — `apps/web/lib/dashboard.ts`'s `attachNextActions`, wiring an
   already-fetched `Application[]` (plus, as of the Phase 5C hardening pass,
   `listOwnStatusChangeEvents`'s results reduced via `buildLastStatusChangeMap`) into the rule
   engine. Never calls Supabase itself — the queries themselves are issued by the calling page.
2. **Pure rule engine** — `packages/shared/src/lib/next-action-rules.ts`'s `deriveNextAction`. No
   database access, no network access, no Claude — a plain function of its arguments, the same
   posture as `consistency-rules.ts`.
3. **UI formatting** — `packages/shared/src/lib/format-next-action.ts`'s `formatNextAction`,
   turning a `NextAction` into `{title, reason}` strings. Kept separate from the domain object
   (5C.1A's own design question, answered: yes, a formatter, not stored text) so wording changes
   never touch the rule engine, and the rule engine's own tests never assert exact prose.

### 5C.1I — Explainability

Every `NextAction` carries a `source` naming the persisted fact it came from. `formatNextAction`'s
`CONSIDER_FOLLOW_UP` text is the concrete example from the original spec — with one correction
from the Phase 5C hardening pass: it now says "You applied N days ago and Career OS has not
detected anything newer since" only when the follow-up anchor is actually `appliedAt` itself; when
a later, confirmed employer-driven status change reset the clock, it instead says "Career OS last
saw an employer update N days ago and Career OS has not detected anything newer since" — never
claiming "no newer signal" when the implementation hasn't actually checked for one (see the
hardening section below for why the original wording was inaccurate for an `APPLICATION_RECEIVED`
application). Either way: the day count and which anchor produced it are fact (`followUpAnchorAt`
is real, "now" is real, the absence of anything newer since that anchor is now genuinely
observable — see the hardening section's `lastMeaningfulEmployerActivityAt`), while "suggests" and
the explicit "not a known employer deadline" disclaimer keep the recommendation clearly separated
from a fact. Nothing in `format-next-action.ts` ever says "overdue," "late," or implies an
employer promise.

### 5C.1J — Tests

`packages/shared/src/lib/next-action-rules.test.ts` (46 tests): one case per `ApplicationStatus`
value (table-driven), the unresolved-field override (including the `null` vs. `[]` distinction
for both `SAVED` and `IN_PROGRESS`), the follow-up threshold's exact boundary (`>= threshold`
fires, one millisecond short does not, well past the threshold still fires with no escalation,
`APPLICATION_RECEIVED` uses the same threshold, a null `appliedAt` never fires it), explicit
precedence assertions (`REJECTED`/`WITHDRAWN` never produce a follow-up regardless of elapsed
time; `ACTION_REQUIRED`/`ASSESSMENT`/`INTERVIEW`/`OFFER` each short-circuit before any follow-up
computation runs at all; unresolved fields outrank `MARK_APPLIED`), a safety sweep asserting
every status is handled without throwing even with every optional field null, and (Phase 5C
hardening) a dedicated "follow-up anchor" describe block with the full A-I case list from that
pass's own review — see "Phase 5C hardening — follow-up anchor" below.
`packages/shared/src/lib/format-next-action.test.ts` (6 tests) covers every action type
producing non-empty text, the exact singular/plural "N day(s) ago" wording, graceful degradation
with no day count, the explicit fact-vs-recommendation phrasing, and (Phase 5C hardening) the
"Career OS last saw an employer update" vs. "You applied" wording split.

### Explicitly excluded from Phase 5C.1

A `next_actions` table or any other persistence — recomputed at read time every time (see the
"Database decision" rationale below). A dedicated next-action type for an unconfirmed Gmail
signal (5C.1E). Any AI call of any kind. Phase 5C.3 (follow-up drafting/interview-prep content).

## Phase 5C.2 — Dashboard intelligence

**Goal**: make `/dashboard` (previously four static stat cards and a link) answer "what needs my
attention," "what stage is everything in," "what changed recently," and "what should I do next,"
using the Phase 5C.1 engine — never a new AI call, never an analytics vanity metric.

### 5C.2A — Sections implemented

Inspected the existing dashboard before changing it (a placeholder: `total`/`active`/
`interviewing`/`offers` stat cards, a "no applications" empty state, two links) and the existing
`/applications` flat table. Implemented, in this order on `/dashboard`:

- **Attention needed** — every application whose next action is `URGENT`/`HIGH`/`MEDIUM`
  priority, sorted by attention (5C.2B). Deliberately merged with what the original spec
  described as a separate "Upcoming/active" section: since `ASSESSMENT`/`INTERVIEW`/
  `ACTION_REQUIRED`/`OFFER` are already exactly the `URGENT`/`HIGH` members of this same list, a
  second section listing the identical applications again would be the literal duplication the
  spec itself warned against — one well-labeled section instead of two overlapping ones.
- **Follow-up suggestions** — exactly the applications whose next action is
  `CONSIDER_FOLLOW_UP`, labeled inline as "Career OS recommendations — not known employer
  deadlines." Kept structurally separate from "Attention needed" (a `LOW`-priority suggestion is
  excluded from that section's `needsAttention` definition below) specifically so a
  recommendation is never visually conflated with an urgent need.
- **Pipeline overview** — counts per stage group (5C.2E), replacing the old four fixed stat
  cards.
- **Recent activity** — from `application_events`, across every application, one query (5C.2F).
- Not implemented as its own section: a live conversion-percentage/success-rate metric (5C.2E) —
  see that subsection.

### 5C.2B — Attention sorting (`packages/shared/src/lib/attention-sort.ts`)

`compareByAttention`: (1) priority rank, `URGENT` first through `NONE` last; (2) within the same
priority, if both items have a real `appliedAt`, the older one (longer-waiting) sorts first; (3)
otherwise, `updatedAt` descending (most recently touched first) as a stable, always-available
fallback; (4) a final `id` tie-break so the order is a true total order, never accidentally
unstable across re-renders. Pure and independently tested
(`packages/shared/src/lib/attention-sort.test.ts`, 7 tests) the same way the rule engine is.

### 5C.2C — Application cards/rows

`apps/web/app/(app)/dashboard/application-action-row.tsx` — company/title (linked), status
badge, priority badge, the next action's title, and its one-sentence "why." Reused for both the
"Attention needed" and "Follow-up suggestions" sections rather than two bespoke layouts. The
`/applications` list table also gained a compact "Next action" column (priority badge + title
only, no reason text — the detail page/dashboard row is where the full explanation lives),
extending 5C.2C's intent to the existing list view rather than confining next-action visibility
to `/dashboard` alone.

### 5C.2D — Attention count

`apps/web/lib/dashboard.ts`'s `needsAttention(item)` is the **one** definition: priority is
`URGENT`, `HIGH`, or `MEDIUM`. Deliberately excludes `LOW` (`CONSIDER_FOLLOW_UP`,
`COMPLETE_APPLICATION`) and `NONE` — a follow-up recommendation is not an urgent need, and
`COMPLETE_APPLICATION` is "something you could start," not something pressing. The dashboard's
header line ("N applications need attention" / "Nothing needs attention right now") and the
"Attention needed" section's membership both call this exact function — tested in
`apps/web/lib/dashboard.test.ts`.

### 5C.2E — Stage/pipeline grouping

`DASHBOARD_STAGE_GROUPS` (`apps/web/lib/dashboard.ts`) buckets the existing tracked statuses,
inventing no new status: `PREPARING` (`SAVED`, `IN_PROGRESS`), `APPLIED` (`APPLIED`,
`APPLICATION_RECEIVED`), `ACTIVE_PROCESS` (`ASSESSMENT`, `INTERVIEW`, `ACTION_REQUIRED`), `OFFER`
(`OFFER`), `CLOSED` (`REJECTED`, `WITHDRAWN`). `UNKNOWN` maps to a separate `'OTHER'` bucket
(counted but not rendered as its own card, since no code path writes it today) rather than being
silently folded into one of the five real groups. **No conversion percentage/success-rate metric
was added** — plain counts only, per the explicit "prefer counts over fancy percentages for v1"
guidance; a rate over a handful of applications would be exactly the "tiny sample size" case that
guidance warns is easy to get wrong, and no product doc asked for one yet.

### 5C.2F — Recent activity

`packages/database/src/queries/application-events.ts`'s new `listOwnRecentApplicationEvents` —
one query across every application for the user (ordered, limited), not one query per
application. `apps/web/lib/dashboard.ts`'s `toRecentActivity` maps each event to its
company/title using the applications list the page already fetched (an in-memory lookup, never a
second query or a join), and drops anything that is not a live `STATUS_CHANGE` (a `NOTE`/
`MANUAL_EDIT`/`EMAIL_MATCHED` event, or one that has since been reverted) — exactly the "avoid
showing noisy internal events" instruction. The UI renders a from-status/to-status badge pair,
a timestamp, and "via Gmail" only when `source === 'GMAIL_SYNC'` — never raw JSON, never the
event's internal `id`/`source` enum value verbatim.

### 5C.2G — Stale vs. needs-follow-up

Handled by construction, not a separate indicator: an `APPLIED` application that hasn't crossed
the follow-up threshold is `NO_ACTION` (old but not flagged); one that has is `CONSIDER_FOLLOW_UP`
(clearly labeled a Career OS suggestion, per 5C.2A). No additional "stale" badge/section was
added on top of this — a second, differently-worded indicator for the same underlying fact would
risk exactly the "every old application becomes a warning" outcome the spec cautions against.

### 5C.2H — Server/query architecture

`/dashboard` issues three queries in parallel (`Promise.all`): `listOwnApplications`,
`listOwnRecentApplicationEvents`, and (as of Phase 5C hardening) `listOwnStatusChangeEvents` — no
per-application follow-up query, no N+1. `/applications` issues two, the same pattern.
`listOwnStatusChangeEvents` is deliberately a *separate* query from `listOwnRecentApplicationEvents`
even though both read `application_events` — see "Phase 5C hardening — follow-up anchor" below
for why the display-oriented query's cap makes it unsafe to reuse for the follow-up anchor's
correctness. Neither query nor the next-action computation ever touches `submission_packets` —
the packet-existence signal the original spec considered was found unnecessary once
`applications.submissionPacketId` (already present on the `Application` row from Phase 5B.1) was
confirmed sufficient as a boolean-only signal, so Phase 5C.2 was able to avoid querying that
table at all rather than needing to trim a "just a boolean" projection from it.

### 5C.2I — Empty states

No applications: existing card, extended with the profile/applications links. Applications
exist but nothing needs attention: "Nothing needs attention right now." (both in the header and
inline in the "Attention needed" section). No follow-up suggestions: "No follow-up suggestions
right now." No recent activity: "No recent activity." An all-closed pipeline naturally falls out
of the same "nothing needs attention" path — no separate special case was needed, and no
encouragement metric was fabricated for it.

### 5C.2J — Responsive UI

No new design system, no broad redesign — reused `@career-os/ui`'s existing `Card`/`Badge`/
`StatusBadge` and the same plain-Tailwind-utility layout style already used on the application
detail page. The pipeline-overview grid and card rows both collapse to a single column below the
`sm` breakpoint (`grid-cols-1 sm:grid-cols-5`, `flex-col sm:flex-row`), matching the pattern the
pre-existing dashboard's stat cards already used.

### Database decision

**No `next_actions` table, no new column, no migration.** A next action is a derived view of
already-persisted state, recomputed at read time from data `listOwnApplications` was already
returning — introducing a table would mean a stale-synchronization problem (every status change,
unresolved-field update, or the mere passage of time would need to re-trigger a write) for a
value with no independent meaning of its own. Confirmed cheap in practice: the entire computation
for every application on the dashboard is a pure, synchronous, non-async pass over an
already-fetched array.

### Files changed (Phase 5C.1 + 5C.2)

- `packages/shared/src/schemas/next-action.ts` (new)
- `packages/shared/src/lib/next-action-rules.ts` (+test, new)
- `packages/shared/src/lib/format-next-action.ts` (+test, new)
- `packages/shared/src/lib/attention-sort.ts` (+test, new)
- `packages/shared/src/index.ts` (exports for the four files above)
- `packages/database/src/queries/application-events.ts` (+test additions — new
  `listOwnRecentApplicationEvents`)
- `apps/web/lib/dashboard.ts` (+test, new — `attachNextActions`, `sortApplicationsByAttention`,
  `needsAttention`, `DASHBOARD_STAGE_GROUPS`/`stageGroupForStatus`, `toRecentActivity`)
- `apps/web/app/(app)/dashboard/page.tsx` (rewritten)
- `apps/web/app/(app)/dashboard/priority-badge.tsx` (new)
- `apps/web/app/(app)/dashboard/application-action-row.tsx` (new)
- `apps/web/app/(app)/applications/page.tsx` (added the "Next action" column)

### Tests (Phase 5C.1 + 5C.2)

`packages/shared`: 179 tests (43 new: 31 rule-engine table/precedence/boundary cases, 5 formatter
cases, 7 attention-sort cases). `packages/database`: 2 new cases for
`listOwnRecentApplicationEvents`. `apps/web`: 19 new cases in `lib/dashboard.test.ts`. Typecheck
clean across shared/database/web/extension/ai/email; `next lint` zero warnings; prettier clean.

### Explicitly excluded from Phase 5C.2

Phase 5C.3 (AI-assisted follow-up drafting/interview-prep content) — not started, per explicit
instruction. A conversion-percentage/success-rate metric (5C.2E). A dedicated "confirm this Gmail
match" next-action/dashboard surface (5C.1E) — that flow already exists on the Settings page and
was deliberately not duplicated. Any Kanban-board view (`docs/PRODUCT_SPEC.md` §7 mentions one as
an aspirational dashboard surface; it does not exist in this codebase today and building one was
out of scope for this pass — noted here rather than silently left inconsistent with that doc).

## Phase 5C hardening — follow-up anchor

A focused correctness pass on the already-committed Phase 5C.1/5C.2 stack, before either commit
was pushed.

### The bug

`CONSIDER_FOLLOW_UP`'s original implementation computed elapsed time from `applications.appliedAt`
alone. That is correct for an application still sitting at plain `APPLIED`, but
`APPLIED`/`APPLICATION_RECEIVED` are handled by the *same* follow-up branch, and the reconciled-
status finding (5C.1's own design rationale) proves only that a status change happened, not when.
Concretely: an application applied to 10 days ago whose employer sent a confirmed
`APPLICATION_RECEIVED` update yesterday would have immediately shown `CONSIDER_FOLLOW_UP` —
because `daysSinceApplied` was still 10, computed with no awareness that something had just
happened. The original implementation did have the bug.

### What counts as "meaningful employer activity"

Exactly: **the `createdAt` of the most recent `application_events` row with `eventType:
'STATUS_CHANGE'` for that specific application.** Not `updatedAt` — verified by inspection that
`updateOwnApplication` (notes edits, company/title/résumé edits) updates `applications` directly
with no `recordApplicationEvent` call at all, so `updatedAt` bumps on a plain notes edit and is
not a safe proxy for anything employer-related, confirming the task's own suspicion. Not
`email_signals` directly — a `PENDING` (unconfirmed) signal never creates a `STATUS_CHANGE` event
in the first place (only `confirmOwnEmailSignal`'s CONFIRM branch and the sync pipeline's
`AUTO_APPLIED` case ever call `changeOwnApplicationStatus`), so an unconfirmed/ambiguous signal
structurally cannot influence this at all — there is no code path by which it could. `source`
(`USER` vs. `GMAIL_SYNC`) is not distinguished: a manual status change the user recorded after a
phone call carries the same real informational content as a Gmail-confirmed one, and — unlike a
notes edit — a status change is exactly the reconciled fact this whole design already trusts
completely elsewhere. `EMAIL_MATCHED`/`MANUAL_EDIT`/`NOTE` event types are defined in the schema
but never written by any code path today (confirmed by inspection); nothing here depends on that
staying true, since `listOwnStatusChangeEvents` filters to `event_type = 'STATUS_CHANGE'` at the
database layer and `buildLastStatusChangeMap` filters again defensively in application code.

### What does and does not reset the clock

**Resets it:** any `STATUS_CHANGE` event for the application, regardless of `source` — a forward
move (e.g. into `APPLICATION_RECEIVED`) or a revert back to `APPLIED`, since revert also logs its
own new event.
**Never resets it:** a notes/company/title/résumé edit (`updateOwnApplication` — no event
created); an autofill save while still `SAVED`/`IN_PROGRESS` (irrelevant anyway, since the
follow-up branch is only reachable once `APPLIED`); the extension popup opening or a page reload
(reads, not writes); any `PENDING`/`DECLINED` email signal (never reaches `changeOwnApplicationStatus`
at all); internal housekeeping (nothing in this codebase performs any).

### Follow-up anchor calculation

`packages/shared/src/lib/next-action-rules.ts`'s `deriveForSubmittedApplication` now anchors on
`max(appliedAt, lastMeaningfulEmployerActivityAt)` (via a small `laterOf` helper) rather than
`appliedAt` alone. `lastMeaningfulEmployerActivityAt` is a new, optional `NextActionRuleInput`
field — the rule engine stays exactly as DB-free as before; the caller (`apps/web/lib/dashboard.ts`)
supplies it, assembled from a new query (`listOwnStatusChangeEvents`) reduced by a new pure
function (`buildLastStatusChangeMap`) to "most recent `STATUS_CHANGE` timestamp per
`applicationId`". `NextAction` gained two new fields to carry the result honestly:
`followUpAnchorAt` (the timestamp actually used for the threshold check) and
`daysSinceFollowUpAnchor` (days between that anchor and "now") — kept structurally distinct from
`appliedAt`/`daysSinceApplied`, which always remain the true original-submission fact even when
the anchor is later. `formatNextAction`'s `CONSIDER_FOLLOW_UP` text now reads from the anchor
fields, not `daysSinceApplied`, and says "Career OS last saw an employer update N days ago"
instead of "You applied N days ago" whenever the anchor is later than `appliedAt` — otherwise the
"why" text would have kept citing the original application date even after the real reason the
suggestion fired was a stale confirmation, not a stale application.

### The 7-day boundary, unchanged

`FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS` is still 7 and still applies identically — only the anchor
it's measured from changed, not the threshold value or its `>=`-fires/no-upper-bound semantics.

### `APPLICATION_RECEIVED` behavior, corrected

An application applied to 10 days ago with a confirmed `APPLICATION_RECEIVED` update from
yesterday now correctly resolves to `NO_ACTION`, with `followUpAnchorAt` equal to yesterday's
timestamp — it becomes `CONSIDER_FOLLOW_UP`-eligible again only once `FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS`
have passed since that more recent anchor, not since the original `appliedAt`.

### Query architecture

`listOwnStatusChangeEvents` (`packages/database/src/queries/application-events.ts`) is a new,
*separate* query from `listOwnRecentApplicationEvents` — deliberately not reused, because that
query is capped to a small globally-most-recent window for the dashboard's own "Recent activity"
display, and an older application's own most recent status change could easily fall outside that
global top-N window while still being the most recent thing that ever happened to *that*
application. Reusing it would have silently produced an incomplete/wrong anchor for exactly the
applications most likely to need a correct one. `listOwnStatusChangeEvents` fetches every
`STATUS_CHANGE` event for the user in one query (`STATUS_CHANGE_EVENT_SAFETY_LIMIT = 5000` is a
defensive cap against pathological growth, not a realistic bound at this product's current
solo/beta scale — not the same class of risk as the display cap). `/dashboard` and `/applications`
each issue it once, in parallel with their other queries — still no N+1.

### MARK_APPLIED / COMPLETE_APPLICATION in "Attention needed" — reviewed, not changed

Re-examined as requested, not silently altered:

- **`MARK_APPLIED`** is `MEDIUM` priority, so `needsAttention` (URGENT/HIGH/MEDIUM) already
  includes it — a ready-to-submit application does **not** disappear from "Attention needed."
  No issue found here.
- **`COMPLETE_APPLICATION`** is `LOW` priority, so it is excluded from both "Attention needed"
  and the header's "N applications need attention" count — it appears only as an unlabeled
  individual row on the separate `/applications` list, and as a bare number inside the "Preparing"
  pipeline-overview count on `/dashboard` itself. **Flagging, not changing:** for a user whose
  applications are mostly still in "not started" state, this means `/dashboard` — whose stated
  goal is literally "what should I do next?" — shows nothing actionable about most of their
  applications beyond a bare count, even though "go work on this" is a genuine next step for each
  one. This is a real, defensible-but-debatable product tension between "don't manufacture false
  urgency for something with no real time pressure" (the original 5C.2 rationale) and "don't let
  the dashboard go silent about applications that do have a next step." Left as-is per explicit
  instruction not to change priority semantics unilaterally; worth a deliberate product decision
  later, not a silent fix here.

### Files changed (Phase 5C hardening)

- `packages/shared/src/schemas/next-action.ts` (`followUpAnchorAt`/`daysSinceFollowUpAnchor`
  fields, updated `TIME_SINCE_APPLICATION` doc comment)
- `packages/shared/src/lib/next-action-rules.ts` (`lastMeaningfulEmployerActivityAt` input field,
  `laterOf` helper, corrected `deriveForSubmittedApplication`)
- `packages/shared/src/lib/next-action-rules.test.ts` (+15 tests: the full A-I case list)
- `packages/shared/src/lib/format-next-action.ts` (`CONSIDER_FOLLOW_UP` now reads the anchor
  fields; the anchored-to-employer-activity wording branch)
- `packages/shared/src/lib/format-next-action.test.ts` (updated existing cases for the new
  fields, +1 new case for the wording split)
- `packages/database/src/queries/application-events.ts` (new `listOwnStatusChangeEvents` +
  `STATUS_CHANGE_EVENT_SAFETY_LIMIT`)
- `packages/database/src/queries/application-events.test.ts` (+2 tests)
- `apps/web/lib/dashboard.ts` (`buildLastStatusChangeMap`, `attachNextActions` now takes a
  `statusChangeEvents` parameter)
- `apps/web/lib/dashboard.test.ts` (+5 tests: map reduction, defensive event-type filtering,
  wiring through `attachNextActions`)
- `apps/web/app/(app)/dashboard/page.tsx` and `apps/web/app/(app)/applications/page.tsx` (fetch
  `listOwnStatusChangeEvents` alongside the existing queries, pass it through)
- `docs/IMPLEMENTATION_PLAN.md` (this section, plus corrections to 5C.1F/5C.1H/5C.1I/5C.2H's now-
  inaccurate claims)

### Tests (Phase 5C hardening)

`packages/shared`: 195 tests total (18 new — 15 in `next-action-rules.test.ts`, 1 updated + 2 new
in `format-next-action.test.ts`... net +1 test count there since one existing case was extended
rather than duplicated). `packages/database`: 86 tests total (2 new). `apps/web`: 139 tests total
(5 new in `dashboard.test.ts`). Typecheck clean across shared/database/web/extension/ai/email;
`next lint` and the extension's `eslint` both zero warnings; prettier clean; `git diff --check`
clean.

### Explicitly excluded from this hardening pass

Phase 5C.3 — not started. No redesign of the dashboard's sections/layout. No AI of any kind. No
change to `MARK_APPLIED`/`COMPLETE_APPLICATION`'s priority (flagged above, left for a deliberate
product decision). No attempt to distinguish `USER`-sourced from `GMAIL_SYNC`-sourced status
changes for the anchor — both are equally trustworthy reconciled facts, per the rationale above.
