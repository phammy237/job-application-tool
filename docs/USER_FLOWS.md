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

**Not yet built** — no upload UI, no Storage bucket, no extraction job exists in this codebase
today (`resume_uploads`, migration 0020's rename of the original `resumes` stub, still has no
writer anywhere). When built, its upload affordance will most likely live on `/resumes` (§3A
below) as one action alongside that page's actual current purpose — the résumé library — not as
`/resumes`'s sole function the way this flow originally assumed.

1. User uploads a résumé file (stored in Supabase Storage, private bucket, scoped to `user_id`).
2. A `resume_uploads` row is created; a server job parses the file and calls Claude to propose
   structured `candidate_facts` rows referencing `sourceResumeId` and `sourceText`.
3. Every proposed fact is created with `userApproved = false`, `approvedForApplications =
false`, `visibleOnPublicProfile = false`. Nothing extracted is usable until step 4.
4. User reviews proposed facts on `/profile`: edit `normalizedValue`, approve, reject, or
   adjust `tags` and `visibleOnPublicProfile`. Rejected facts are kept (soft) for audit but
   never surfaced to AI or autofill.
5. User may re-run extraction against a newer résumé file without deleting the profile history.

## 3A. Résumé library and application attachment (Phase 7A/7B)

1. User visits `/resumes` — their résumé library: a master résumé (at most one, created here if
   none exists yet) and any tailored résumés, each with a permanent version history. Editing a
   résumé never changes an existing version; it creates a new one (§8 below covers what deleting
   one does and does not remove).
2. From `/resumes/[id]`, the user renames the résumé, and opens the Resume Studio
   (`/resumes/[id]/studio`, Phase 7C) to actually edit content: Education, Experience, Projects,
   Leadership, and Skills sections, plus an Advanced mode for a custom LaTeX override — see §3B
   below and `docs/RESUME_STUDIO.md`. A résumé created before Phase 7C (or one the user never
   opened the Studio for) may still have only metadata-only versions — a name, a number, a
   timestamp, no content — and the page says so plainly rather than pretending otherwise.

## 3B. Resume Studio — structured editing (Phase 7C)

1. User opens `/resumes/[id]/studio`, optionally with `?version=<id>` to start from a specific
   existing version. The draft starts from that version's content, or the résumé's latest
   structured version if none was specified, or a blank document (header pre-filled from the
   user's own profile contact info) if no structured version exists yet.
2. User edits Header, Education, Experience, Projects, Leadership, and Skills directly — add/
   remove/reorder entries and bullets (explicit move-up/move-down controls, no drag-and-drop).
   "Import from profile" is a separate, explicit action that replaces those sections with the
   user's already-approved profile data for review, never auto-applied.
3. A live LaTeX preview updates as the user types — deterministic and derived, never itself
   editable in Structured mode. Advanced mode exposes it as an editable "custom LaTeX override";
   once set, the override renders instead of the generated LaTeX until the user explicitly
   resets it (structured content is never silently discarded either way).
4. **Save New Version** validates the draft and creates a brand new immutable `resume_versions`
   row — the version being edited from is never changed. There is no autosave and no draft
   persisted server-side; unsaved changes are lost on navigation (with a warning) exactly like
   any other unsaved browser form.
5. PDF compilation is not available yet (`docs/RESUME_STUDIO.md` §1) — the user downloads the
   generated `.tex` file and compiles it themselves (e.g. via Overleaf) in the meantime.
3. On an application's detail page, the user selects which résumé version they are currently
   planning to submit ("working résumé") — changeable at any time before applying, and freely
   afterward too, with no effect on history (step 5). "Create resume for this application" creates
   a new tailored résumé named `"{Owner}'s Resume -- {Company} -- {Role}"` (never a hardcoded
   name — every user's own name, from their profile, or a generic "My Resume" fallback), with one
   initial version, and selects it in the same action.
4. Marking the application **Applied** (§5's step 8) freezes whatever working résumé version was
   selected at that instant into the immutable submission packet — or freezes nothing (null) if no
   version was selected; résumé attachment is optional, never inferred.
5. The historical submission viewer (§6) always shows the exact submitted version, even after the
   application's working résumé selection has since moved on to something else — that divergence
   is expected, normal history, not an error state.

## 3C. Grounded résumé tailoring, review, and save (Phase 7E/7F)

1. On an application's detail page, once a working résumé version with real structured content
   (`STRUCTURED_V1`) is selected, an "AI résumé tailoring" panel appears with a "Tailor resume for
   this job" button — nothing fires automatically; no network call happens until this exact click.
2. Career OS re-derives the working résumé version, the job posting, any existing requirement
   analysis, and the user's approved facts entirely server-side (never trusting anything the
   browser sends) and asks Claude for a bounded set of edits — reword a bullet, add one grounded
   in a real fact, omit or reorder a bullet/entry, reorder skill groups. The model never sees or
   produces a whole résumé or any LaTeX.
3. Every proposed edit is checked against the user's own approved facts and the résumé's own
   existing text before it's ever shown — an edit that would introduce a number, technology, or
   claim not already present in what it's rewriting or the facts it cites is rejected outright,
   and the whole response is retried once or declined, never silently softened.
4. The result is a proposal, not a fait accompli — every operation starts **Pending review**, never
   pre-accepted. The user reviews each one individually (Phase 7F,
   `docs/IMPLEMENTATION_PLAN.md` "Phase 7F"):
   - **Accept** — the change participates in the reviewed draft.
   - **Reject** — the change is dropped; its text is never saved or logged anywhere.
   - **Edit** (rewrite/add only) — the user types their own replacement text, and explicitly
     chooses "Keep as fact-grounded" (re-checked against the same evidence, and refused if it no
     longer holds) or "Save as manual content" (always allowed, never claimed as grounded).
   A live final preview — updated instantly, no network call per click — shows the reviewed
   résumé's requirement coverage, accepted/rejected/edited counts, and a `.tex` download.
5. **Save Tailored Resume** is disabled until every change is resolved (accepted or rejected) and
   at least one net change exists. Saving creates one new immutable résumé version: from the
   user's master résumé, a new job-specific tailored résumé; from an existing tailored résumé used
   only by this application, its next version; from one also used by another application, a fresh
   clone rather than mutating a résumé that application still depends on. The application's
   working résumé updates to the new version; nothing else does — an already-submitted
   application's frozen submission record is untouched (§3B). A résumé with a custom Advanced
   LaTeX override requires an explicit acknowledgement before saving, since the new version's
   LaTeX is always regenerated from structured content, never the old override.
6. Nothing is ever saved without this explicit click — a page refresh before saving loses the
   whole review, same as before Phase 7F. No AI call happens anywhere in this review/save step;
   the only Claude call in this flow is the one that produced the original proposal in step 2.

## 3D. Company research (Phase 7G, RESEARCH ONLY)

1. On an application's detail page, a "Company Research" section always appears with an explicit
   **Research company** button — nothing fires automatically; no network call happens until this
   exact click. If research already exists, the button reads **Refresh research** instead and the
   section shows when it was last researched plus finding/source counts, with a **View research**
   link.
2. Career OS builds a small, bounded set of deterministic search queries from the application's
   company, role title, and (when available) its top job requirements, discovers public sources —
   the company's own site, newsroom, investor relations, engineering/product blog, careers page,
   and independent reporting, never the job posting's own ATS/job-board hosting page — ranks and
   caps them, and extracts bounded text from a shortlist.
3. Claude synthesizes a bounded list of findings, each a factual claim about the company plus
   (optionally) why it's relevant to this specific role — every finding must cite at least one of
   the sources Career OS actually discovered; an invented or unoffered citation is rejected and
   retried once, then honestly reported as failed. The candidate's résumé, approved facts, and
   profile are never sent to the search provider or the model — this is research about the
   company and the role, never about the candidate.
4. The dedicated research page shows an executive summary (built only from the findings actually
   returned, never a separate free-text claim), each finding with its category, role relevance,
   and numbered source citations you can open, and the full source list with publisher and
   publication date when known. Previous research snapshots remain available and unchanged —
   refreshing always creates a new snapshot rather than editing the old one.
5. Company research does not affect interview prep yet — that intersection is planned for a later
   phase. It CAN optionally inform résumé tailoring, as of Phase 7H (§3E below).

## 3E. Research-aware résumé tailoring (Phase 7H)

1. Extends §3C — never a separate flow. If a company-research snapshot exists for this
   application, the tailoring panel shows two radio options above the "Tailor resume for this job"
   button: "Use latest research — <date>" (selected by default when research exists) and "Tailor
   using job posting only." If no snapshot exists yet, the panel simply notes that and links to
   "Research company first" — with zero friction to tailor immediately without it.
2. Clicking "Tailor resume for this job" makes ONE Claude call, exactly as in §3C — never a second
   research call. If research mode is selected, the server resolves the exact snapshot (the one
   just shown, or the application's latest compatible one), never re-searches, and folds a bounded,
   ranked subset of its findings into that same call.
3. The proposal now shows a small "Tailoring context" note: which job posting, and — when used —
   the company research date and how many findings were considered, with a link back to the full
   research page. When research wasn't used, it says so plainly rather than implying it was.
4. Individual operations may show a "Company relevance" note (e.g. "Company relevance: Directly
   relevant to this engineering role · View research") explaining why a reorder/omission/rewrite
   matters for this specific company — this is never presented as something the candidate did, and
   it never appears as a reason a bullet's text itself changed unless that text is also grounded in
   the candidate's own approved facts. Accept/reject/edit works exactly as in §3C.
5. Saving (§3C step 5) is unchanged except that the new résumé version silently carries the exact
   research snapshot id, if any, that informed it — purely for later audit ("which research
   informed this version"), never surfaced as a blocking requirement. If the company's research is
   refreshed afterward, the saved version keeps its original reference; nothing is retroactively
   repointed, and no new tailoring or version is ever created automatically by a refresh.

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
2. **Delete an uploaded résumé file** (once §3 below is actually built) — removes the file from
   Storage and the `resume_uploads` row; facts sourced from it are flagged (not silently deleted)
   so the user can decide whether to keep them as manually-verified.
2A. **Delete a résumé / résumé version** (Phase 7A) — a logical `resumes` row may be deleted along
   with all of its `resume_versions`, unless any version was ever frozen into a submission packet
   (§10's immutable submission record) — that delete is structurally refused, not just
   discouraged, and the UI surfaces the reason plainly. A single non-submitted version may be
   deleted on its own the same way. Deleting an application does not delete its working résumé
   version — versions belong to the user's résumé library, not to one application.
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
