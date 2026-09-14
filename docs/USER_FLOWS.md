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
6. User explicitly clicks **Mark as Applied** in the popup, or the dashboard's dedicated
   equivalent (`docs/IMPLEMENTATION_PLAN.md` Phase 5B.2 — the generic status dropdown no longer
   offers `APPLIED` at all) — either way, an explicit, deliberate user action is what sets status
   to `APPLIED`. It is never inferred from filling, saving, page navigation, or detecting a submit
   button. Confirming first runs an advisory deterministic consistency check (Phase 5B.2): a
   clean result proceeds straight through unchanged from earlier phases; a contradiction between
   two of this application's own answers (e.g. two opposite eligibility answers) blocks outright
   with no way to acknowledge past it — the underlying answer must be fixed first; a difference
   between an answer and stored profile/evidence (e.g. a GPA or graduation date mismatch) is
   shown for explicit, per-finding acknowledgement, never pre-checked, never blocking. The final
   click is still re-verified authoritatively server-side regardless of what the advisory check
   showed.
   6a. Once `APPLIED`, the application's linked snapshot (step 4) is frozen — an ordinary
   re-save can never repoint it at a newer posting version, preserving the exact content the
   application was actually based on. There is no correction/amendment workflow for this in
   Phase 5A; that's explicitly deferred. As of Phase 5B.1, this same moment also creates one
   immutable submission packet — see `docs/DATA_MODEL.md` "submission_packets" — capturing the
   reviewed answers, autofill summary, and any consistency findings/acknowledgements exactly as
   they stood at that instant; a legacy application already `APPLIED` before Phase 5B.1 shipped
   has no packet and never gets one fabricated from later data.
7. (Phase 5C.4) Once a job is tracked, the popup also shows an "Open in Career OS" link to that
   application's detail page on the web app — the same application id the extension already
   tracks, so this always points at the right place with no extra lookup. Its label may hint at
   the current status-driven action (e.g. "Open Career OS to prepare for the interview") for the
   handful of statuses whose action needs no date logic to know; for everything else it stays
   generic rather than guessing. The popup never generates AI content itself — this is purely a
   handoff to the web app, which independently decides everything from there.

## 6. Reviewing applications on the dashboard

0. User opens `/dashboard` (Phase 5C.1/5C.2). Every tracked application has one deterministically
   derived "next action" (e.g. "Review unresolved fields," "Prepare for the interview," "Consider
   following up") — computed from already-persisted state (status, unresolved fields, and how
   long it has been since the more recent of the original submission and the last legitimate,
   non-reverted status update — whether Gmail-confirmed or manually recorded by the user), never
   from a model call, and never inventing a deadline. A just-applied-to job whose status was
   updated to reflect the employer's receipt confirmation yesterday does not immediately prompt a
   follow-up just because the original submission was over a week ago, and correcting an
   accidental status change back to its prior value never resets that clock either. The dashboard
   groups applications by attention rather than showing a flat list:
   **Attention needed** (anything with an urgent/high/medium-priority next action, sorted so the
   longest-waiting urgent items surface first), **Applications to finish** (Phase 5C.4 — every
   `SAVED`/not-yet-reviewed application, kept deliberately `LOW` priority and out of "Attention
   needed" since finishing a draft has no employer deadline, but still given its own visible,
   clearly-labeled section so it never simply disappears), **Follow-up suggestions** (a separate,
   explicitly labeled "Career OS recommendation — not a known employer deadline" section — a
   follow-up suggestion is never shown as if it were an urgent need or a real deadline), **Pipeline
   overview** (counts by stage: Preparing / Applied / Active process / Offer / Closed), and
   **Recent activity** (real status-change events across every application, most recent first —
   Phase 5C.4 also excludes the bookkeeping event a status-change revert creates for itself, so
   undoing a mistake never shows up looking like a real transition). "N applications need
   attention" in the header means exactly "priority is urgent, high, or medium" — a follow-up
   suggestion or an unstarted draft is deliberately not counted as an urgent need; when nothing is
   urgent but something needs finishing, the header says so plainly instead of just "nothing needs
   attention." Clicking through from either section (or the `/applications` table's own "Next
   action" cell) jumps straight to the relevant panel on the application detail page — a follow-up
   suggestion opens the follow-up-draft panel, "Prepare for the interview" opens interview prep,
   "Finish and mark as applied" opens the Mark Applied panel — via a plain page-anchor link, never
   a mechanism that could bypass the detail page's own re-check of what's actually current.
1. User opens `/applications`: table view (also showing each row's next action alongside its
   status), filterable by status and a free-text search across company/title.
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
5. (Phase 5C.3) When the next action shown is **Consider following up**, the detail page shows a
   **Draft follow-up** button. Clicking it sends one request to Career OS, which independently
   re-confirms the next action is still `CONSIDER_FOLLOW_UP` before drafting anything, and returns
   an editable subject/body the user can copy — Career OS never sends anything on the user's
   behalf, and the draft never claims a conversation, referral, interview, or assessment that
   never happened. When the next action is **Prepare for the interview**, an equivalent
   **Generate interview prep** button produces role priorities, evidence to emphasize, STAR-story
   prompts, possible question *topics* (never claimed real questions), questions to ask, and gaps
   to prepare — grounded in the job posting, any existing requirement analysis, and the user's own
   approved facts, never claiming to know what the employer's interview will actually contain.
   Neither button does anything on page load; both require an explicit click, and neither result
   is persisted — refreshing the page loses it.

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

## 7A. Networking / contacts (Phase 6A)

1. User opens **Network** from the sidebar. `/network` lists their own contacts, searchable by
   name, company, title, or email, with each contact's relationship tags shown as badges.
2. **Add a contact** (from `/network`, or from an application's People section): fills in a
   name (the only required field) and any of email/phone/LinkedIn/company/title/location/notes/
   tags. Before saving, Career OS checks for an exact email match, an exact LinkedIn match, or a
   matching name+company against the user's existing contacts — a match shows "This may already
   exist" with a link to the candidate; the user can open it instead, or save anyway. Nothing is
   ever auto-merged.
3. From an application's detail page, the **People** section shows everyone linked to that
   application with their role on it (recruiter, referrer, interviewer, …) — distinct from the
   contact's own longer-lived relationship tags. The user can link an existing contact (search +
   pick a role) or add a new one, prefilled with that application's company.
4. From a contact's own `/network/[id]` page, the user can edit any field (same duplicate check
   re-runs, excluding the contact being edited from its own results), see every application
   they're linked to, link/unlink applications, or delete the contact outright.
5. Nothing here calls Claude, touches Gmail, or appears on any public page — contacts are
   private, user-owned data end to end.

### Interaction history (Phase 6B)

6. Further down the same `/network/[id]` page, an **Interaction history** section lists every
   past interaction with this contact, most recent first — email, call, coffee chat, meeting,
   LinkedIn message, event, introduction, or note. **Log interaction** captures a type and a
   date/time (defaulting to now), plus optional direction, subject, notes, and — only if the
   contact is already linked to one — a related application. This is pure record-keeping:
   Career OS never suggests what to log or what to do about it.
7. Each entry can be edited (correcting a mistake, changing the linked application) or deleted
   outright, with the same "must already be one of this contact's linked applications" rule
   re-checked whenever the linked application changes.
8. Deleting the linked **application** never erases the interaction — only its application link
   is cleared, the history with the person itself stays intact. Deleting the **contact** removes
   its interactions along with it (there's no meaning to interaction history about a contact
   that no longer exists).
9. Nothing here calls Claude either — Phase 6B makes zero model calls, same as 6A.

### Follow-up reminders + networking next actions (Phase 6C)

10. From `/network/[id]`, near the top, the user can **Set a follow-up reminder** — an explicit
    date/time they choose (defaulting to now, editable). Career OS never suggests or invents this
    date; it only exists once the user sets it.
11. Once set, the page shows the factual state: "Follow up on Sep 20" while it's still in the
    future, or "Follow-up reminder due" once that date/time has arrived — never "you've
    neglected this contact" or similar. The user can **Change** a future reminder, or once due,
    **Reschedule** it or **Mark done**.
12. **Mark done** simply clears the reminder. It does not log an interaction or assume the user
    actually followed up — if the user wants that recorded, they log an interaction separately
    (Phase 6B). Logging a new interaction also never silently clears an existing reminder — a
    user might log an inbound recruiter email while still intending to follow up tomorrow.
13. `/network`'s list gains a **Follow-ups due** section above the searchable contact list —
    every contact whose reminder has arrived, earliest first — and every row in the main list
    shows its reminder factually ("Follow up today," "Follow up Sep 20," or "No reminder") when
    one is set. A future reminder never appears in "Follow-ups due."
14. This determination — due or not — is computed fresh every time the page loads from the
    reminder date alone; nothing about it is precomputed or stored. No AI is involved, and
    nothing here sends a notification outside Career OS (no browser push, no email, no
    background job) — the reminder only ever surfaces when the user opens the product themselves.

## 8. Deletion flows

Each of the following is a first-class, discoverable action (not "contact support"):

1. **Delete a single application** — removes the `applications` row and its
   `application_events`/linked `generated_answers` (or the user may choose to keep generated
   answers as standalone profile history — UX decision made in Phase 1/4 design, not this
   doc). Its linked job snapshot and any requirement-mapping runs are **not** deleted — they're
   independently user-owned (Phase 5A) and only ever removed via full account deletion below;
   there's no per-row deletion path for them in Phase 5A. Any `application_contacts` links are
   removed, but the linked contacts themselves are not (Phase 6A); any `contact_interactions`
   row that referenced this application keeps existing with its `application_id` cleared, not
   deleted (Phase 6B).
2. **Delete a résumé** — removes the file from Storage and the `resumes` row; facts sourced
   from it are flagged (not silently deleted) so the user can decide whether to keep them as
   manually-verified.
3. **Delete generated content** — removes a `generated_answers` row.
4. **Disconnect Gmail** — revokes the OAuth token, deletes the `email_connections` row and
   all associated `email_signals`.
5. **Delete a contact** (Phase 6A) — removes the `contacts` row along with its `contact_tags`,
   any `application_contacts` links, and (Phase 6B) its `contact_interactions` history; the
   applications it was linked to are untouched.
6. **Delete a single interaction** (Phase 6B) — removes one `contact_interactions` row; the
   contact, its tags, its other interactions, and any linked application are untouched.
7. **Delete entire account** — cascades through every user-owned table (enforced by FK
   `ON DELETE CASCADE` from `auth.users`, see `docs/DATA_MODEL.md`), removes Storage objects,
   and revokes any external tokens (Gmail) before the row deletion completes.

## 9. Out of scope for these flows

- Any flow where the system submits, signs, or attests on the user's behalf. This includes the
  Phase 5C.3 follow-up draft and interview prep — Career OS drafts/suggests, the user always sends
  or acts. No Gmail send scope exists anywhere in this product.
- Any flow that runs without a preceding, attended user action. Extension analysis and
  autofill are strictly click-triggered. Gmail sync is either click-triggered (**Sync
  Gmail**) or a throttled auto-check on `/settings` page load/reload — both require the
  signed-in user to actually have the app open in that moment; neither is scheduled,
  background, or unattended (`docs/EMAIL_INTEGRATION.md` §1, `docs/IMPLEMENTATION_PLAN.md`
  Phase 5 auto-sync note).
