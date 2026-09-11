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
- [ ] Phase 6 — Multi-user beta hardening, privacy controls, testing, deployment
- [ ] Phase 7 — Optional mypham.space integration, public onboarding, future sharing

**Not yet started:** Phase 5B.1 onward (frozen submission packets, the deterministic consistency
firewall, and everything downstream of it) and Phase 5C (next actions/deadlines, dashboard
overview) — both explicitly out of scope for 5A, unscoped beyond their names, and not yet slotted
into the numbered sequence relative to Phase 5's Gmail work. That ordering decision is
intentionally left open rather than assumed here. Phase 5B.0 (this update) is prerequisite
plumbing only — **no `submission_packets` table, consistency findings, acknowledgements,
consistency-check endpoint, rule engine, AI unsupported-claim checking, "what you submitted"
viewer, or résumé selection exist yet.** Those remain fully unimplemented, per the staged 5B plan.

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
