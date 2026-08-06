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
   authenticated Career OS API, which creates/updates a `jobs` row and an `applications` row
   in `SAVED` or `IN_PROGRESS` status.
4. Backend retrieval (`docs/AI_GROUNDING.md`) ranks the user's approved, `
approvedForApplications = true` experiences/projects against the job, and Claude drafts
   suggestions — one per relevant field/question — each with `sourceFactIds`,
   `reasoningSummary`, `confidence`, and `unsupportedClaims`.
5. Popup displays: detected company/role, job-match summary, suggested experiences, and
   proposed field answers, each with edit/approve/skip controls. Nothing is written to the
   page yet.

## 5. Review and autofill

1. User reviews each suggestion in the popup. Auto-suggested low-risk fields (name, email,
   phone, LinkedIn, portfolio, school, degree, graduation date) are pre-checked; everything
   else (experience descriptions, free-response, why-company, work authorization,
   relocation, compensation) requires an explicit per-field approval click.
2. Fields classified as `DEMOGRAPHIC`, `LEGAL`, or `AUTHENTICATION` are never offered for
   autofill at all (see `docs/EXTENSION_DESIGN.md` field taxonomy) — there is nothing to
   approve because the system never proposes a value for them.
3. User clicks **Autofill Approved Fields** — the content script writes only the
   user-approved values into the matching DOM fields. Nothing is submitted.
4. User completes any remaining fields manually on the employer's site and submits the
   application themselves, on the employer's own page, outside Career OS's control.
5. User clicks **Save Application** in the popup to persist the final state (or the
   dashboard state is already current if step 3 already wrote through the API).

## 6. Reviewing applications on the dashboard

1. User opens `/applications`: Kanban or table view, filterable by company/role/location/
   date/status.
2. Application detail page shows notes, associated résumé version, full generated-answer
   history (including skipped/edited suggestions, for the user's own audit trail), and the
   event timeline.
3. User can manually change status at any time; manual changes always win over
   automation and are marked as such in the timeline.

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
   doc).
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
