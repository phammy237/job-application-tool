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
      appliedAt and the last legitimate (non-reverted, non-revert-bookkeeping) status change, not
      appliedAt alone, and excludes reverted/correction events from resetting the clock (see
      "Phase 5C hardening — follow-up anchor" and "— revert exclusion" below)
- [x] Phase 5C.3 — AI action assistance: explicit, user-triggered grounded follow-up drafting and
      interview preparation layered on top of (never replacing) the deterministic next-action
      engine's decision (migration 0016, both pipelines ephemeral — see "Phase 5C.3" below)
- [x] Phase 5C.4 — Product polish and phase closure: the `COMPLETE_APPLICATION` dashboard-visibility
      fix, dashboard→detail action handoff, AI-assistance UX/copy polish, a lightweight
      extension→web handoff, and a recent-activity noise fix — no schema change, no migration, no
      new AI feature (see "Phase 5C.4" below)
- [x] Phase 6A — Networking CRM foundation: private contacts, relationship tags,
      application↔contact links, /network + application People UI, deterministic duplicate
      warnings (migration 0017, pgTAP-verified live against the linked Supabase project — see
      "Phase 6A" below). Interactions, reminders, Gmail contact suggestions, and any networking
      AI are explicitly deferred to a later Phase 6 slice (6B+).
- [x] Phase 6B — Contact interaction history: a factual, user-editable timeline per contact
      (email, call, coffee chat, meeting, LinkedIn message, event, introduction, note), optional
      linked-application context, on the contact detail page (migration 0018, pgTAP-verified live
      — see "Phase 6B" below). Record-keeping only — no reminders, next-action recommendations,
      Gmail-derived interactions, or AI, all still deferred to a later Phase 6 slice (6C+).
- [x] Phase 6C — Networking follow-up reminders + deterministic next actions: an explicit,
      user-chosen `contacts.follow_up_at` (migration 0019) and a pure `deriveNetworkingNextAction`
      engine (`FOLLOW_UP_WITH_CONTACT`/`NO_ACTION` only — `SEND_THANK_YOU` explicitly deferred,
      see "Phase 6C" below for why), surfaced on `/network`'s new "Follow-ups due" section and
      `/network/[id]`. Zero AI, zero persisted next-action state, no background notifications —
      Gmail-derived reminders and any heuristic networking action still deferred to a later
      Phase 6 slice (6D+).
- [x] Phase 7A — Master résumé + immutable résumé versioning: logical résumé identity
      (`resumes`: MASTER/TAILORED, one MASTER per user, MASTER-only lineage), immutable
      `resume_versions` snapshots (server-computed version numbers via the
      service-role-only `create_resume_version` RPC, `METADATA_ONLY` content today — no
      structured résumé content, LaTeX, or PDF exist yet), and `/resumes` +
      `/resumes/[id]` library UI (migration 0020, pgTAP-verified live against the linked
      Supabase project — see "Phase 7A" below). Not to be confused with the original
      roadmap's unrelated "Phase 7 — Multi-user beta hardening" entry below, which remains
      unstarted.
- [x] Phase 7B — Application ↔ résumé attachment + submitted-résumé freeze:
      `applications.working_resume_version_id` (an ordinarily-mutable "which version am I
      planning to submit" pointer) and `submission_packets.resume_version_id` (frozen once,
      at the same moment as everything else in a packet, by the extended
      `mark_application_applied`), plus the application detail page's Resume section and the
      historical submission viewer's updated résumé rendering (migration 0021,
      pgTAP-verified live — see "Phase 7B" below).
- [x] Phase 7C — Structured résumé content + deterministic LaTeX rendering:
      `StructuredResumeV1` (Header/Education/Experience/Projects/Leadership/Skills, stable
      entry ids, MANUAL/CANDIDATE_FACTS bullet provenance), a pure `renderStructuredResumeToLatex`
      renderer with full LaTeX-special-character escaping, an optional user-authored custom LaTeX
      override, and `resume_versions.snapshot_format` widened to add `STRUCTURED_V1` (migration
      0022, pgTAP-verified live — see "Phase 7C" below). PDF compilation is explicitly deferred —
      no sandboxed compilation environment exists in this deployment — see docs/RESUME_STUDIO.md.
- [x] Phase 7D — Resume Studio: `/resumes/[id]/studio` manual structured editor (add/remove/
      reorder entries and bullets, no drag-and-drop), an "Import from profile" action gated on
      already-approved facts, Structured/Advanced mode switching, a live deterministic LaTeX
      preview, and "Save New Version" (always creates a new immutable version, never edits one in
      place) — see "Phase 7D" below. No AI, no company research, no PDF preview (§7C).
- [ ] Phase 7 — Multi-user beta hardening, privacy controls, testing, deployment
- [ ] Phase 8 — Optional mypham.space integration, public onboarding, future sharing

The whole Phase 5B line (5B.0 through 5B.4, plus the hardening pass) is complete. Phase 5C is now
complete end to end — 5C.1 (deterministic next actions) through 5C.4 (polish and closure) — see
each phase's own section below for the full writeup. No 5C sub-phase remains unstarted.

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

## Phase 6 — Networking / CRM

A private, user-owned networking layer alongside the existing application tracker — contacts,
their relationship to the user, and their relationship to specific applications. Built as a
sequence of narrow slices; later slices assume earlier ones are solid, same posture as Phase 5B/
5C's lettered sub-phases.

### Phase 6A — Networking CRM foundation (complete)

The first slice: the private contact model and the two link tables everything else in Phase 6
builds on, plus the minimum UI to use them. No AI, no Gmail, no extension changes, no
interactions/reminders — see "Explicitly excluded from Phase 6A" below.

**Established design decisions** (treated as settled for every 6A+ slice unless a real
implementation constraint contradicts them): contacts are private, user-owned, and reusable
across many applications (never duplicated per application), so application↔contact is a join
table; `current_company` stays free text — no `companies` table; relationship tags are
multi-select and distinct from a per-application role; ordinary CRM data uses normal editable
RLS, not Phase 5B's immutable-history semantics; composite ownership FKs structurally reject
cross-user relationships; duplicate detection warns and never auto-merges.

#### Database changes

Migration `0017_networking_contacts.sql` — three new tables, additive only, no existing table
altered:

- `contacts` — `display_name` and `source` required, everything else nullable. `source` is
  `MANUAL | APPLICATION_CONTEXT | OTHER` — only the values this slice can actually produce; no
  speculative `EMAIL_SUGGESTION`/`IMPORT` value added ahead of the feature that would create it.
- `contact_tags` — multi-select relationship classification (`RECRUITER, HIRING_MANAGER,
  EMPLOYEE, ALUMNI, MENTOR, PROFESSOR, FRIEND, CLASSMATE, REFERRER, NETWORKING_CONTACT, OTHER`),
  primary key `(user_id, contact_id, tag)`.
- `application_contacts` — join table with a per-application role (`RECRUITER, HIRING_MANAGER,
  REFERRER, INTERVIEWER, EMPLOYEE_CONTACT, OTHER`), primary key `(user_id, application_id,
  contact_id, role)`, composite FKs to both `applications(user_id, id)` and `contacts(user_id,
  id)`.

Full column-level detail: `docs/DATA_MODEL.md` "`contacts`", "`contact_tags`",
"`application_contacts`". RLS: the ordinary four-policy pattern for `contacts`; `select`/
`insert`/`delete` only for the two link tables (no mutable payload beyond their key, so no
`update` policy is needed — see the migration's own comments).

Deliberately **not** added in this slice, all confirmed as premature by the same review that
scoped it: `source_email_signal_id` (no Gmail contact suggestions yet — the composite FK/
`on delete set null` handling that would need isn't worth solving before the feature exists),
`last_interaction_at`/`follow_up_at` (no interactions or reminders yet).

#### Shared domain types (`packages/shared`)

`schemas/contact.ts` — `contactSourceSchema`, `contactTagSchema`, `applicationContactRoleSchema`,
`contactSchema`, `createContactInputSchema`/`updateContactInputSchema`,
`applicationContactSchema`, `possibleDuplicateReasonSchema`/`possibleDuplicateContactSchema`.
`lib/contact-duplicate-detection.ts` — pure normalizers (`normalizeContactEmail`,
`normalizeLinkedInUrl`, `normalizeContactDisplayName`/`normalizeContactCompany`) and
`findPossibleDuplicateContacts`, matching on exact normalized email, exact normalized LinkedIn
URL, or normalized display name + company, in that priority order.

#### Database query layer (`packages/database`)

`queries/contacts.ts` — full CRUD plus `listOwnContactTagsForContacts`/
`countOwnApplicationLinksForContacts` (batched across a list of contacts — the /network list page
does not issue one query per row) and `findOwnPossibleDuplicateContacts` (fetches the user's own
contacts, small by design, and runs the shared package's pure matcher against them).
`queries/application-contacts.ts` — `listOwnApplicationContacts`/`listOwnApplicationsForContact`
(each two queries: link rows, then a single batched `in(...)` fetch of the other side — never
N+1), `linkOwnContactToApplication` (maps the primary key's unique-violation into a friendly
error), `unlinkOwnContactFromApplication`.

#### UI (`apps/web`)

- `/network` — list, search (over `display_name`/`current_company`/`current_title`/`email`,
  same simple `ilike` approach as the applications list's search), and an "Add contact" form.
- `/network/[id]` — detail: contact info, tags, notes, linked applications (with unlink and a
  "link to an existing application" control), edit, delete.
- `apps/web/app/(app)/applications/[id]`'s new "People" section — contacts linked to that one
  application, "link existing contact" (searches the user's own contacts) and "add new contact"
  (prefills `current_company` from the application, source `APPLICATION_CONTEXT`, links
  immediately on creation).
- Shared `ContactForm` client component backs all three creation/edit surfaces above — every
  save runs `findOwnPossibleDuplicateContacts` first; a match shows "This may already exist"
  with a link to the existing contact and lets the user cancel or save anyway. Never blocks,
  never auto-merges.
- `Network` added to the authenticated app's sidebar nav. No public route touches any of this.

#### Tests

pgTAP: `supabase/tests/database/0021_networking_contacts.test.sql` (32 assertions) — RLS
isolation and ownership for all three tables, cross-user composite-FK rejection on both sides of
`application_contacts`, the primary key rejecting an exact duplicate link, and cascade behavior
(deleting a contact removes its tags/links but never the application; deleting an application
removes its links but never the contact). Unit tests across `packages/shared` (schemas,
normalizers, `findPossibleDuplicateContacts`), `packages/database` (query modules, mocked
Supabase client), and `apps/web` (server actions, the `ContactForm` duplicate-warning flow, the
`/network` and `/network/[id]` pages, and the application People section).

#### Explicitly excluded from Phase 6A (deferred to a later Phase 6 slice)

- `contact_interactions`, coffee-chat/call/meeting logging.
- `follow_up_at`/reminders, a networking next-action engine, thank-you heuristics.
- Gmail → contact suggestions, sender-header parsing, `source_email_signal_id`.
- Any AI: outreach drafting, referral drafting, coffee-chat prep, contact classification.
- Dashboard networking widgets, extension networking features, LinkedIn/Google Contacts
  integration, bulk import, a `companies` table, contact merge.

### Phase 6B — Contact interaction history (complete)

Answers "what history do I have with this person?" — a factual, user-controlled record of past
interactions with a contact, editable like any other personal note (not Phase 5B's immutable-
history semantics). Treats Phase 6A as settled architecture; nothing in 6A was redesigned.

#### Database changes

Migration `0018_contact_interactions.sql` — one new table, additive only, no Phase 6A table
altered:

- `contact_interactions` — `contact_id`, `interaction_type`, and `occurred_at` required;
  `direction`, `subject`, `notes`, and `application_id` all nullable. `interaction_type` is the
  medium (`EMAIL, CALL, COFFEE_CHAT, MEETING, LINKEDIN_MESSAGE, EVENT, INTRODUCTION, NOTE,
  OTHER`), deliberately not a purpose — `THANK_YOU`/`FOLLOW_UP`/`REFERRAL_REQUEST` describe *why*
  an interaction happened and were left out on purpose (that belongs in `subject`/`notes`, or a
  later explicit purpose field if actually needed). `direction` (`INBOUND, OUTBOUND, MUTUAL`) is
  nullable — many interaction types have no natural direction. `source` supports only `MANUAL` in
  this slice.
- Composite FK `(user_id, contact_id) → contacts(user_id, id) on delete cascade` — an
  interaction has no meaning once its contact is gone.
- Composite FK `(user_id, application_id) → applications(user_id, id) on delete set null
  (application_id)` — Postgres 15+'s column-scoped `ON DELETE SET NULL` for a composite FK
  (the same pattern migration 0013 established for `applications.submission_packet_id`), so
  deleting an application only nulls this one column; `user_id` is never touched and the
  interaction survives as real history.
- The optional `application_id` must additionally be one of *this contact's* already-linked
  applications (an `application_contacts` row must already exist) — a business-rule check, not a
  cross-user ownership boundary, so it lives in `packages/database` (like
  `createOwnApplication`'s status guard), not as a table CHECK constraint (which can't reference
  another table).

Full column-level detail: `docs/DATA_MODEL.md` "`contact_interactions`". RLS: the ordinary
four-policy pattern, unlike Phase 6A's `contact_tags`/`application_contacts` — every column here
besides the key is real mutable payload, so `update` is a genuine row update (users can correct
mistakes), not a delete-then-insert.

Deliberately **not** added, all confirmed premature by the same review that scoped this slice: a
`GMAIL_SIGNAL` source (no Gmail-derived interactions yet), any reminder/follow-up field
(`follow_up_at`, a `networking_reminders`/`career_tasks` table), a denormalized
`last_interaction_at` on `contacts` (the timeline query is a single indexed, batched read —
nothing here needed a denormalized shortcut).

#### Shared domain types (`packages/shared`)

`schemas/contact-interaction.ts` — `contactInteractionTypeSchema`, `interactionDirectionSchema`,
`contactInteractionSourceSchema`, `contactInteractionSchema`,
`createContactInteractionInputSchema`/`updateContactInteractionInputSchema` (only
`interactionType`/`occurredAt` required; no `source` field — Phase 6B only ever creates `MANUAL`
rows, so the query layer sets it, never the caller). `lib/datetime-local.ts` —
`toDatetimeLocalValue`/`fromDatetimeLocalValue`, the pure conversion between an HTML
`datetime-local` input's timezone-less value and a real ISO-8601 UTC timestamp; both directions
are only correct when run in the browser's own local timezone, never server-side.

#### Database query layer (`packages/database`)

`queries/contact-interactions.ts` — `listOwnContactInteractions` (one contact's timeline,
`occurred_at desc` then `created_at desc`, backed by the migration's own composite index),
`getOwnContactInteraction`, `createOwnContactInteraction`/`updateOwnContactInteraction` (both
enforce the "application must already be linked to this contact" rule before writing),
`deleteOwnContactInteraction`.

#### UI (`apps/web`)

- `/network/[id]`'s new "Interaction history" section: reverse-chronological list (type,
  date/time, direction, subject, notes, and a human-readable "Related application" link — never
  a raw UUID), a "Log interaction" form, and per-row edit/delete.
- The interaction form's "Related application" picker only ever lists the contact's own already-
  linked applications (never an arbitrary one), and its date/time field renders a loading
  placeholder until mounted, then fills in a local-time default — computing that during server
  rendering would use the server's timezone and risk a hydration mismatch.
- Empty state: "No interactions logged yet." with a "Log interaction" call to action — no
  suggestion, AI or otherwise, of what to log next.
- No new nav entry, no changes to `/network`'s list page or the application People section in
  this slice (a "last interaction" affordance on either was considered and deliberately deferred
  — see "Explicitly excluded from Phase 6B" below).

#### Tests

pgTAP: `supabase/tests/database/0022_contact_interactions.test.sql` (25 assertions) — RLS
isolation and ownership, cross-user composite-FK rejection on both the contact and application
sides, the exact application-deletion semantics (interaction survives, `application_id` nulled,
`user_id` untouched, contact untouched), contact-deletion cascade, and confirmation that deleting
an interaction never deletes the contact or application it referenced. Unit tests across
`packages/shared` (schemas, the interaction-type/direction/source enums, `datetime-local`
round-trip conversion), `packages/database` (query modules, including the linked-application
validation), and `apps/web` (server actions, the `InteractionForm` component, and the
`InteractionTimeline` section).

#### Explicitly excluded from Phase 6B (deferred to a later Phase 6 slice)

- Gmail-derived interactions, sender-header parsing, a `GMAIL_SIGNAL` source.
- Any reminder/follow-up architecture: `follow_up_at`, `networking_reminders`, `career_tasks`.
- A networking next-action engine (`deriveNetworkingNextAction`, `FOLLOW_UP_WITH_CONTACT`,
  `SEND_THANK_YOU`) — interaction history needs to be reliable first.
- Any AI: coffee-chat prep, outreach drafting, summaries, classification. Zero model calls in
  this slice; `ai_usage_events` untouched.
- A "last interaction" affordance on `/network`'s list or the application People section —
  technically easy via a batched grouped query, but deliberately deferred to keep this slice's
  diff and test surface focused on the detail-page timeline, which is the actual priority.
- Interaction search/filtering beyond the plain timeline; a global interactions page.

### Phase 6C — Networking follow-up reminders + deterministic next actions (complete)

Answers "who have I explicitly said I need to follow up with, and what networking action is
factually supported right now?" Applies Phase 5C's core principle to networking: a deterministic
engine decides *what* should happen, derived at read time from explicit persisted facts —
never a heuristic guess about relationship health, social appropriateness, or whether a contact
has been "neglected." No AI; zero model calls.

#### Database changes

Migration `0019_contact_follow_up_reminders.sql` — one nullable column, no new table:

- `contacts.follow_up_at timestamptz` — an explicit, user-chosen reminder date/time. Null means
  no reminder, the default valid state. Career OS never invents or infers this value; setting,
  rescheduling, or clearing it is ordinary contact editing, not immutable-history data. Covered
  by the existing four-policy `contacts` RLS (migration 0017) with no policy change — verified
  directly, not assumed, in `supabase/tests/database/0023_contact_follow_up_reminders.test.sql`.
- Partial index `(user_id, follow_up_at) where follow_up_at is not null`, backing the "due
  reminders" query.

Deliberately **not** added, all confirmed premature by the same review that scoped this slice:
`last_interaction_at`, `networking_priority`/`relationship_score` (no invented social-pressure
metrics), `next_action`/`next_action_due_at` (derived, never persisted — see below), any
reminder/task table, any recurrence field.

#### Why next actions are never persisted

Same reasoning as Phase 5C's application next-action engine: a networking next action depends on
`follow_up_at`, which can change (set, rescheduled, cleared) independently of any "next action"
a persisted value would otherwise go stale against. The server assembles the one input the
engine needs, `deriveNetworkingNextAction` computes a fresh result every time, and the UI
formats it — no `next_actions` table, no synchronization bugs.

#### Networking next-action domain model (`packages/shared`)

`schemas/networking-next-action.ts` — deliberately narrow output vocabulary:
`networkingNextActionTypeSchema` (`FOLLOW_UP_WITH_CONTACT | NO_ACTION` only — see "SEND_THANK_YOU
decision" below), `networkingNextActionSourceSchema` (`EXPLICIT_FOLLOW_UP_REMINDER`, the only
value this phase needs), and `networkingNextActionSchema` reusing `nextActionPrioritySchema`
from the application domain (not a second five-level enum) rather than duplicating it — this
engine only ever emits `MEDIUM` or `NONE`, enforced in the rule engine itself.

`lib/networking-next-action-rules.ts` — `deriveNetworkingNextAction`: pure, DB-free, takes
`{ followUpAt, now }`. The entire rule: `followUpAt !== null && followUpAt <= now` →
`FOLLOW_UP_WITH_CONTACT` (priority `MEDIUM`), otherwise `NO_ACTION` (priority `NONE`) — a future
reminder is a fact worth displaying but deliberately not yet "attention needed." No
interaction-age heuristic, no "you haven't talked in N days," no AI.

`lib/format-networking-next-action.ts` — `formatNetworkingNextAction`: UI title/reason text,
factual and never judgmental (never "neglected," "overdue," or "you should have") — this is the
user's own reminder, not Career OS evaluating the relationship. Does not embed a formatted
calendar date (that's the caller's job, in a web component, per §25 below).

#### SEND_THANK_YOU decision: deferred (option A)

Considered and explicitly **not implemented**. The Phase 6B interaction model
(`interaction_type`, `direction`, `occurred_at`, `subject`, `notes`, `application_id`) has no
signal for whether a thank-you was already sent — in person, outside Career OS, or logged under
a different interaction type — so a rule like "coffee chat yesterday with no later interaction →
suggest a thank-you" would be *guessing* a gap in the record, not deriving a fact from it. That
fails the same bar `FOLLOW_UP_WITH_CONTACT` cleanly clears (an explicit, unambiguous user
signal). `ASK_FOR_REFERRAL`, `RECONNECT`, `REQUEST_INTRO`, and similar are excluded for the more
obvious reason that no supporting context exists in this schema at all. This keeps the type
union to exactly two values and means the engine needs zero interaction reads — a real
simplicity benefit, not just a conservative choice.

#### Data assembly (`apps/web/lib/networking.ts`)

Mirrors `apps/web/lib/dashboard.ts`'s split: `attachNetworkingNextActions` wires an
already-fetched `Contact[]` to `deriveNetworkingNextAction`, and `sortContactsByFollowUpDue`
orders by earliest `followUpAt` then a display-name tie-break (not a priority sort like the
application dashboard's `compareByAttention` — everything this sorts already shares one
priority). Neither function touches Supabase.

#### Database query layer (`packages/database`)

Three new functions in `queries/contacts.ts`: `setOwnContactFollowUp` / `clearOwnContactFollowUp`
(dedicated, not folded into the general `updateOwnContact` — setting a reminder is its own
explicit action), and `listOwnContactsWithDueFollowUp` (one bounded, server-filtered query —
`follow_up_at is not null and follow_up_at <= now`, ordered ascending — never "load every
contact and filter in memory").

#### UI (`apps/web`)

- `/network` — a new "Follow-ups due" section above the searchable contact list (earliest due
  first; an honest "No follow-ups due right now" empty state), and a "Follow-up" column on every
  row ("Follow up today" / "Follow up Sep 20" / "No reminder"). The main list's own sort is
  unchanged — only the due section is reminder-ordered.
- `/network/[id]` — a compact follow-up section near the top: the factual state ("Follow up on
  Sep 20" / "Follow-up reminder due: …" / "No follow-up reminder set.") plus contextual controls
  (`FollowUpReminderControls`, a client component): "Set follow-up reminder" when none exists;
  "Change"/"Clear" for a future reminder; "Mark done"/"Reschedule" once due. No large
  `NO_ACTION` card.
- "Mark done" only clears `follow_up_at` — it never logs an interaction or any other completion
  record (§37 below: dismissing a reminder is not evidence the user actually followed up).
- Application detail's People section and the main `/dashboard` are deliberately **untouched** —
  networking actions never intermix with application actions, and a tiny "N follow-ups due" count
  was considered for both and explicitly deferred as unnecessary polish for this slice.

#### Date/time handling

Reuses Phase 6B's `toDatetimeLocalValue`/`fromDatetimeLocalValue` conversion helpers unchanged —
no new conversion logic was needed. `FollowUpReminderControls`' date field renders only after an
explicit user click (never visible on first render), so — unlike `InteractionForm` — it needs no
mount-gating for a hydration-safe default: the local-time value is always computed from a
post-hydration browser event.

#### Tests

pgTAP: `supabase/tests/database/0023_contact_follow_up_reminders.test.sql` (12 assertions) —
confirms the *existing* `contacts` RLS already covers the new column (own select/update, cross-
user isolation, anon denial) and the due-query's filter semantics (null excluded, future
excluded, past/exactly-now included, scoped to the caller). Unit tests across `packages/shared`
(the rule engine's boundary behavior, the formatter's factual-language guarantee), `packages/
database` (the three new query functions), and `apps/web` (server actions, `networking.ts`'s
assembly/sort functions, `FollowUpReminderControls`, and both `/network`/`/network/[id]` page
tests).

#### Explicitly excluded from Phase 6C (deferred to a later Phase 6 slice)

- `SEND_THANK_YOU` and every other heuristic networking action (`ASK_FOR_REFERRAL`, `RECONNECT`,
  `REQUEST_INTRO`, `ASK_FOR_HELP`, `PREPARE_COFFEE_CHAT`) — see the decision note above.
- Gmail-derived interactions/reminders, Gmail → contact suggestions.
- Any AI: coffee-chat prep, outreach drafting, summaries. Zero model calls in this slice;
  `ai_usage_events` untouched.
- Background delivery of any kind: browser notifications, email/SMS reminders, cron, a
  background task. `follow_up_at` only ever means "show it when the user opens Career OS."
  networking campaigns, calendar integration.
- Relationship scores, "reconnect every N months" heuristics, auto-created follow-up dates.
- A "last interaction" affordance anywhere (still deferred from Phase 6B, unchanged).

---

## Phase 7 — Multi-user beta hardening, privacy controls, testing, deployment

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

### Explicitly excluded from Phase 7

- Public signups (`public_signups_enabled` stays off).
- Billing.

---

## Phase 8 — Optional mypham.space integration, public onboarding, future sharing

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
- Public signups reintroducing all Phase 7 isolation concerns at greater scale — mitigated by
  treating the feature-flag flip as a deliberate go/no-go decision gated on Phase 7 sign-off,
  not an automatic consequence of this phase shipping code.

### Tests

- Unit test: a fact with `visible_on_public_profile = false` never appears in the public
  export response, including for facts added after the endpoint was written (regression
  guard).

### Definition of done

- Public export endpoint ships and is verified to leak nothing private, per the test above.
- A documented (not necessarily executed) decision on whether/when to flip
  `public_signups_enabled`.

### Explicitly excluded from Phase 8

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
ordinary edit (e.g. `notes`) to an application that is _already_ APPLIED, since Postgres's `NEW`
row reflects every unchanged column too — a real false-positive regression, not merely a
theoretical one.

**Enforcement chosen**: migration `0015_applied_transition_db_guard.sql` adds a `before insert or
update on applications` trigger (`reject_direct_applied_transition`) that rejects a write only
when it is an actual _transition_: `NEW.status = 'APPLIED'` and (`TG_OP = 'INSERT'` or `OLD.status
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
otherwise insert a _fabricated_ event row (`event_type='STATUS_CHANGE', from_status='APPLIED',
reverted_at=null`) for an application that was never genuinely applied, then call the real revert
flow on it to manufacture a fake APPLIED state without ever touching
`mark_application_applied`. `revertApplicationEvent` (`packages/database/src/queries/
application-events.ts`) now refuses to trust the event log's `fromStatus` claim alone: before
restoring APPLIED, it additionally requires the _current_ application row's own `applied_at` to
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
_different_ finding ids (the whole point of the split) and a test proving the fixed existing
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
   already made `status` the sole reconciled input for _which stage_ an application is in.

   **This finding was originally taken to mean the engine never needed `application_events`
   either — that was incomplete, and was corrected before this reached `origin/main` (see "Phase
   5C hardening — follow-up anchor" below).** `status` being reconciled proves _whether_ a
   status change happened, but not _when_ — and `APPLIED`/`APPLICATION_RECEIVED` are two distinct
   statuses being handled by the same follow-up branch, so "status is still `APPLIED`" and
   "status is now `APPLICATION_RECEIVED`" are not equivalent for timing purposes: the latter can
   have happened well after the original `appliedAt`. The engine still needs zero _new_ queries
   for the pure decision logic itself (it remains a plain function of its arguments), but the
   _caller_ now supplies one additional, already-reconciled fact —
   `lastRelevantStatusActivityAt` — assembled from one extra bounded query
   (`listOwnRelevantStatusChangeEvents`). `listOwnApplications` alone is no longer sufficient on its own;
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
APPLIED/APPLICATION_RECEIVED -> days since max(appliedAt, lastRelevantStatusActivityAt)
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
recent of `appliedAt` and the most recent legitimate (non-reverted, non-revert-bookkeeping)
relevant status change** (see "Phase 5C hardening — follow-up anchor" and its "— revert
exclusion" follow-up below for the full anchor design — an earlier version of this heuristic used
`appliedAt` alone, then a version that used any status-change event including reverted/correction
ones, both corrected before this reached `origin/main`). It is
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
   `listOwnRelevantStatusChangeEvents`'s results reduced via `buildLastRelevantStatusActivityMap`) into the rule
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
`CONSIDER_FOLLOW_UP` text is the concrete example from the original spec — corrected twice during
the Phase 5C hardening passes: it now says "You applied N days ago and Career OS has not recorded
a newer application-status update since" only when the follow-up anchor is actually `appliedAt`
itself; when a later, legitimate status change reset the clock, it instead says "Career OS has
not recorded a newer application-status update in N days" — deliberately never "the employer
contacted you" or "Career OS saw an employer update," since the anchor can be satisfied by a
user manually recording real progress, not only a confirmed Gmail signal, and never claiming "no
newer signal" when the implementation hasn't actually checked for one (see the hardening sections
below for why the original wording was first inaccurate for an `APPLICATION_RECEIVED`
application, then overclaiming "employer" specifically). Either way: the day count and which
anchor produced it are fact (`followUpAnchorAt` is real, "now" is real, the absence of anything
newer since that anchor is now genuinely observable — see the hardening section's
`lastRelevantStatusActivityAt`), while "suggests" and
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
"Career OS has not recorded a newer application-status update" vs. "You applied" wording split —
and, as of the second hardening pass, that neither phrase ever claims the employer specifically
did anything (see "Phase 5C hardening — revert exclusion" below).

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
`listOwnRecentApplicationEvents`, and (as of Phase 5C hardening) `listOwnRelevantStatusChangeEvents` — no
per-application follow-up query, no N+1. `/applications` issues two, the same pattern.
`listOwnRelevantStatusChangeEvents` is deliberately a _separate_ query from `listOwnRecentApplicationEvents`
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
`APPLIED`/`APPLICATION_RECEIVED` are handled by the _same_ follow-up branch, and the reconciled-
status finding (5C.1's own design rationale) proves only that a status change happened, not when.
Concretely: an application applied to 10 days ago whose employer sent a confirmed
`APPLICATION_RECEIVED` update yesterday would have immediately shown `CONSIDER_FOLLOW_UP` —
because `daysSinceApplied` was still 10, computed with no awareness that something had just
happened. The original implementation did have the bug.

### What counts as "relevant status activity"

**Revised in a second hardening pass — see "Phase 5C hardening — revert exclusion" below.** The
original version of this section said "any `STATUS_CHANGE` event, regardless of source, including
a revert" — that was itself too broad and has been corrected. The current, accurate definition
is: **the `createdAt` of the most recent `application_events` row with `eventType:
'STATUS_CHANGE'` for that specific application, excluding any event with `reverted_at` set and
any event with `source = 'SYSTEM'`** (the bookkeeping event a revert itself creates — see the
revert-exclusion section for exactly why both exclusions are necessary). Not `updatedAt` —
verified by inspection that `updateOwnApplication` (notes edits, company/title/résumé edits)
updates `applications` directly with no `recordApplicationEvent` call at all, so `updatedAt`
bumps on a plain notes edit and is not a safe proxy for anything status-related, confirming the
task's own suspicion. Not `email_signals` directly — a `PENDING` (unconfirmed) signal never
creates a `STATUS_CHANGE` event in the first place (only `confirmOwnEmailSignal`'s CONFIRM branch
and the sync pipeline's `AUTO_APPLIED` case ever call `changeOwnApplicationStatus`), so an
unconfirmed/ambiguous signal structurally cannot influence this at all — there is no code path by
which it could. `source` (`USER` vs. `GMAIL_SYNC`) is not distinguished _between those two_: a
manual status change the user recorded after a phone call carries the same real informational
content as a Gmail-confirmed one, and — unlike a notes edit — a status change is exactly the
reconciled fact this whole design already trusts completely elsewhere. `source = 'SYSTEM'` is a
third category, reserved exclusively for revert bookkeeping, and is excluded entirely (see below).
`EMAIL_MATCHED`/`MANUAL_EDIT`/`NOTE` event types are defined in the schema but never written by
any code path today (confirmed by inspection); nothing here depends on that staying true, since
`listOwnRelevantStatusChangeEvents` filters to `event_type = 'STATUS_CHANGE'` (plus the two
revert-related exclusions) at the database layer, and `buildLastRelevantStatusActivityMap` filters
again defensively in application code.

### What does and does not reset the clock

**Resets it:** a non-reverted `STATUS_CHANGE` event with `source` of `USER` or `GMAIL_SYNC` for
the application — a forward move (e.g. into `APPLICATION_RECEIVED`), regardless of whether a
human or Gmail sync recorded it.
**Never resets it (revised):** a notes/company/title/résumé edit (`updateOwnApplication` — no
event created); an autofill save while still `SAVED`/`IN_PROGRESS` (irrelevant anyway, since the
follow-up branch is only reachable once `APPLIED`); the extension popup opening or a page reload
(reads, not writes); any `PENDING`/`DECLINED` email signal (never reaches
`changeOwnApplicationStatus` at all); internal housekeeping (nothing in this codebase performs
any); **and, as of the second hardening pass: an event that has itself been reverted
(`reverted_at` set), and the `SYSTEM`-sourced bookkeeping event a revert itself creates** — see
"Phase 5C hardening — revert exclusion" below for exactly why the original "any STATUS_CHANGE
event resets it" rule was wrong.

### Follow-up anchor calculation

`packages/shared/src/lib/next-action-rules.ts`'s `deriveForSubmittedApplication` now anchors on
`max(appliedAt, lastRelevantStatusActivityAt)` (via a small `laterOf` helper) rather than
`appliedAt` alone. `lastRelevantStatusActivityAt` is a new, optional `NextActionRuleInput`
field — the rule engine stays exactly as DB-free as before; the caller (`apps/web/lib/dashboard.ts`)
supplies it, assembled from a new query (`listOwnRelevantStatusChangeEvents`) reduced by a new pure
function (`buildLastRelevantStatusActivityMap`) to "most recent `STATUS_CHANGE` timestamp per
`applicationId`". `NextAction` gained two new fields to carry the result honestly:
`followUpAnchorAt` (the timestamp actually used for the threshold check) and
`daysSinceFollowUpAnchor` (days between that anchor and "now") — kept structurally distinct from
`appliedAt`/`daysSinceApplied`, which always remain the true original-submission fact even when
the anchor is later. `formatNextAction`'s `CONSIDER_FOLLOW_UP` text now reads from the anchor
fields, not `daysSinceApplied`, whenever the anchor is later than `appliedAt` — otherwise the
"why" text would have kept citing the original application date even after the real reason the
suggestion fired was a stale confirmation, not a stale application. (The exact wording used here
was corrected again in the second hardening pass — see "Phase 5C hardening — revert exclusion"
below — because "Career OS last saw an employer update" overclaimed that the anchor was always
employer-sourced, which is not true once a manually-recorded `USER` status change is allowed to
set it.)

### The 7-day boundary, unchanged

`FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS` is still 7 and still applies identically — only the anchor
it's measured from changed, not the threshold value or its `>=`-fires/no-upper-bound semantics.

### `APPLICATION_RECEIVED` behavior, corrected

An application applied to 10 days ago with a confirmed `APPLICATION_RECEIVED` update from
yesterday now correctly resolves to `NO_ACTION`, with `followUpAnchorAt` equal to yesterday's
timestamp — it becomes `CONSIDER_FOLLOW_UP`-eligible again only once `FOLLOW_UP_SUGGESTION_THRESHOLD_DAYS`
have passed since that more recent anchor, not since the original `appliedAt`.

### Query architecture

`listOwnRelevantStatusChangeEvents` (`packages/database/src/queries/application-events.ts`) is a new,
_separate_ query from `listOwnRecentApplicationEvents` — deliberately not reused, because that
query is capped to a small globally-most-recent window for the dashboard's own "Recent activity"
display, and an older application's own most recent status change could easily fall outside that
global top-N window while still being the most recent thing that ever happened to _that_
application. Reusing it would have silently produced an incomplete/wrong anchor for exactly the
applications most likely to need a correct one. `listOwnRelevantStatusChangeEvents` fetches every
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

### Files changed (Phase 5C hardening, first pass)

_This list and the test counts below are a snapshot of the first hardening pass only — the one
that introduced the anchor concept but still treated every `STATUS_CHANGE` event (including
reverted ones and revert bookkeeping) as valid. See "Phase 5C hardening — revert exclusion" below
for the second pass's own file list and corrected test counts._

- `packages/shared/src/schemas/next-action.ts` (`followUpAnchorAt`/`daysSinceFollowUpAnchor`
  fields, updated `TIME_SINCE_APPLICATION` doc comment)
- `packages/shared/src/lib/next-action-rules.ts` (`lastRelevantStatusActivityAt` input field,
  `laterOf` helper, corrected `deriveForSubmittedApplication`)
- `packages/shared/src/lib/next-action-rules.test.ts` (+15 tests: the full A-I case list)
- `packages/shared/src/lib/format-next-action.ts` (`CONSIDER_FOLLOW_UP` now reads the anchor
  fields; the anchored-to-employer-activity wording branch)
- `packages/shared/src/lib/format-next-action.test.ts` (updated existing cases for the new
  fields, +1 new case for the wording split)
- `packages/database/src/queries/application-events.ts` (new `listOwnRelevantStatusChangeEvents` +
  `STATUS_CHANGE_EVENT_SAFETY_LIMIT`)
- `packages/database/src/queries/application-events.test.ts` (+2 tests)
- `apps/web/lib/dashboard.ts` (`buildLastRelevantStatusActivityMap`, `attachNextActions` now takes a
  `statusChangeEvents` parameter)
- `apps/web/lib/dashboard.test.ts` (+5 tests: map reduction, defensive event-type filtering,
  wiring through `attachNextActions`)
- `apps/web/app/(app)/dashboard/page.tsx` and `apps/web/app/(app)/applications/page.tsx` (fetch
  `listOwnRelevantStatusChangeEvents` alongside the existing queries, pass it through)
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

## Phase 5C hardening — revert exclusion

A second, narrower correctness pass on top of the one above. The first pass anchored the
follow-up clock on the most recent `STATUS_CHANGE` event, but did not account for **reverts**:
`revertApplicationEvent` (`packages/database/src/queries/application-events.ts`) marks the
_original_ undone event's `reverted_at`, but then inserts a **brand-new**, never-reverted
`source: 'SYSTEM'` event to log the revert itself. That new event was indistinguishable from a
real status update by the first pass's "any `STATUS_CHANGE` event" rule, so it would win as "most
recent" and incorrectly reset the follow-up clock to the moment of the revert, not to any actual
activity.

### The issue, concretely

Sep 1: user marks an application `APPLIED`. Sep 10: user accidentally changes its status (e.g. to
`INTERVIEW`). Sep 11: user notices and reverts it back to `APPLIED`. Under the first pass's rule,
Sep 11's revert-logging event would become the anchor, silently pushing the earliest possible
follow-up suggestion out to Sep 18 — a week of suppressed follow-up caused entirely by correcting
a mistake, with zero real employer or applicant activity behind it.

### Event fields inspected (not assumed)

Confirmed by direct inspection of `packages/database/src/queries/application-events.ts` and a
repo-wide grep for every `recordApplicationEvent`/`source:` call site, rather than inferring
anything from event text:

- `event_type` — only `'STATUS_CHANGE'` was ever relevant here; `NOTE`/`MANUAL_EDIT`/`EMAIL_MATCHED`
  are defined but never written by any code path today.
- `reverted_at` — set on the _original_ event a revert undoes; never set on the revert-logging
  event itself, and never set on any event that was never reverted.
- `source` — `'USER'`, `'GMAIL_SYNC'`, or `'SYSTEM'`. Grepping every call site in
  `packages/database/src` and `packages/email/src` confirmed `source: 'SYSTEM'` is written by
  **exactly one** call site in the entire codebase: `revertApplicationEvent`'s own trailing
  `recordApplicationEvent` call. No other code path ever uses `'SYSTEM'`.
- `from_status`/`to_status` — inspected to confirm `changeOwnApplicationStatus` explicitly rejects
  `toStatus === 'APPLIED'` at runtime, so `APPLIED` is only ever reached via `mark_application_applied`
  (a genuine new transition) or `revertApplicationEvent` (a genuine historical restoration) — there
  is no third, "arbitrary correction," class of event reaching `APPLIED` that this fix needs to
  separately guard against.
- `metadata`/`email_signal_id` — not needed for this fix; `PENDING`/`DECLINED` email signals were
  already confirmed (first pass) to never call `changeOwnApplicationStatus` at all, so they were
  never part of this problem.

### Final definition of the follow-up anchor

`max(appliedAt, lastRelevantStatusActivityAt)`, where `lastRelevantStatusActivityAt` (renamed
from `lastMeaningfulEmployerActivityAt` — see "Terminology" below) is the `createdAt` of the most
recent `application_events` row for the application where `event_type = 'STATUS_CHANGE'`,
`reverted_at IS NULL`, **and** `source != 'SYSTEM'`. Both exclusions are applied twice: once at
the database layer (`listOwnRelevantStatusChangeEvents`'s query itself) and once defensively in
application code (`buildLastRelevantStatusActivityMap`), matching this codebase's established
double-filtering posture (`toRecentActivity` does the same).

Why both filters, not just one: `reverted_at IS NULL` alone is insufficient because the
`SYSTEM`-sourced revert-logging event is never itself marked `reverted_at` — it would still pass
that filter alone. `source != 'SYSTEM'` alone would (in the abstract) miss a case where an older
event was reverted out of order while a newer non-`SYSTEM` event existed — though on inspection
this specific edge case is already safe regardless, since reverting an event never changes its
`created_at`, so a genuinely newer non-reverted event still wins on timestamp either way. Applying
both together is the minimal, structurally sound fix, not belt-and-suspenders for its own sake.

### Do `USER`-sourced status changes count? Yes — decided explicitly, not assumed

Once the revert and `SYSTEM` exclusions are applied, a `USER`-sourced and a `GMAIL_SYNC`-sourced
`STATUS_CHANGE` event are trusted equally, for the same reason the first pass already gave: a
status change — unlike a notes edit — is exactly the kind of reconciled fact this system already
treats as authoritative everywhere else (e.g. `changeOwnApplicationStatus` is the same code path
regardless of who calls it), and a user manually recording real progress (e.g. after a phone call)
carries the same informational weight as a Gmail-confirmed one. This pass does **not** blanket-
distrust `USER` events, per the explicit instruction not to assume all `USER` events are invalid —
instead it narrows what counts by two real structural markers (revert status, source `SYSTEM`)
that have nothing to do with whether a human or Gmail recorded the change. There is no separate
"arbitrary correction" category to worry about, because (per the `from_status`/`to_status`
inspection above) the only ways to reach `APPLIED` are a genuine mark-applied transition or a
genuine revert restoration, and the only way to reach `APPLICATION_RECEIVED` is a genuine
Gmail-confirmed or manually-recorded transition — both already handled correctly by this rule.

### Revert behavior (the fix itself)

At minimum, and exactly as required: a reverted `STATUS_CHANGE` event never resets the follow-up
clock, and neither does the `SYSTEM`-sourced event a revert creates to log itself. Concretely, for
the Sep 1 / Sep 10 / Sep 11 scenario above: the Sep 10 event is excluded because `reverted_at` is
now set on it; the Sep 11 event is excluded because its `source` is `'SYSTEM'`; the anchor falls
through to Sep 1's original mark-applied transition (or to `appliedAt` directly if no other
qualifying event exists) — exactly matching the required test case ("applied 10 days ago, status
changed 1 day ago, that event subsequently reverted, current status `APPLIED`" → the reverted
event does not reset the anchor, follow-up remains eligible based on the last legitimate anchor).

### `APPLICATION_RECEIVED` behavior — unchanged and re-verified

The first pass's core scenario — applied 10 days ago, `APPLICATION_RECEIVED` update from
yesterday → `NO_ACTION` today, not a false-positive follow-up — is unaffected by this pass and
was re-verified by both the existing and new tests: it holds identically whether that
`APPLICATION_RECEIVED` transition came from a Gmail-confirmed sync or an explicit manual entry,
as long as it is a real (non-reverted, non-`SYSTEM`) `STATUS_CHANGE` event, since the repo already
treats the resulting `applications.status` value as authoritative regardless of `source`.

### Terminology

Renamed throughout, because the old names actively overclaimed what the value represents (it can
be satisfied by a user manually recording real progress, not only a literal employer email):

- `lastMeaningfulEmployerActivityAt` → `lastRelevantStatusActivityAt` (`NextActionRuleInput`)
- `listOwnStatusChangeEvents` → `listOwnRelevantStatusChangeEvents` (query)
- `buildLastStatusChangeMap` → `buildLastRelevantStatusActivityMap` (`apps/web/lib/dashboard.ts`)

`formatNextAction`'s `CONSIDER_FOLLOW_UP` copy was corrected from "Career OS last saw an employer
update N days ago" to **"Career OS has not recorded a newer application-status update in N
days"** — it deliberately never says "the employer contacted you" or "Career OS saw an employer
update," since the anchor may just as well be a manually-recorded user update, and the product has
no actual confirmation of employer behavior to claim either way.

### Query architecture — unchanged

No new table, no N+1, no AI. `listOwnRelevantStatusChangeEvents` keeps the same shape as the first
pass's query (one call per page, in parallel with the page's other queries) — this pass only added
two `.is('reverted_at', null)` / `.neq('source', 'SYSTEM')` filters to its existing Supabase query
builder chain and renamed it. `deriveNextAction` remains pure and DB-free; all of the new filtering
logic lives upstream, in the query and in `buildLastRelevantStatusActivityMap`.

### Files changed (Phase 5C hardening, second pass)

- `packages/database/src/queries/application-events.ts` (renamed `listOwnRelevantStatusChangeEvents`;
  added `.is('reverted_at', null)` and `.neq('source', 'SYSTEM')` filters)
- `packages/database/src/queries/application-events.test.ts` (renamed describe block; new
  assertions for both filters)
- `packages/shared/src/schemas/next-action.ts` (doc-comment corrections for the rename; no field
  shape change)
- `packages/shared/src/lib/next-action-rules.ts` (renamed `lastRelevantStatusActivityAt`; doc
  comments clarifying revert/`SYSTEM` exclusion happens upstream)
- `packages/shared/src/lib/next-action-rules.test.ts` (renamed field throughout; corrected
  comments — the pure-engine layer has no knowledge of reverts/sources, so no new pure-engine test
  cases were needed here; the math is unchanged from the first pass)
- `packages/shared/src/lib/format-next-action.ts` (`CONSIDER_FOLLOW_UP` wording corrected to avoid
  overclaiming employer behavior)
- `packages/shared/src/lib/format-next-action.test.ts` (updated wording assertions; explicit
  assertions that neither phrase claims the employer specifically did anything)
- `apps/web/lib/dashboard.ts` (`buildLastRelevantStatusActivityMap` renamed, with `reverted_at`
  and `source === 'SYSTEM'` exclusion filters added)
- `apps/web/lib/dashboard.test.ts` (new tests: a Gmail-confirmed and a manual `APPLICATION_RECEIVED`
  transition both reset the anchor; a reverted event is excluded even when most recent by
  `createdAt`; the `SYSTEM`-sourced revert-logging event is excluded; a non-`STATUS_CHANGE` event
  has no effect; an empty event list has no effect; a full Sep 1/Sep 11 revert scenario end to end)
- `apps/web/app/(app)/dashboard/page.tsx`, `apps/web/app/(app)/applications/page.tsx` (renamed
  import/variable references only — no behavior change)
- `docs/IMPLEMENTATION_PLAN.md` (this section, plus corrections to the first pass's now-inaccurate
  "what counts"/"what resets the clock" claims above)

### Tests (Phase 5C hardening, second pass)

`packages/shared`: 195 tests (unchanged count — only renames/comments, no new pure-engine cases
needed). `packages/database`: 86 tests (unchanged count — existing tests extended with new
assertions rather than new tests added). `apps/web`: 144 tests (5 more than the first pass's 139:
new `dashboard.test.ts` cases for the Gmail/manual `APPLICATION_RECEIVED` reset, the reverted-event
exclusion, the `SYSTEM`-sourced exclusion, the non-`STATUS_CHANGE`/empty-list no-effect cases, and
the end-to-end Sep 1/Sep 11 scenario). Full monorepo sweep also re-run: `packages/ai` 118 tests,
`apps/extension` 125 tests, `packages/email` 19 tests — all unaffected and passing. Typecheck
clean across all six workspaces; `next lint` and the extension's `eslint` both zero warnings;
prettier clean; `git diff --check` clean.

### Explicitly excluded from this pass

Phase 5C.3 — not started. No dashboard redesign. No AI. No change to
`MARK_APPLIED`/`COMPLETE_APPLICATION` priority — left exactly as flagged in the first pass, for a
deliberate product decision later.

## Phase 5C.3 — AI action assistance

Answers a different question than Phase 5C.1/5C.2. Those answer "what should I do next?" —
entirely deterministically, no model call. This phase answers "help me do it" for exactly two of
those next actions where a grounded AI draft is genuinely useful: `CONSIDER_FOLLOW_UP` (draft a
follow-up message) and `PREPARE_INTERVIEW` (generate interview-prep material). The deterministic
engine is untouched and remains fully authoritative — this phase never lets AI decide whether to
follow up, when to follow up, or how urgent anything is; it only helps execute a decision the
engine already made.

### Domain boundary — `ActionAssistanceType`

`packages/shared/src/schemas/action-assistance.ts` defines `ActionAssistanceType` (`FOLLOW_UP_DRAFT`
| `INTERVIEW_PREP`) and `actionAssistanceFor(nextActionType): ActionAssistanceType | null` — the
single place that maps a `NextActionType` to an assistance feature, reused by both pipelines'
eligibility checks (not reimplemented per pipeline) and by its own unit test. Deliberately not one
assistance type per `NextActionType`: `REVIEW_ACTION_REQUIRED`, `REVIEW_OFFER`,
`COMPLETE_ASSESSMENT`, etc. have no AI-assistance feature in this pass — adding one "to make the
enum symmetrical" was explicitly out of scope.

### 5C.3A — Follow-up drafting

`packages/ai/src/generate-follow-up-draft.ts` (`generateFollowUpDraft`), called from the one route
`POST /api/applications/:id/follow-up-draft`. Pipeline shape:

1. **Eligibility gate, before anything billed.** `packages/ai/src/derive-eligible-next-action.ts`
   (`deriveEligibleNextAction`) re-fetches the application and its relevant status-change events
   and re-derives the current `NextAction` from scratch, using the exact same
   `deriveNextAction`/exclusion logic as `apps/web/lib/dashboard.ts`'s `buildLastRelevantStatusActivityMap`
   (re-expressed rather than imported — `packages/ai` cannot depend on `apps/web`). If the
   application doesn't exist or isn't owned by the caller: `application_not_found`. If
   `actionAssistanceFor(nextAction.type) !== 'FOLLOW_UP_DRAFT'`: `action_not_current` — this is the
   server recomputing/validating the decision itself; the client never gets to assert an
   `actionType` and have it trusted.
2. **Rate limit** (`incrementOwnAiRequestUsage`) — only now, after the free eligibility check
   passes. This ordering deliberately differs from the Phase 5A/5B pipelines (which rate-limit
   first): a structurally ineligible request was never going to produce a result, so it should
   never cost the user's quota either.
3. **Retrieval** — `application.company/title/status/appliedAt` (already trusted, on the row);
   `getOwnJobSnapshot` if `jobSnapshotId` is set; the most recent `CONFIRMED`/`AUTO_APPLIED` (never
   `PENDING`/`DECLINED`) email signal for this application via `listOwnEmailSignalsForApplication`
   — sender/subject/classification/receivedAt only, never a body (this codebase never stores email
   bodies at all); `getOwnProfile` for a `fullName` to sign with.
4. **One Claude attempt, validate, at most one retry on rejection** — `callClaudeForFollowUpDraft`
   (`packages/ai/src/claude/call-claude.ts`), `validateFollowUpDraftContract`
   (`packages/ai/src/contract/validate-follow-up-draft-contract.ts`).
5. **Telemetry** — `recordAiUsageEvent` with `taskType: 'follow_up_draft'`, best-effort (never
   fails the request if the insert itself throws).
6. **Server-computed `usedContext`** — a closed set of tags (`APPLICATION_STATUS`,
   `APPLICATION_DATE`, `FOLLOW_UP_TIMING`, `JOB_SNAPSHOT`, `CONFIRMED_EMPLOYER_EMAIL`,
   `CANDIDATE_NAME`) reflecting exactly what was actually retrieved above — never a model claim
   about what it used. This is a deliberate departure from the phase brief's illustrative
   `{ groundingNotes, usedContext }` model-output schema: a model-written "grounding note" is free
   text and could itself fabricate a source ("grounded in your call with the recruiter"), exactly
   the invention risk this phase's own hard rule (5C.3M) exists to prevent. This codebase's
   established pattern is that provenance is always server-derived, never model-generated (see
   `matchedFactProvenanceSchema`'s own doc comment) — the model here is only ever asked for
   `{ subject, body }`.

**Preventing a fabricated interaction.** The model is never given a recruiter name, contact email,
referral relationship, interview date, or prior conversation to work with — there is nothing in
this schema to invent from in the first place. On top of that, the system prompt explicitly lists
the disallowed claim shapes, and `validateFollowUpDraftContract` scans the generated body against a
fixed denylist of fabrication-risk phrases (`spoke with`, `referred by`, `our interview`,
`completed the assessment`, etc. — `packages/ai/src/contract/validate-follow-up-draft-contract.ts`)
and rejects (with one retry) any match. This is sound specifically because drafting is only ever
eligible while the deterministic action is `CONSIDER_FOLLOW_UP` — i.e. status is `APPLIED`/
`APPLICATION_RECEIVED`, strictly before any interview/assessment stage — so a claim like "after our
interview" is self-contradictory by construction, not merely unverifiable.

**No recipient field, no send.** The output contract has no `to`/recipient field at all — the UI
never claims to know an email address to send to. There is no send action anywhere in this feature;
Gmail integration in this codebase remains read/sync-only (`gmail.readonly`), and this phase adds
no new scope. The draft is copy/editable text only.

### 5C.3B — Interview preparation

`packages/ai/src/generate-interview-prep.ts` (`generateInterviewPrep`), called from
`POST /api/applications/:id/interview-prep`. Same eligibility-gate-before-rate-limit shape as
5C.3A, checking `actionAssistanceFor(nextAction.type) === 'INTERVIEW_PREP'`. If the application has
no `jobSnapshotId`, or the snapshot lookup fails: `insufficient_context` (before rate limiting) —
there is nothing role-specific to prepare from at all.

**Reuses Phase 5A's grounding architecture directly**, never a loose free-text call:
- If a `CURRENT` requirement-mapping run exists for the snapshot (`getCurrentOwnRequirementMappingRun`
  + `listCurrentOwnRequirementMappings`), its real mapping ids and matched-fact ids become the
  allowlist for `sourceRequirementId(s)`/`sourceFactIds`. If none exists, the prompt is told so
  explicitly and instructed to derive `rolePriorities`/`gapsToPrepare` directly from the job
  snapshot's own qualification/responsibility lists instead, with every requirement id left
  null/empty — **this pipeline never triggers requirement-mapping generation itself**, silently or
  otherwise; reusing an existing analysis is the only thing "reuse" means here.
- `listOwnApprovedFactsForGeneration` — the same retrieval every other pipeline in this package
  uses. No approved facts at all degrades gracefully (empty `evidenceToEmphasize`/
  `starStoryPrompts`, not a hard stop) — only a missing job snapshot blocks the request entirely.
- If `application.submissionPacketId` is set, `getOwnSubmissionPacketByApplicationId`'s immutable
  `answersSnapshot` becomes `submittedAnswersToReview` — read-only, truncated for prompt size, and
  entirely server-assembled (never sent through the model at all as an output field the model could
  alter) — "be prepared to discuss the answer you gave about X." Never fetched when there's no
  packet; never reconstructed from current profile data if one is missing.

**Structured contract**: `rolePriorities`, `evidenceToEmphasize`, `starStoryPrompts`,
`possibleQuestions`, `questionsToAsk`, `gapsToPrepare` — see
`packages/shared/src/schemas/action-assistance.ts` for the full per-field shape.
`validateInterviewPrepContract` (`packages/ai/src/contract/validate-interview-prep-contract.ts`)
rejects (with one retry) any `sourceFactIds` entry outside the offered fact ids or any
`sourceRequirementId`/`sourceRequirementIds` entry outside the offered mapping ids — including the
case where no mapping section was offered at all, so every id must then be null/empty. The system
prompt explicitly forbids "they will ask you..." / "this company's interview includes N rounds" /
any claimed real interview fact, and instructs "likely area to prepare based on the role
requirements" phrasing instead — the UI's copy matches this (see 5C.3F/5C.3G below).
`usedCurrentRequirementMapping` and `provenanceSummary` (e.g. "Based on 6 job requirements and 8
approved profile facts.") are entirely server-computed, same "provenance is never a model claim"
posture as the follow-up pipeline's `usedContext`.

### 5C.3C — Architecture / API design

Both routes (`apps/web/app/api/applications/[id]/follow-up-draft/route.ts`,
`.../interview-prep/route.ts`) follow the exact shape every existing `app/api` route in this
codebase uses: `getCurrentUser()` for the session-derived userId (never client-supplied),
`createAdminClient()` for DB access (every query underneath still explicitly filters by that
userId — RLS is the backstop, not the only check, per CLAUDE.md), no request body at all — the
only input is the application id already in the URL. A not-owned or nonexistent application id
produces the identical `application_not_found`/404 response, so this route can never be used to
probe for another user's application. Status mapping: `ok` → 200 with the result; `action_not_current`
→ 200 with the current action type (a legitimate, expected outcome, not an error); `insufficient_context`
(interview prep only) → 200; `rate_limited` → 429 with usage; `provider_error`/`validation_failed`
→ 502; `application_not_found` → 404; no session → 401.

### 5C.3D — Model routing

No new routing infrastructure was introduced. Confirmed by inspection
(`packages/ai/src/claude/client.ts`, `config.ts`) that this codebase has exactly one provider
(Anthropic) and one model constant (`MODEL_ID = 'claude-sonnet-5'`), used by every existing
pipeline — `ai_usage_events.provider`/`ladder`'s multi-provider shape is forward-looking groundwork
(migration 0005's own comment), never a live routing system. Introducing a second, cheaper model
for follow-up drafting alone would be new routing infrastructure this repo doesn't have anywhere
else — inconsistent with "reuse existing AI infrastructure," not an application of it. Both new
pipelines reuse `MODEL_ID`; the actual cost lever applied is `max_tokens`:
`FOLLOW_UP_DRAFT_MAX_OUTPUT_TOKENS = 1024` (short single-object output) vs.
`INTERVIEW_PREP_MAX_OUTPUT_TOKENS = 8192` (a larger multi-section synthesis, closer to the
requirement-mapping pipeline's own budget).

### 5C.3E — Persistence

Neither pipeline persists anything beyond the existing `ai_usage_events` telemetry row — same
ephemeral posture as `generate-unsupported-claims-check.ts` (Phase 5B.3). No new table, no
run-lifecycle table. Rationale: a follow-up draft is cheaply regenerable and has no reason to
survive a page reload; an interview-prep result is somewhat more expensive to regenerate but
persisting it would require tracking staleness against job-snapshot/requirement-mapping/
candidate-fact changes (per this phase's own explicit concern) for a v1 feature whose value is
"help me think, right now" — ephemeral was judged sufficient and is explicitly the accepted
simpler option, not a shortcut taken under pressure.

### 5C.3F — Follow-up UI

`apps/web/app/(app)/applications/follow-up-draft-panel.tsx`, rendered on the application detail
page only when the page's own server-computed `nextAction.type === 'CONSIDER_FOLLOW_UP'`
(`apps/web/app/(app)/applications/[id]/page.tsx` — this is a UX nicety only; the route
independently re-derives and re-verifies eligibility regardless of what the page showed). No fetch
of any kind on mount — the only network call is the POST triggered by clicking "Draft follow-up" (or
"Regenerate"). On success: an editable subject/body, a "Copy" button (`navigator.clipboard.writeText`),
a clear "AI-generated draft — review and edit... Career OS never sends this for you" label, and the
provenance line rendered from `usedContext`. **No send button exists anywhere in this component.**
The page also always renders `formatNextAction(nextAction).reason` above these panels (e.g. "You
applied 8 days ago and Career OS has not recorded a newer application-status update since") — the
deterministic reason is never hidden behind or replaced by the AI assistance layered on top of it.

### 5C.3G — Interview-prep UI

`apps/web/app/(app)/applications/interview-prep-panel.tsx`, same posture: shown only when
`nextAction.type === 'PREPARE_INTERVIEW'`, no fetch on mount, one POST per explicit "Generate
interview prep"/"Regenerate" click. Renders one grouped section per non-empty array in the result
(an empty section is omitted entirely, never rendered as an empty heading) — Role priorities, What
to emphasize, STAR stories to prepare, Potential questions to prepare for (renamed from "Possible
questions" in the Phase 5C.4 copy pass — see that section below), Questions to ask, Gaps to
prepare, Answers you already submitted — plus the short `provenanceSummary` line rather than raw
ids. Since
the result is ephemeral, a page refresh simply loses it — there is no "stale persisted result" case
to handle in this UI, by construction.

### 5C.3H — Extension scope

No extension changes were made. The extension popup's limited space and existing
`activeTab`/`scripting`/`storage`-only permission set (CLAUDE.md) make a full AI-assistance UI a
poor fit there; a deep-link from the popup into the web app's application detail page was
considered but judged unnecessary complexity for a v1 feature whose primary surface is already the
web dashboard/application detail page — left as a future polish item, not implemented, per the
phase brief's own "do not force it" guidance. No new extension permission of any kind was added.

### 5C.3I — Job-context summarization

No standalone "summarize this job" feature was added. Interview prep's own job-snapshot section
(role priorities, likely themes, gaps) already serves this need as part of an explicit,
user-triggered generation — never a separate automatic per-job-page AI call.

### 5C.3J — Prompt-injection defense

Both system prompts (`build-follow-up-draft-system-prompt.ts`, `build-interview-prep-system-prompt.ts`)
follow the exact tagged-content convention every existing prompt in this package already uses:
content inside `<application_context>`/`<job_snapshot>`/`<confirmed_employer_email>`/
`<candidate_facts>`/`<requirement_mappings>`/`<submitted_answers>` is explicitly DATA, not
instructions; the model is told to ignore any embedded instructions, requests to reveal the system
prompt, claims of being from Anthropic/a developer, or requests to change output format/behavior.
Both Claude calls (`callClaudeForFollowUpDraft`, `callClaudeForInterviewPrep`) have no `tools`
array and `thinking: { type: 'disabled' }` — the same "nothing for injected text to invoke, and no
adaptive reasoning to route around the instructions" posture as every other call in this file.

### 5C.3K — Grounding validation

`validateFollowUpDraftContract` and `validateInterviewPrepContract` both: (1) parse and Zod-validate
the raw response; (2) for interview prep, check every `sourceFactIds`/`sourceRequirementId(s)` entry
against the exact ids placed in that specific prompt (never a global "any real id" check) — an
invalid id is rejected, with one retry, matching the existing `validateRequirementMappingContract`/
`validateUnsupportedClaimContract` convention exactly. Follow-up drafting has no id-citation
mechanism at all (the model is never given ids to cite), so its equivalent gate is the
fabrication-phrase denylist described in 5C.3A.

### 5C.3L — Failure behavior

Every failure mode returns a structured status rather than a generic 500 where avoidable:
`application_not_found` (404), `action_not_current` (200 — an expected outcome, not an error),
`insufficient_context` (200, interview prep only), `rate_limited` (429 with usage),
`provider_error`/`validation_failed` (502). In every case the application's own status, priority,
and deterministic next action are completely unaffected — nothing in either pipeline ever calls
`changeOwnApplicationStatus`/`markOwnApplicationApplied` or writes to `applications` at all. Both
panels degrade to a plain error/status message with the rest of the page (status controls, notes,
timeline, mark-applied flow) fully usable regardless.

### 5C.3M — No user-fact invention (verification)

Covered in depth in 5C.3A (follow-up) and 5C.3B (interview prep) above. Summary: neither pipeline
is ever given a fact to invent from — no recruiter/contact name, no referral relationship, no
interview date, no assessment deadline is ever placed in a prompt (none exists anywhere in this
schema to place), and interview prep's evidence/story suggestions are always tied to a real,
allowlist-validated fact id, never free-standing invented content. Where evidence is missing, the
contract produces a "gap to prepare" entry, never a fabricated answer.

### 5C.3N — Tests

- `packages/shared/src/schemas/action-assistance.test.ts` — `actionAssistanceFor` mapping,
  including "every other `NextActionType` maps to null."
- `packages/ai/src/contract/validate-follow-up-draft-contract.test.ts` — schema validity,
  fabrication-phrase rejection (one case per denylist category), case-insensitivity.
- `packages/ai/src/contract/validate-interview-prep-contract.test.ts` — schema validity, every
  citation-allowlist rejection path (fact ids in two different field shapes, requirement ids in
  three different field shapes, including the "no mapping offered at all" case).
- `packages/ai/src/generate-follow-up-draft.test.ts` — eligibility gate (not found, wrong action
  type, below threshold, a later status-change event making it no-longer-current), rate limit,
  success + server-computed `usedContext`, confirmed-vs-pending email-signal exclusion,
  fabrication-rejection + retry, malformed-JSON retry, refusal retry, provider-error no-retry,
  telemetry recording + never-fails-on-telemetry-throw.
- `packages/ai/src/generate-interview-prep.test.ts` — eligibility gate (not found, wrong action
  type, no snapshot), rate limit, never-triggers-mapping-generation, safe degrade with/without a
  current mapping, graceful reduced result with zero facts, frozen-answer inclusion only when a
  packet exists, citation-allowlist rejection + retry (including the empty-allowlist case),
  malformed-JSON retry, provider-error no-retry, telemetry recording.
- `packages/database/src/queries/application-events.test.ts` — the new
  `listOwnRelevantStatusChangeEventsForApplication` scoped query (same two exclusions as the bulk
  query, no safety-cap `.limit()` needed at this scope).
- `apps/web/app/api/applications/[id]/follow-up-draft/route.test.ts` and
  `.../interview-prep/route.test.ts` — 401 unauthenticated, no-body/no-trusted-`actionType`
  input, every result-status → HTTP-status mapping, 404 on not-found/not-owned.
- `apps/web/app/(app)/applications/follow-up-draft-panel.test.tsx` and
  `interview-prep-panel.test.tsx` — no fetch on render, fetch fires only from the explicit button
  click, loading/success/error/rate-limit/action-not-current states, copy-to-clipboard, no send
  button, per-section conditional rendering (interview prep), never a "they will ask" claim
  surfaced in the DOM.

**Cost/auto-run regression review** (explicitly performed, not just asserted): a repo-wide search
for every reference to `follow-up-draft`/`interview-prep` and to `generateFollowUpDraft`/
`generateInterviewPrep` found exactly the two panel components' `onClick`-bound `generate()`
callbacks and the two routes/pipelines/their own tests/exports — no `useEffect`, no dashboard data
loader, no `deriveNextAction`/query-layer code path, no Gmail sync step, and no extension code path
references either new endpoint or pipeline function anywhere in this repository.

### 5C.3O — Security / privacy review

- Every new query call filters by the session-derived `user_id` (all pre-existing, already-audited
  query functions — no new query function was added except the scoped
  `listOwnRelevantStatusChangeEventsForApplication`, which follows the identical pattern).
  Ownership of a not-owned/nonexistent application is never distinguishable from either route's
  response.
- No client-supplied `user_id` anywhere; both routes derive it exclusively from `getCurrentUser()`.
- No public route: both require a session.
- No new logging was added anywhere in either pipeline — no `console.log` of prompt content, facts,
  answers, or model output exists in any new file (verified by search). `ai_usage_events` stores
  only the same metadata shape every existing task type already stores (provider, model, token
  counts, outcome, timing) — never prompt/response content.
- `ai_usage_events.task_type` was widened (migration 0016) to add `'follow_up_draft'` and
  `'interview_prep'`, preserving every existing value (`field_suggestion`, `requirement_mapping`,
  `email_classification`, `unsupported_claim_check`) — verified against migration 0014's own
  widening and against the current `aiUsageEventTaskTypeSchema` before writing the migration, per
  the explicit caution that a CHECK-widening migration must never accidentally drop an existing
  value.
- Gmail scope was not touched or widened in any way — no file under `apps/web/app/api/gmail/` or
  `apps/web/lib/gmail-oauth-config.ts` was modified in this phase. No email body is ever read or
  stored by either new pipeline — only the existing `email_signals` metadata columns.
- No submission-packet content beyond the specific fields surfaced as `submittedAnswersToReview`
  (label + truncated answer text) ever leaves `generate-interview-prep.ts` — the full packet object
  is never passed to the prompt builder or returned to the client.

### 5C.3P — Cost review

Follow-up draft: at most 2 provider calls (one attempt + at most one retry on rejection only; a
hard `provider_error` never retries). Interview prep: same, at most 2 calls. Neither pipeline is
ever called automatically — confirmed by the regression review above; every call is gated by an
explicit user click *and* the rate limit (`incrementOwnAiRequestUsage`), which is the same shared
per-user quota every other pipeline in this codebase already uses — no new quota dimension was
added. No dollar-cost figures are stated here since no per-token pricing table exists anywhere in
this repo's docs to cite honestly.

### 5C.3Q — `COMPLETE_APPLICATION` priority — re-reviewed, still unchanged

Re-examined as requested, not touched. The tension flagged in the "Phase 5C hardening — follow-up
anchor" section stands as previously described: `COMPLETE_APPLICATION` is `LOW` priority, so it
never appears in "Attention needed" or the header's count, showing only as a bare number inside the
"Preparing" pipeline-overview bucket. Nothing about adding AI action-assistance changes this
analysis — this phase added no AI feature for `COMPLETE_APPLICATION`/`MARK_APPLIED` at all
(deliberately: 5C.3's scope is only `CONSIDER_FOLLOW_UP`/`PREPARE_INTERVIEW`), so there is no new
information bearing on the decision. Left exactly as flagged before, for a deliberate product
decision later, not folded into this AI-focused pass.

### Files changed (Phase 5C.3)

- `packages/shared/src/schemas/action-assistance.ts` (+test) — `ActionAssistanceType`,
  `actionAssistanceFor`, both pipelines' model/result contracts.
- `packages/shared/src/schemas/ai-usage-event.ts` — widened `aiUsageEventTaskTypeSchema`.
- `packages/shared/src/index.ts` — barrel export for the new schema module.
- `supabase/migrations/0016_ai_usage_events_action_assistance.sql` — additive `task_type` CHECK
  widening, preserving every existing value.
- `packages/database/src/queries/application-events.ts` (+test) —
  `listOwnRelevantStatusChangeEventsForApplication`.
- `packages/ai/src/derive-eligible-next-action.ts` — shared eligibility re-derivation.
- `packages/ai/src/generate-follow-up-draft.ts` (+test), `generate-interview-prep.ts` (+test).
- `packages/ai/src/contract/validate-follow-up-draft-contract.ts` (+test),
  `validate-interview-prep-contract.ts` (+test).
- `packages/ai/src/prompt/build-follow-up-draft-{system,user}-prompt.ts`,
  `build-interview-prep-{system,user}-prompt.ts`.
- `packages/ai/src/claude/call-claude.ts` — `callClaudeForFollowUpDraft`, `callClaudeForInterviewPrep`.
- `packages/ai/src/config.ts` — new caps/prompt-version constants for both pipelines.
- `packages/ai/src/index.ts` — new public exports.
- `apps/web/app/api/applications/[id]/follow-up-draft/route.ts` (+test),
  `.../interview-prep/route.ts` (+test).
- `apps/web/app/(app)/applications/follow-up-draft-panel.tsx` (+test),
  `interview-prep-panel.tsx` (+test).
- `apps/web/app/(app)/applications/[id]/page.tsx` — wires in both panels + the always-shown
  deterministic reason line.

### Tests (Phase 5C.3)

`packages/shared`: 198 tests (+3). `packages/database`: 88 tests (+2). `packages/ai`: 172 tests
(+54: 14 follow-up-draft pipeline, 15 interview-prep pipeline, 15 follow-up-draft contract, 10
interview-prep contract). `apps/web`: 180 tests (+36: 8 follow-up-draft route, 9 interview-prep
route, 10 follow-up-draft panel, 9 interview-prep panel). `packages/extension`: 125 tests
(unaffected). `packages/email`: 19 tests (unaffected). Typecheck clean across all seven workspaces
(`shared`/`database`/`ai`/`web`/`extension`/`email`/`ui`); `next lint` and the extension's `eslint`
both zero warnings; Prettier clean; `git diff --check` clean (only pre-existing LF/CRLF advisory
warnings, no real whitespace errors).

### Explicitly excluded from this pass

Assessment prep, offer review, and rejection reflection (mentioned as possible future
`ActionAssistanceType` values in the phase brief) — not implemented; only `FOLLOW_UP_DRAFT` and
`INTERVIEW_PREP` were judged useful v1 actions. No Gmail send integration or scope widening. No
dashboard redesign. No change to `MARK_APPLIED`/`COMPLETE_APPLICATION` priority. No extension UI.
No persistence beyond `ai_usage_events` telemetry.

## Phase 5C.4 — Product polish and phase closure

A deliberately non-feature pass: no new AI capability, no deterministic-engine redesign, no next
major phase started. Its job was to make the already-implemented 5C.1–5C.3 line feel coherent and
production-ready — closing the one documented product tension, tightening the dashboard→detail
handoff, polishing AI-assistance copy/UX, adding a small extension→web handoff, fixing a real
dashboard-noise bug, and auditing the whole line end to end for safety/performance/accessibility
regressions. No schema change; no migration was needed or made.

### 1. `COMPLETE_APPLICATION` / Attention UX — decision

The tension was real, not imagined: `COMPLETE_APPLICATION` (`LOW` priority, by design) never
appeared in "Attention needed," so a user with several `SAVED` applications and nothing
URGENT/HIGH/MEDIUM pending saw "Nothing needs attention right now" with no visible next step for
any of them.

**Option A (promote to `MEDIUM`) was rejected.** Starting or finishing a draft application has no
real, employer-imposed deadline — nothing supports treating it as equally pressing as an explicit
employer ask (`REVIEW_ACTION_REQUIRED`) or a live offer decision (`REVIEW_OFFER`). Inflating it
into "Attention needed" would have made that section's own meaning less trustworthy over time.

**Option B (a separate, clearly-labeled section) was chosen.** A new `needsToFinish` predicate
(`apps/web/lib/dashboard.ts`) — `nextAction.type === 'COMPLETE_APPLICATION'`, nothing else — powers
a new "Applications to finish" dashboard section, positioned right after "Attention needed" and
before "Follow-up suggestions." This exactly mirrors the existing pattern "Follow-up suggestions"
already established for `CONSIDER_FOLLOW_UP` (also `LOW`, also excluded from `needsAttention`, also
given its own visible home) — not a new architecture, an application of the one already there.
`needsAttention` itself is completely untouched. The header copy was also adjusted: when nothing
URGENT/HIGH/MEDIUM is pending but at least one application needs finishing, it now says "Nothing
urgent right now, but N application(s) could use finishing" instead of flatly "Nothing needs
attention right now" — accurate either way, and no longer reads as a contradiction of the section
sitting right below it.

Requirements re-verified: follow-up suggestions still never appear in "Attention needed" merely for
being `LOW` (unchanged); `NO_ACTION` is excluded from both `needsAttention` and `needsToFinish`
(neither predicate matches it); an ordinary `SAVED` application with `COMPLETE_APPLICATION` now has
a visible, correctly-labeled home instead of disappearing; priority semantics are unchanged —
nothing was inflated into MEDIUM/HIGH. Tests: `apps/web/lib/dashboard.test.ts`'s new `needsToFinish`
describe block (disjointness from `needsAttention`, exclusion of every other next-action type).

### 2. Dashboard → application-detail action handoff

Every dashboard/table row linking to an application now points at the specific panel its next
action is about, using a plain HTML fragment — never a query parameter, never anything the server
has to interpret as an eligibility hint:

- `apps/web/app/(app)/applications/[id]/page.tsx` gives the follow-up-draft panel, interview-prep
  panel, and the "Mark applied" section stable `id` attributes (`follow-up-draft-panel`,
  `interview-prep-panel`, `mark-applied-panel`).
- `apps/web/app/(app)/dashboard/application-action-row.tsx` exports `ACTION_TYPE_TO_PANEL_ID`, the
  one place mapping `NextActionType` → panel id (`CONSIDER_FOLLOW_UP`, `PREPARE_INTERVIEW`,
  `MARK_APPLIED` only), and appends `#<panelId>` to its link when one exists.
  `apps/web/app/(app)/applications/page.tsx`'s table reuses the same exported map for its "Next
  action" cell.
- `REVIEW_UNRESOLVED_FIELDS` and `COMPLETE_APPLICATION` are deliberately left unmapped (plain link
  to the page top) rather than pointed at something that doesn't exist: unresolved-field review's
  real UI lives in the extension popup, not this page, and there is no dedicated
  "start this application" panel to jump to. Documented here as deferred, not hacked around.

Why this is safe: the server has already independently decided whether to render each panel *at
all* before a fragment could ever matter (the same `nextAction` the page computes for its own
"show FollowUpDraftPanel?" check). A browser fragment can only ever scroll to something that
already exists on the page for a reason the server already verified; it cannot make a panel appear
that shouldn't be there, and clicking either panel's own generate button still re-triggers that
panel's own API route, which independently re-derives eligibility again from the database — the
fragment never bypasses that check, it only saves a scroll.

### 3. AI-assistance UX polish

Follow-up draft (`follow-up-draft-panel.tsx`): the deterministic reason is shown once, above the
panel, by the page itself (unchanged from 5C.3F) — this pass added `aria-busy` on the
generate/regenerate button, reset the "Copied" confirmation back to "Copy" the moment the draft is
edited afterward (a stale "Copied" label would misdescribe what's actually on the clipboard), and
replaced the plain "refresh the page" sentence in the stale-action (`action_not_current`) state
with an actual **"Reload this page"** button (`router.refresh()`) so recovering from a stale tab is
one click, not a manual browser action.

Interview prep (`interview-prep-panel.tsx`): same `aria-busy` and "Reload this page" additions for
its own `action_not_current` state. The "Possible questions" section heading was renamed to
**"Potential questions to prepare for"** (§8 below) — a wording fix, not a data-shape change.
Every other section heading was reviewed and already avoided overclaiming (see §8).

Neither panel needed a broader redesign — the existing hierarchy (grouped sections, provenance
line, human-readable "Based on N job requirements and M approved facts," no raw ids anywhere in
the UI) already matched what this phase asked for; confirmed by direct review against the phase
brief's checklist (role priorities / evidence to emphasize / STAR prompts / possible questions /
questions to ask / gaps to prepare / submitted answers / provenance summary — all present, all
human-readable, no `sourceFactIds`/requirement ids/raw JSON exposed as primary UX).

### 4. Extension → web handoff

The extension already had a "View in Dashboard" link (`ApplicationTracker.tsx`) pointing at
`${API_BASE_URL}/applications/${applicationId}` — the exact application id the extension tracks
*is* the web app's own `applications.id`, so this handoff was already reliable with no mapping
step needed. This pass polished it into the lightweight, action-aware CTA the phase brief asked
for: renamed to **"Open in Career OS"** (generic) or a status-specific hint
(`openInCareerOsLabel`, `apps/extension/src/popup/lib/open-in-career-os-label.ts`) for exactly
the four statuses whose action is fully determined by status alone —
`ACTION_REQUIRED`/`ASSESSMENT`/`INTERVIEW`/`OFFER` — e.g. "Open Career OS to prepare for the
interview."

**Deliberately not extended to `APPLIED`/`APPLICATION_RECEIVED`** ("Open Career OS to draft a
follow-up," one of the phase brief's own example CTAs): whether follow-up is currently suggested
also depends on `appliedAt` and the follow-up anchor/threshold
(`packages/shared/src/lib/next-action-rules.ts`), none of which this popup has — approximating
that logic in the extension, even coarsely, would have been exactly the "duplication of
next-action logic" the phase brief said to avoid where avoidable. A generic label for those two
statuses was judged the correct, honest choice over a guess.

No new browser permission, no AI call in the extension, no next-action re-derivation beyond the
already-available `trackedStatus` field, no background/startup call of any kind — the web app
remains fully authoritative regardless of what this label says. Test:
`apps/extension/src/popup/lib/open-in-career-os-label.test.ts` (`openInCareerOsLabel`'s mapping,
including the explicit assertion that `APPLIED`/`APPLICATION_RECEIVED` never mention "follow-up").

### 5. Real AI smoke verification — outstanding

`ANTHROPIC_API_KEY` is not configured in this environment (checked `process.env` and every
`.env*` file — only `.env.example` exists). Per instruction, no credentials were manufactured and
no live call was attempted. **Manual live AI verification (one real follow-up generation, one
real interview-prep generation, against a naturally-eligible application) remains outstanding** —
this is the same status reported at the end of Phase 5C.3's own verification pass; nothing in this
phase changed that.

### 6. Action-assistance stale-state UX

Already correctly modeled before this pass (`action_not_current` status, both panels render a
plain explanatory message, never a crash, never a generated result for the wrong action) — this
pass's addition is purely the "Reload this page" button described in §3, so recovering is an
actual one-click action rather than a suggestion in prose. Tests updated/added in both panels'
test files to click the new button and assert `router.refresh()` was called.

### 7/8. Follow-up and interview-prep copy quality — reviewed

Searched the entire touched surface (UI copy, prompts, docs) for "overdue," "hasn't responded,"
"ignored you," "they will ask," and equivalent overconfident phrasing — none found anywhere.
Follow-up copy already said, and still says, "this is a recommendation, not a known employer
deadline" (`format-next-action.ts`, unchanged) and "Career OS never sends this for you"
(`follow-up-draft-panel.tsx`, unchanged). The one real wording fix this pass made: interview
prep's "Possible questions" section → **"Potential questions to prepare for"** (§3 above) — the
old heading, read on its own without the panel's disclaimer line, could be misread as a claim
about real interview content; the new one cannot. "Areas to prepare"/"Gaps to prepare" and every
other heading were already framed as preparation suggestions, never as predictions of what an
interviewer will actually do.

### 9. Recent-activity noise audit — real fix

Found a real bug, not just confirmed correct behavior: `toRecentActivity`
(`apps/web/lib/dashboard.ts`) excluded a *reverted* event (`revertedAt` set) but not the
`SYSTEM`-sourced bookkeeping event `revertApplicationEvent` itself creates to log the revert. Since
that logging event is never itself marked reverted, it would surface on the dashboard's "Recent
activity" feed looking exactly like an ordinary status transition (e.g. "INTERVIEW → APPLIED")
when nothing but a correction of an earlier mistake had actually happened — genuinely misleading,
not merely noisy. Fixed by adding the same `source === 'SYSTEM'` exclusion
`buildLastRelevantStatusActivityMap` already uses for the follow-up anchor, extended to this feed
for the identical reason. The application detail page's own timeline is unaffected and still shows
the complete, honest record (original event with its "(reverted)" tag, plus the revert-logging
event) — only the dashboard-level summary feed changed. No other noise source was found:
`ai_usage_events`, submission-packet creation, and AI draft/prep generation were never events at
all (nothing in either AI pipeline calls `recordApplicationEvent`), and `NOTE`/`MANUAL_EDIT`/
`EMAIL_MATCHED` event types were already excluded (unchanged from Phase 5C.2F). Tests: three new
cases in `dashboard.test.ts`'s `toRecentActivity` block, including a full Sep 1/Sep 11-style
end-to-end scenario asserting only the genuine original event ever surfaces.

### 10. Pipeline-overview audit — confirmed correct, strengthened with exhaustive coverage

All 11 `ApplicationStatus` values were already accounted for (`DASHBOARD_STAGE_GROUPS` covers 10
explicitly; `UNKNOWN` falls through `stageGroupForStatus`'s `?? 'OTHER'` fallback rather than
vanishing) — confirmed correct, not a bug. Added one new test that iterates the real
`APPLICATION_STATUSES` constant from `packages/shared` (rather than a hand-typed list that could
drift from the schema) and asserts every status resolves to a defined group, with exactly
`['UNKNOWN']` falling into `'OTHER'` — so a future status added to the enum without updating
`DASHBOARD_STAGE_GROUPS` now fails a test immediately instead of silently vanishing from the
pipeline overview.

### 11/12. Accessibility, responsive, and loading/error states

Reviewed the touched components against the phase brief's checklist. Fixes actually made (not a
redesign): `aria-busy` on both AI-assistance generate/regenerate buttons; `aria-live="polite"` on
the follow-up draft's Copy button so its label change is announced; the Copy-then-edit staleness
fix (§3); the stale-action "Reload this page" button (§3/§6) replacing a text-only instruction.
Confirmed already fine, no change needed: every interactive control in the touched components is a
native `<button>`/`<input>`/`<textarea>`/`<a>` (keyboard-operable by construction); subject/body
inputs already have `aria-label`s; disabled states use the shared `Button` component's existing
`disabled:opacity-50 disabled:pointer-events-none` styling, which is visually and semantically
clear; the dashboard's pipeline-overview grid (`grid sm:grid-cols-5`) already stacks to one column
below the `sm` breakpoint rather than squeezing five columns onto a phone width; row/card text
wrappers already use `min-w-0` so a long company/title string wraps instead of overflowing.
Error messages throughout (rate limit, provider error, insufficient context, stale action) were
already user-readable prose, never a raw response body, stack trace, or DB error string — confirmed
by re-reading every error branch in both AI-assistance routes and panels; no change needed.

### 13. Performance/query audit

Found and fixed one real regression: the application detail page
(`apps/web/app/(app)/applications/[id]/page.tsx`) fetched its timeline events, job snapshot, and
relevant status-change events **serially** (three sequential `await`s) even though only the job
snapshot read depends on anything from the first read (`application.jobSnapshotId`, already known
immediately after the first query). Changed to a single `Promise.all([...])` for those three
independent reads — same total query count, strictly less latency, no behavior change. Everywhere
else already correct: the dashboard's three top-level queries were already parallelized (Phase
5C.2H, unchanged); `attachNextActions`/`buildLastRelevantStatusActivityMap` are still one bulk
query, never one per application; neither AI-assistance pipeline introduced a duplicate read (each
retrieval call in `generate-follow-up-draft.ts`/`generate-interview-prep.ts` fetches something the
other doesn't). No caching of derived `NextAction` state was added anywhere — every page still
recomputes it fresh from the database on every render, exactly as before; this phase did not
introduce any staleness risk by trying to memoize it.

### 14. AI auto-run audit — re-confirmed clean

Repeated the repo-wide search for `follow-up-draft`/`interview-prep`/`generateFollowUpDraft`/
`generateInterviewPrep`: still exactly the two panels' own `onClick`-bound `generate()` callbacks,
the two routes, the two pipelines, and their own tests/exports/docs — no new call site was added by
this polish pass. No `useEffect`, no dashboard/application loader call, no Gmail sync call, no
extension startup call, no background timer, anywhere.

### 15. Gmail/OAuth scope audit — unchanged

No file under `apps/web/app/api/gmail/` or `apps/web/lib/gmail-oauth-config.ts` was touched by this
phase. No `gmail.send`/`gmail.compose`/`gmail.modify` scope exists anywhere in this codebase (the
extension handoff link in §4 only ever opens a new browser tab to the Career OS web app itself,
never a Gmail URL, and requests no permission at all to do so). Follow-up drafts remain
editable/copyable/manually-used only; no auto-send, no silent Gmail draft creation.

### 16. Application-state mutation safety — strengthened

The guarantee ("AI assistance can never mutate `applications`/`application_events`/
`submission_packets`") was previously only implicit (an unmocked database export would throw if
called). This pass made it an explicit regression test in both
`generate-follow-up-draft.test.ts` and `generate-interview-prep.test.ts`: every mutating query
function this repo has for those tables (`changeOwnApplicationStatus`,
`markApplicationAppliedAtomic`, `recordApplicationEvent`, `revertApplicationEvent`,
`updateOwnApplication`) is now explicitly stubbed and asserted `not.toHaveBeenCalled()`, on both
the success path and a rejected/retried path — so a future change that starts calling one of them
fails a named, specific test immediately instead of relying on an accidental `undefined()` crash to
notice.

### 17. Documentation closure

This section. Also updated: `docs/USER_FLOWS.md` (the "Applications to finish" section and the
handoff/copy wording), `docs/PRODUCT_SPEC.md` (the new dashboard section named), `docs/AI_GROUNDING.md`
(no grounding-mechanism change, so no edit needed there beyond what 5C.3 already documented — the
copy renaming is UI text, not a grounding claim), and `docs/EXTENSION_DESIGN.md` §7 (the enhanced
"Open in Career OS" link).

### Files changed (Phase 5C.4)

- `apps/web/lib/dashboard.ts` (+test) — `needsToFinish`; `toRecentActivity`'s `SYSTEM`-source fix;
  doc-comment updates.
- `apps/web/app/(app)/dashboard/page.tsx` — "Applications to finish" section; header copy.
- `apps/web/app/(app)/dashboard/application-action-row.tsx` — exported `ACTION_TYPE_TO_PANEL_ID`;
  hash-fragment links.
- `apps/web/app/(app)/applications/page.tsx` — "Next action" cell links to the right panel.
- `apps/web/app/(app)/applications/[id]/page.tsx` — panel `id` attributes; parallelized the three
  independent reads.
- `apps/web/app/(app)/applications/follow-up-draft-panel.tsx` (+test) — Reload button, `aria-busy`,
  Copy staleness fix, `aria-live`.
- `apps/web/app/(app)/applications/interview-prep-panel.tsx` (+test) — Reload button, `aria-busy`,
  "Potential questions to prepare for" rename.
- `apps/extension/src/popup/components/ApplicationTracker.tsx` — uses the label helper.
- `apps/extension/src/popup/lib/open-in-career-os-label.ts` (+test) — `openInCareerOsLabel`,
  in its own module (not inline in the component) so the component file keeps exporting only its
  component, matching this popup's react-refresh convention.
- `packages/ai/src/generate-follow-up-draft.test.ts`, `generate-interview-prep.test.ts` —
  application-state safety regression tests.
- `docs/IMPLEMENTATION_PLAN.md`, `docs/USER_FLOWS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/EXTENSION_DESIGN.md`.

### Tests (Phase 5C.4)

`apps/web`: +11 in `dashboard.test.ts` (`needsToFinish`, the `toRecentActivity` `SYSTEM`-exclusion
fix and end-to-end scenario, the exhaustive `stageGroupForStatus` audit), +2 in
`follow-up-draft-panel.test.tsx`, unchanged count but updated assertions in
`interview-prep-panel.test.tsx`. `packages/ai`: +4 (2 application-state safety tests per pipeline).
`apps/extension`: +1 new test file, 3 cases (`open-in-career-os-label.test.ts`). No test was removed;
every pre-existing test that referenced changed copy/behavior was updated to match, never simply
deleted to make the suite pass.

### No migration needed

Confirmed and re-confirmed: nothing in this phase required a schema change. `needsToFinish` and the
`toRecentActivity` fix are pure functions of already-fetched data; the dashboard/detail handoff is
client-side HTML fragments; the extension label is a pure string function of an already-available
field; the parallelized queries changed nothing about what's queried, only when.

### Deferred (explicitly, not silently)

- `REVIEW_UNRESOLVED_FIELDS`/`COMPLETE_APPLICATION` have no dedicated detail-page panel to deep-link
  to yet (§2) — a real future polish item if either ever gets one.
- Real live AI smoke verification (§5) — blocked purely on `ANTHROPIC_API_KEY` not being configured
  in this environment; not a code gap.
- `MARK_APPLIED`/`COMPLETE_APPLICATION` priority remains exactly as flagged in the first Phase 5C
  hardening pass and re-flagged in 5C.3Q — still a deliberate product decision for later, not
  folded into this pass (per explicit instruction not to blindly promote `COMPLETE_APPLICATION`).

### Phase closure checklist

Can the user: see what needs attention (Attention needed) — yes. See pipeline stage (Pipeline
overview, all 11 statuses accounted for) — yes. See recent meaningful activity (Recent activity,
now with the `SYSTEM`-bookkeeping fix) — yes. Know why a follow-up is suggested (the always-shown
deterministic reason line, both on the dashboard row and the detail page) — yes. Finish/find
incomplete applications (the new "Applications to finish" section) — yes, closing this pass's
primary gap. Mark applied through the safe Phase 5B gate — yes, unchanged. Draft a follow-up
explicitly — yes. Prepare for an interview explicitly — yes. Review immutable submitted information
— yes (`submittedAnswersToReview`, the submission-packet viewer). Understand when AI is being used
— yes (explicit buttons, "AI-generated" labels, no automatic calls anywhere, verified §14). Remain
in control of every outbound action — yes (no send capability exists anywhere; every AI output is
copy/edit-only). No materially "no" answer was found; Phase 5C is product-complete for v1.

## Phase 7A — Master résumé + immutable résumé versioning

Not the original roadmap's "Phase 7 — Multi-user beta hardening" entry above (still unstarted,
unrelated content) — this is a new initiative, following the same "Phase 5A/6A got its own
top-level as-built section" precedent as everything above.

### Pre-migration inspection

Repo-wide inspection (required before any schema design, per this phase's own instructions) found:

- `public.resumes` (migration 0001) is a table-only stub for a future "upload a résumé file, Claude
  extracts candidate facts" pipeline (docs/USER_FLOWS.md §1) — `file_path`, `file_name`, `label`,
  `is_primary`, `extraction_status`. It has **no writer anywhere in this codebase**: no route, no
  server action, no insert call site outside pgTAP fixtures inside rolled-back transactions.
- `applications.resume_id` (plain, non-composite FK to `resumes(id)`) and
  `submission_packets.resume_id` (composite FK to `resumes(user_id, id)`, migration 0013) both
  point at it and are both always null in practice — confirmed already in the Phase 5B.0/5B.1
  inspections, re-confirmed here.
- `candidate_facts.source_resume_id` also points at it (provenance for extracted facts), also
  unused today.

This is case **C** from the phase brief's A/B/C/D taxonomy — nullable and unused — not case A
(already an immutable version) or B (a live mutable "current résumé" concept the model could
repurpose). The uploaded-file/extraction concept is real and worth keeping, but is a *different*
concept from "logical résumé identity with tailored version history," so it was not repurposed —
see "The rename decision" below.

### The rename decision

`resumes` needed to become the name for the new logical-identity model (`name`/`kind`/lineage),
but the existing table already had that name for an unrelated concept. Since it has zero rows in
any real environment and a rename is a lossless, fully-automatic-FK-preserving operation in
PostgreSQL, migration 0020 renames it to `resume_uploads` (and every dependent
constraint/index/trigger/policy name, for clarity) rather than either conflating the two concepts
or leaving a confusingly-named second table. `applications.resume_id`,
`candidate_facts.source_resume_id`, and `submission_packets.resume_id` keep their exact historical
(always-null) meaning, now pointing at `resume_uploads` — no historical value is reinterpreted.

### Schema (migration 0020)

- **`resumes`** — logical identity: `id`, `user_id`, `name`, `kind` (`MASTER`/`TAILORED`),
  `parent_resume_id` (composite FK to itself, column-scoped `on delete set null`). A partial
  unique index (`user_id where kind = 'MASTER'`) enforces at most one MASTER per user — a single
  active MASTER is enough today; nothing in the current profile/candidate-facts model is
  per-discipline, so multiple simultaneous masters would just be indistinguishable duplicate
  starting points. A `resumes_master_has_no_parent` check and an
  `enforce_resume_parent_is_master` trigger keep lineage meaningful: a TAILORED resume's parent,
  when set, must be a MASTER owned by the same user — never another TAILORED resume, never
  cross-user.
- **`resume_versions`** — immutable snapshots (`reject_immutable_row_mutation`, the same trigger
  function 0010/0013 already defined). What a version snapshots *in this phase*: this repo has no
  structured résumé content, no LaTeX, and no wired uploaded-file/extraction pipeline yet, so
  fabricating a content shape just to fill a column would be dishonest. `snapshot_format` is a
  real, narrow enum with exactly one current member, `METADATA_ONLY` — a version's identity
  (`version_number`, `display_name`, `created_at`) is real and permanent; its document content
  does not exist yet. `snapshot_payload` stays null for every `METADATA_ONLY` row (database-
  enforced). This is still enough for Phase 7B's attachment/freeze semantics, which only need a
  version's *identity* to answer "which version was submitted" — never its content. A later phase
  (7C+) widens this same enum additively as real content formats actually exist.
- **`create_resume_version`** RPC — the one atomic, concurrency-safe version-creation path
  (`select ... for update` row-locks the parent `resumes` row, same pattern as
  `increment_ai_request_usage`/`mark_application_applied`; `unique(resume_id, version_number)` is
  the second, independent guarantee). `version_number` is always server-computed, never
  client-supplied. `security invoker`, granted only to `service_role` — `resume_versions` has no
  ordinary `authenticated` INSERT policy at all (same deviation as `job_snapshots`/
  `requirement_mapping_runs`), so every version is created through this RPC via the admin client
  from a Next.js server action, with `userId` derived from the verified session.
- **Deletion**: `resume_versions` *does* get an ordinary `authenticated` DELETE policy (unlike its
  withheld INSERT) — the actual invariant ("a version that was ever submitted must never be
  deletable") is enforced structurally by `submission_packets.resume_version_id`'s
  `on delete restrict` FK (migration 0021), not by withholding the UI entirely. Deleting a
  `resumes` row cascades to its own versions, which is itself blocked (the whole delete fails) if
  any of them was ever submitted — a resume with submitted history anywhere cannot be deleted.
  Deleting a MASTER resume `SET NULL`s its children's `parent_resume_id` (column-scoped, never
  `user_id`).

### Naming helper — a deliberate deviation from the literal brief

The phase brief's naming convention example was `"My Pham's Resume -- {Company} -- {Role}"` — "My
Pham" is this deployment's one real user's actual name. Baking a literal person's name into a
shared naming template would violate CLAUDE.md's multi-tenancy rule ("Never hardcode a user...
every feature is built as if a hundred strangers already use it"): every other Career OS user's
tailored résumés would end up literally labeled "My Pham's Resume -- ...". `buildTailoredResumeDisplayName`
(`packages/shared/src/lib/resume-naming.ts`) instead derives the owner's name from their own
`profiles.full_name`, falling back to the generic, non-identifying "My Resume" when unset — same
`"{owner} -- {Company} -- {Role}"` shape, honest for every user. `sanitizeResumeFileNameSegment`/
`buildResumeFileName` implement the filename sanitizer (strips `\ / : * ? " < > |` and control
characters only, preserves ordinary punctuation) for future PDF-generation phases to reuse.

### `/resumes` + `/resumes/[id]` UI

Minimal library UI, not a Resume Studio: list logical résumés (MASTER separated from TAILORED,
version counts via one batched query), create a MASTER if none exists, create a TAILORED résumé
manually, open a résumé's detail page (rename, version history with per-version "used as working
résumé by" / "submitted, locked" indicators via two batched queries, create a new version, delete a
version or the whole résumé with friendly FK-violation error messages). No LaTeX editor, no PDF
preview, no AI tailoring — all explicitly deferred to 7C+.

### Tests (Phase 7A)

`packages/shared`: +9 (`resume-naming.test.ts`, including an explicit "never bakes in a literal
hardcoded person name" assertion). `packages/database`: +8 (`resumes.test.ts`), +9
(`resume-versions.test.ts`). pgTAP: `0024_resumes.test.sql` (12 assertions),
`0025_resume_versions.test.sql` (10 assertions) — both run live against the linked Supabase
project, both pass. `0002_resumes.test.sql` renamed to `0002_resume_uploads.test.sql` and
retargeted at the renamed table (5/5, still passing).

## Phase 7B — Application ↔ résumé attachment + submitted-résumé freeze

### Working vs. submitted: why two direct columns, not a join table

An `application_resumes` join table (purpose `WORKING`/`SUBMITTED`) was considered and rejected: at
most one WORKING version and one SUBMITTED version can ever be true for a given application at a
given time, so a join table would only ever hold 0-2 rows per application — duplicating exactly the
two facts two direct columns already represent, with none of a join table's actual benefit
(multiple concurrent rows of the same kind). SUBMITTED in particular must never be a second,
independently-mutable record of history: `submission_packets` already *is* the canonical historical
submission record (Phase 5B.1); freezing the submitted résumé onto that existing immutable row
keeps "what did I submit" answerable from exactly one place.

- **`applications.working_resume_version_id`** — ordinarily mutable, exactly one per application,
  same shape/posture as `job_snapshot_id`/`submission_packet_id` (0010/0013). Composite FK to
  `resume_versions(user_id, id)`, column-scoped `on delete set null`. Cross-user selection is
  structurally impossible (the composite FK requires a `resume_versions` row with the *same*
  `user_id`), not merely checked in `setOwnApplicationWorkingResumeVersion`.
- **`submission_packets.resume_version_id`** — additive, alongside the pre-existing (always-null)
  legacy `resume_id`; never backfilled onto any existing packet. Composite FK,
  `on delete restrict` — the structural "a submitted version can never be deleted" guarantee.
- **`mark_application_applied`** (migration 0013) gained one new trailing parameter,
  `p_resume_version_id uuid default null` — `create or replace function` against an *added*
  parameter does not actually replace the old signature in PostgreSQL (confirmed against the live
  linked project: `ERROR: function name "public.mark_application_applied" is not unique`,
  SQLSTATE 42725, since a default value doesn't exempt an added parameter from PostgreSQL's
  "argument list must be identical" replace rule) — migration 0021 explicitly `drop`s 0013's exact
  original 11-parameter signature first. Behavior is otherwise byte-for-byte identical: first real
  transition into APPLIED freezes whatever `working_resume_version_id` pointed to at that instant
  (null if nothing was selected — never inferred/defaulted); the idempotent already-APPLIED branch
  accepts but ignores it, so a repeated call never swaps the frozen version even if the working
  version has since changed; `revertApplicationEvent`'s plain `status` UPDATE (the one accepted
  exception to "only `mark_application_applied` produces APPLIED") never touches
  `submission_packets` at all, so revert/restore never alters the frozen résumé version either.

### Application detail UX

A new "Resume" section (`resume-section.tsx`) shows the current working résumé version (or "No
resume selected"), a `<select>` of every one of the user's résumé versions across every résumé
(one batched query, grouped by résumé name) to select/change it, a "Clear" action, and "Create
resume for this application" (creates a TAILORED résumé named per the naming convention, an initial
`METADATA_ONLY` version, and immediately selects it as the working résumé — one click). The
existing `SubmissionPacketSection`'s "Résumé" subsection now distinguishes three honest states: an
exact submitted version (from `resumeVersionId`, showing its frozen version number/display name and
noting the working résumé may have since diverged — not an error), the legacy `resumeId` rendering
for a pre-0021 packet, or "Resume not recorded for this submission" when neither is set — never
collapsed into a single "not recorded" message that can't tell those apart.

### Tests (Phase 7B)

`packages/database`: `applications.test.ts` +5 (freeze on first APPLIED, freeze-null when nothing
selected, idempotent-path `resumeVersionId: null` assertion, `setOwnApplicationWorkingResumeVersion`/
`clearOwnApplicationWorkingResumeVersion`). `packages/shared`:
`submission-packet-fingerprint.test.ts` +1 (`resumeVersionId` participates in the fingerprint).
`apps/web`: `submission-packet-section.test.tsx` +3 (exact version, version no longer available,
legacy fallback), `dashboard.test.ts`/`matcher.test.ts` fixtures updated for the new
`Application.workingResumeVersionId` field. pgTAP: `0026_application_resume_attachment.test.sql`
(13 assertions, run live against the linked project) covers cross-user selection rejection (tested
as `service_role`, since `authenticated`'s own RLS would hide the target id and make the attempt a
false negative), first-freeze, working-version-changes-after-submit, idempotent repeat, direct
revert/restore, submitted-version deletion protection (both the version directly and transitively
via its parent resume), and legacy-packet compatibility. All pass.

### Explicitly deferred to 7C+

Structured résumé content, LaTeX generation/compilation, PDF storage (no Supabase Storage bucket
exists — none was created), AI tailoring, company research, a dashboard "résumé selected" badge.
None of this phase's schema needs to change to add any of them later.

## Phase 7C — Structured résumé content + deterministic LaTeX rendering

Full design record in `docs/RESUME_STUDIO.md`; this section is the as-built summary.

### Compilation architecture investigation

Before writing any renderer code: no Docker, no `pdflatex`/`xelatex`/`tectonic`/`latexmk` exist
anywhere in this repo or its dependencies; `docs/DEPLOYMENT.md` targets an ordinary Node
serverless/edge host (e.g. Vercel) with no apt-level installs, no persistent filesystem, and no
pre-existing isolated worker/service; no external compilation API is configured. Given that,
this phase implements the deterministic structured-content-to-LaTeX half of the pipeline
completely (real, tested, real templates) and explicitly defers LaTeX-to-PDF compilation — the
task's own option "F" — rather than standing up an unverifiable, potentially unsafe compilation
path blind. `docs/RESUME_STUDIO.md` §1 records the realistic future options (an isolated
Tectonic worker, a client-side WASM engine, or a reviewed external API) without picking one
sight-unseen.

### Schema (migration 0022)

Additive only — widens `resume_versions.snapshot_format` (Phase 7A: `METADATA_ONLY` only) to
also allow `STRUCTURED_V1`, and replaces the old one-directional "METADATA_ONLY implies null
payload" check with a format-aware, two-directional one (`STRUCTURED_V1` requires a non-null
JSON *object* payload — a shallow `jsonb_typeof` guard, independent of the real shape validation
Zod does in application code). No RPC signature change: `create_resume_version` already
accepted `p_snapshot_format`/`p_snapshot_payload` as parameters since Phase 7A — nothing was
hardcoded to `METADATA_ONLY`, that was simply the only value any caller had passed until now.
Not one existing `METADATA_ONLY` row's format or payload is touched.

### `StructuredResumeV1` (`packages/shared/src/schemas/resume-content.ts`)

Header (name/email/phone/location/links — its own frozen snapshot per version, never a live
read of `profiles`, so a historical submission stays reproducible even after the user changes
their contact info later), Education, Experience, Projects, Leadership, Skills (named groups,
mirroring the existing `skills.category` column rather than one flat list). Every entry and
bullet carries a stable id (`crypto.randomUUID()`, generated once, kept for its whole life —
editing text never changes it, duplicating an entry always generates a new one) — array order
*is* display order, no separate ordering field. Dates are `{year, month: 1-12 | null}` pairs, a
range being `{start, end, isPresent}` — presentation-safe ("May 2025"), not a precise timestamp;
a Zod `.refine` rejects the nonsensical `isPresent: true` + non-null `end` combination. Bullet
`provenance` is a discriminated union (`MANUAL` / `CANDIDATE_FACTS` with `sourceFactIds`), not an
optional array, so "grounded in zero facts" can never be confused with "not grounded at all" —
manual editing never requires the `CANDIDATE_FACTS` variant. `schemaVersion: 1` is embedded in
the payload itself, independent of the `snapshot_format` column, so a future `StructuredResumeV2`
can exist without ever reinterpreting an existing v1 snapshot.

### Deterministic LaTeX renderer (`packages/shared/src/lib/resume-latex-render.ts`)

`renderStructuredResumeToLatex` is a pure function — same input, same output, always, no I/O, no
clock reads. A self-contained, ATS-friendly one-page-style template (the well-known
`\resumeItem`/`\resumeSubheading`/`\resumeSubHeadingListStart` command family) with every macro
defined inline in the generated document — no external `.cls`/`.sty` file, no `\input` of
anything outside the one generated string. `escapeLatex` handles every LaTeX special/active
character (`& % $ # _ { } ~ ^ \`), backslash first via a placeholder so the backslash it
introduces while escaping e.g. `&` is never itself re-escaped on a later pass — user text can
never inject LaTeX commands through a structured field, only literal escaped text. Empty
sections (no entries) are omitted from the output entirely rather than rendered as an empty
heading. `getLatexForResumeVersion` is the one function every caller uses: the user's custom
override when present, the generated render otherwise — deciding that in exactly one place.

### `buildStructuredResumeFromProfile` (`packages/shared/src/lib/resume-content-from-profile.ts`)

The "Import from profile" content builder — filters `experiences`/`education`/`projects`/
`skills` to `userApproved && approvedForApplications` (the same grounding bar every AI/autofill
path already uses, applied here even though no model is called at all), maps a free-text
`description` column into separate bullets by splitting on the user's own line breaks (never
inventing new sentences), and carries a row's `sourceFactId` through as `CANDIDATE_FACTS`
provenance when present. Never populates leadership (no structured source table exists for it —
only flat `candidate_facts` rows with no organization/role/date shape, which would require
guessing structure the user never entered). Header `fullName` falls back to the profile's email,
then a plain "Your Name" placeholder, never a fabricated real name.

### Tests (Phase 7C schema/renderer)

`packages/shared`: `resume-content.test.ts` (+17), `resume-version.test.ts` (+7, the discriminated
union), `resume-latex-render.test.ts` (+27, every escaped character individually and combined,
date formatting, full/minimal/empty-section resumes, order preservation, determinism, override
precedence), `resume-content-from-profile.test.ts` (+14). pgTAP:
`0027_resume_structured_content.test.sql` (9 assertions) run live against the linked Supabase
project — a `STRUCTURED_V1` version with a real payload, the unchanged `METADATA_ONLY` default
path, both directions of the payload-matches-format constraint, a non-object payload rejected,
an unrecognized format still rejected, and immutability holding for a `STRUCTURED_V1` row exactly
like a `METADATA_ONLY` one. All pass; existing 0024-0026 suites re-run unchanged and still pass
(35/35) — the widened constraint touches nothing Phase 7A/7B already relied on.

## Phase 7D — Resume Studio

### `/resumes/[id]/studio`

A server component resolves the base version (the `?version=` query param if it belongs to this
résumé, else the résumé's latest `STRUCTURED_V1` version, else blank) and precomputes the
profile-import candidate, then hands both to a client component that owns all draft state. Every
edit is a plain immutable array/object update (`array-utils.ts`'s `updateAt`/`removeAt`/`moveAt`/
`insertAt`) — array order is display order throughout, matching the schema. Add/remove/reorder
uses explicit move-up/move-down/remove buttons (`move-buttons.tsx`), not drag-and-drop — plain
buttons are keyboard- and screen-reader-operable without a parallel accessible path. One generic
`EntrySectionEditor<T>` (`entry-section-editor.tsx`) supplies the list mechanics (add a blank
entry, remove, move) for Education/Experience/Projects/Leadership; each section supplies its own
field layout via a render prop, factoring out `DateRangeFields` and `BulletsEditor` as the shared
sub-pieces every section reuses.

### Structured vs. Advanced mode

Structured mode edits the fields directly; Advanced mode shows the currently-generated LaTeX
read-only until the user clicks "Customize" (which seeds `renderOverride` with the current
generated text as a starting point) — after that, it's a plain editable textarea, with "Reset to
generated LaTeX" requiring an explicit confirmation before discarding the override. "Import from
profile" replaces Education/Experience/Projects/Skills with the profile-derived draft (confirming
first if the draft already has content) but always keeps the current header and any active
override untouched.

### Save New Version

`saveNewStructuredResumeVersion` (server action): verify ownership of the target résumé, validate
the draft against `structuredResumeV1Schema` (never trust client-side validation alone), then
call `createOwnResumeVersion` with `snapshotFormat: 'STRUCTURED_V1'` via the admin client —
`version_number` is computed server-side inside the RPC, never passed by this action or the
client. A friendly, specific error is returned (not thrown across the server/client boundary) on
either failure. Nothing here ever touches an existing version's row.

### Live LaTeX preview and `.tex` download

The preview is `getLatexForResumeVersion(draft)` computed client-side via `packages/shared` —
cheap and pure, so it updates on every keystroke with no server round trip and no PDF compilation
attempted (docs/RESUME_STUDIO.md §1). "Download .tex" builds a `Blob` and triggers a client-side
download named via the existing Phase 7A naming helper (`buildResumeFileName`, extension `tex`)
— no server route, no public URL, nothing persisted.

### Résumé detail page and application detail integration

`/resumes/[id]` gained an "Open Studio" entry point, a Structured/Metadata-only badge per
version, a per-version "Edit as new version" link (`?version=<id>`), and `VersionLatexPreview` —
a read-only expandable LaTeX view honest about `METADATA_ONLY` versions ("this version predates
structured résumé content," never a fabricated render) with its own "Download .tex." The
application detail page's Resume section gained an "Open Studio" link next to the working
version; `SubmissionPacketSection`'s submitted-résumé display gained the same read-only LaTeX
view for a `STRUCTURED_V1` submitted version — still clearly locked/historical, never editable
from there (editing always means opening the Studio and saving a *new* version).

### Tests (Phase 7D)

`apps/web`: `resume-studio.test.tsx` (+11 — load/edit header, add/edit/remove/reorder an
experience entry, add/remove a bullet, save success and error paths, Advanced mode
customize/reset including a cancelled-confirmation case, import-from-profile keeping the current
header), `version-latex-preview.test.tsx` (+2 — the honest `METADATA_ONLY` message, and expand/
collapse for a `STRUCTURED_V1` version). All existing `submission-packet-section.test.tsx` cases
(12) re-run unchanged and still pass.

### Self-review findings (this pass)

Audited and confirmed clean: no shell/subprocess execution anywhere in this phase (none exists to
audit — no compilation happens at all); no client-specified `version_number` (still fully
server-computed inside the RPC); no hardcoded "My Pham" (naming helper reused from Phase 7A,
unchanged); structured data never silently diverges from what renders (override precedence is
decided in exactly one function); raw LaTeX never replaces the factual structured model (the
override is additive, structured content is always still valid and present); no AI, no company
research introduced; no new Supabase Storage bucket created; no N+1 (the Studio page's profile-
import data and version list are each single batched queries, matching the existing pattern from
Phase 7A/7B).

### Explicitly deferred to a future phase

PDF compilation and preview (docs/RESUME_STUDIO.md §1/§9), PDF storage (§10), a version diff
view, AI tailoring, company research. None of this phase's schema needs to change to add any of
them later — `snapshot_format` and the JSON payload's own `schemaVersion` were designed
specifically to absorb this without reinterpreting anything already saved.
