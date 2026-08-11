# Implementation Plan

This plan is deliberately sequential — each phase produces a working, testable slice, and no
phase depends on a later phase's output.

## Status (updated 2026-08-11)

- [x] Phase 1 — Repository setup, authentication, database, candidate profile, manual tracker
- [x] Phase 2 — Chrome extension shell, page extraction, generic form-field detection
- [x] Phase 3 — Job matching, candidate-fact retrieval, Claude-generated suggestions
- [ ] Phase 4 — Approved-field autofill and application-saving workflow
  - [x] Phase 4A — Field review and approval state
  - [ ] **Phase 4B — Safe autofill engine ← current**
  - [ ] Phase 4C — Application saving and tracker integration
  - [ ] Phase 4D — End-to-end integration and safety verification
- [ ] Phase 5 — Manual Gmail synchronization, email classification, status matching
- [ ] Phase 6 — Multi-user beta hardening, privacy controls, testing, deployment
- [ ] Phase 7 — Optional mypham.space integration, public onboarding, future sharing

Phase 4A shipped: the popup classifies every detected field into a review state (sensitive /
unsupported / already-completed / pending-suggestion / ready / suggested / needs-input),
requests suggestions from POST /api/jobs/:id/suggestions one field at a time, and supports
approve/edit/skip + bulk "approve all ready" — all decisions live in chrome.storage.local only,
nothing DOM-writing or backend-persisting yet. See packages/shared/src/schemas/field-review.ts,
apps/extension/src/popup/state/review-reducer.ts, and apps/extension/src/popup/hooks/
useFieldReview.ts.

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
