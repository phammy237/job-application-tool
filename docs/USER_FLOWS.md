# User Flows

Each flow lists the actor, the trigger, the system responsibility at each step, and what is
explicitly out of scope. Every flow assumes the standing rule from `docs/AI_GROUNDING.md`:
nothing is generated or autofilled from a fact that isn't `userApproved` (and, for autofill,
also `approvedForApplications`).

## 1. Account creation

1. User visits `apply.mypham.space`, clicks "Join" / "Create account".
2. If `public_signups_enabled` is off, only pre-approved emails (or an invite token) can
   complete signup; everyone else sees a waitlist form.
3. Supabase Auth creates the user; a `profiles` row and a default `user_settings` row are
   created for that `user_id`.
4. User is routed into onboarding (§2).

## 2. Onboarding

1. Short, explicit sequence — not a wall of empty forms: (a) confirm name/contact basics,
   (b) upload a résumé or skip, (c) brief explanation of the approve-before-use model, (d)
   land on `/dashboard`.
2. No AI suggestions and no extension usage are possible until at least one fact exists and
   is approved — onboarding makes this constraint visible rather than letting the user
   discover it as a dead end later.

## 3. Résumé upload and fact extraction

1. User uploads a résumé file on `/resumes` (stored in Supabase Storage, private bucket,
   scoped to `user_id`).
2. A `resumes` row is created; a server job parses the file and calls Claude to propose
   structured `candidate_facts` rows referencing `sourceResumeId` and `sourceText`.
3. Every proposed fact is created with `userApproved = false`, `approvedForApplications =
false`, `visibleOnPublicProfile = false`. Nothing extracted is usable until step 4.
4. User reviews proposed facts on `/profile`: edit `normalizedValue`, approve, reject, or
   adjust `tags` and `visibleOnPublicProfile`. Rejected facts are kept (soft) for audit but
   never surfaced to AI or autofill.
5. User may re-run extraction against a newer résumé version without deleting the profile
   history.

## 4. Job analysis via the extension

1. User is on a job posting page and clicks the Career OS extension icon, then clicks
   **Analyze Job** inside the popup — this is the first moment the extension is allowed to
   read the page (see `docs/EXTENSION_DESIGN.md`).
2. Content script runs the adapter chain (`GenericHtmlAdapter` first; platform-specific
   adapters if matched) to extract company, title, location, employment type, description,
   responsibilities, qualifications, skills, platform type, and visible form fields.
3. Extraction payload is validated against the shared Zod schema and sent to the
   authenticated Career OS API, which creates or updates only a `jobs` row (re-analyzing the
   same URL updates that same row rather than duplicating it). **No `applications` row is
   created at this step** — tracking an application is always a separate, explicit action (§5
   below), never an automatic side effect of analysis.
4. The popup checks whether this job is already tracked (`GET /api/applications?jobId=...`)
   and, if so, shows its current status.
5. For each detected field the user chooses to request one for, backend retrieval
   (`docs/AI_GROUNDING.md`) ranks the user's approved, `approvedForApplications = true`
   experiences/projects against the job, and Claude drafts a suggestion — with
   `sourceFactIds`, `reasoningSummary`, `confidence`, and `unsupportedClaims`.
6. Popup displays: detected company/role, and the proposed field answers grouped by review
   state, each with edit/approve/skip controls. Nothing is written to the page yet.

## 5. Review, autofill, save, and mark as applied

1. User reviews each suggestion in the popup. Fields the retrieval pipeline is confident
   about are grouped as "ready" (bulk-approvable via one click, still never pre-checked
   automatically); everything else (experience descriptions, free-response, why-company, work
   authorization, relocation, compensation) requires an explicit per-field approval click.
2. Fields classified as `DEMOGRAPHIC`, `LEGAL`, or `AUTHENTICATION` are never offered for
   autofill at all (see `docs/EXTENSION_DESIGN.md` field taxonomy) — there is nothing to
   approve because the system never proposes a value for them.
3. User clicks **Autofill Approved Fields** — the content script writes only the
   user-approved values into the matching DOM fields, re-validating each target immediately
   before writing and never overwriting a field that already has a value without a separate
   explicit replacement decision. Nothing is submitted.
4. At any point — before autofill, after a partial fill, or after every eligible field is
   filled — the user can click **Save Application** (or **Update Saved Application** once
   already tracked) to persist the current state: company/title/location, source/canonical
   URL, ATS provider, a sanitized autofill-progress summary, and which generated answers were
   approved/edited. This creates or updates one `applications` row (`SAVED` or `IN_PROGRESS`
   — see `docs/DATA_MODEL.md` "applications" for how repeated saves are deduplicated) and
   never changes status to `APPLIED`. The same save also captures an immutable, versioned
   snapshot of the posting's content (`docs/DATA_MODEL.md` "job_snapshots," Phase 5A) — cheap,
   deterministic, no AI call — so the exact posting an application was based on survives even
   if the listing is later re-analyzed with different content or disappears entirely. Once the
   application reaches `APPLIED` or later, further saves still capture new snapshots as usual
   but no longer repoint the application at them — see step 6a below.
5. User completes any remaining fields manually and submits the application themselves, on
   the employer's own page — entirely outside Career OS's control; Career OS has no way to
   observe or influence that submit action.
6. User explicitly clicks **Mark as Applied** in the popup (a dedicated action with its own
   inline confirm step), or selects `APPLIED` from the status dropdown on the dashboard's
   generic manual-status-change control (§6) — either way, an explicit, deliberate user action
   is what sets status to `APPLIED`. It is never inferred from filling, saving, page
   navigation, or detecting a submit button.
6a. Once `APPLIED`, the application's linked snapshot (step 4) is frozen — an ordinary
   re-save can never repoint it at a newer posting version, preserving the exact content the
   application was actually based on. There is no correction/amendment workflow for this in
   Phase 5A; that's explicitly deferred.

## 6. Reviewing applications on the dashboard

1. User opens `/applications`: Kanban or table view, filterable by company/role/location/
   date/status.
2. Application detail page shows notes, associated résumé version, full generated-answer
   history (including skipped/edited suggestions, for the user's own audit trail), and the
   event timeline.
3. User can manually change status at any time; manual changes always win over
   automation and are marked as such in the timeline.
4. If the application has a linked job snapshot (§5 step 4), the detail page shows a
   "Requirements & evidence" panel. It starts empty — analysis only ever runs when the user
   clicks **Analyze requirements** (or **Regenerate**, once a result exists); it never runs
   automatically. Results are grouped `REQUIRED` before `PREFERRED`, each requirement shows a
   relationship badge (direct/equivalent/inferred/not covered — inferred matches are visibly
   marked as needing the user's own confirmation), and each cited fact shows whether it's still
   currently approved, changed since this analysis, no longer approved, or no longer available
   — never presented as verified once it's gone stale. A failed or rate-limited attempt leaves
   whatever result already existed untouched.

## 7. Gmail sync (optional)

1. User opts in from `/settings` (only visible if `gmail_integration_enabled` is on) and
   completes Google OAuth server-side; refresh token is encrypted at rest
   (`docs/EMAIL_INTEGRATION.md`).
2. User clicks **Sync Gmail** (manual — no background polling in v1).
3. Server searches for likely recruiting messages, runs deterministic classification first,
   falls back to Claude only for ambiguous cases, and attempts to match each message to an
   existing `applications` row.
4. Any match with confidence ≥ 0.85 is proposed as a status update; below that threshold, the
   user must explicitly confirm before the application timeline changes.
5. User can disconnect Gmail and delete all stored signals at any time from `/settings`; this
   also stops future syncs immediately.

## 8. Deletion flows

Each of the following is a first-class, discoverable action (not "contact support"):

1. **Delete a single application** — removes the `applications` row and its
   `application_events`/linked `generated_answers` (or the user may choose to keep generated
   answers as standalone profile history — UX decision made in Phase 1/4 design, not this
   doc). Its linked job snapshot and any requirement-mapping runs are **not** deleted — they're
   independently user-owned (Phase 5A) and only ever removed via full account deletion below;
   there's no per-row deletion path for them in Phase 5A.
2. **Delete a résumé** — removes the file from Storage and the `resumes` row; facts sourced
   from it are flagged (not silently deleted) so the user can decide whether to keep them as
   manually-verified.
3. **Delete generated content** — removes a `generated_answers` row.
4. **Disconnect Gmail** — revokes the OAuth token, deletes the `email_connections` row and
   all associated `email_signals`.
5. **Delete entire account** — cascades through every user-owned table (enforced by FK
   `ON DELETE CASCADE` from `auth.users`, see `docs/DATA_MODEL.md`), removes Storage objects,
   and revokes any external tokens (Gmail) before the row deletion completes.

## 9. Out of scope for these flows

- Any flow where the system submits, signs, or attests on the user's behalf.
- Any flow that runs without a preceding explicit user action (extension analysis, Gmail
  sync, and autofill are all click-triggered, never scheduled or automatic in v1).
