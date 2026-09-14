# Product Spec

## 1. What Career OS is

Career OS is a privacy-first job application assistant. It maintains a structured, factual
record of a candidate's background, then helps that candidate apply to jobs faster and more
consistently without ever putting words in their mouth: every suggestion the system produces
traces back to a fact the candidate has explicitly approved.

It is built to work for one real user first (the product owner) but architected from the
first migration as a genuinely multi-tenant product, so it can later open to a wider group
without a rewrite.

## 2. Product components

1. **Web dashboard** (`apply.mypham.space`) — profile management, résumé management,
   application tracker, settings.
2. **Chrome extension** — on-demand job-page analysis and approved-field autofill, driven
   entirely by explicit user clicks.
3. **Structured candidate profile** — the single source of truth for every fact the system is
   allowed to use about the candidate.
4. **AI-assisted tailoring system** — ranks approved facts against a job description and
   drafts suggestions for the user to review, edit, approve, or skip.
5. **Optional Gmail application-status tracker** — attended sync (manual click, or a
   throttled auto-check while `/settings` is open) that classifies recruiting-related emails
   and proposes application-timeline updates for confirmation.
6. **Opportunity intelligence — requirement-evidence mapping (Phase 5A)** — an immutable,
   versioned archive of a posting's content captured at save time, plus a user-triggered,
   per-requirement breakdown of which approved facts support it. Never a fabricated match, and
   never reduced to a single "ATS score" or hiring-probability number — see §3 and
   `docs/AI_GROUNDING.md` §8.
7. **Networking / CRM (Phase 6, foundation through 6C)** — private, user-owned contacts,
   reusable across applications, with a longer-lived relationship tag (recruiter, alumni,
   friend, …) distinct from a per-application role (referrer, interviewer, …). Deterministic
   duplicate warnings only — never auto-merged. A factual, user-editable interaction history per
   contact (email, call, coffee chat, meeting, and more) answers "what history do I have with
   this person?" — pure record-keeping. An explicit, user-chosen follow-up reminder per contact
   (never invented by Career OS) drives a small deterministic next-action engine — "who have I
   said I need to follow up with, and is that due right now?" — surfaced on `/network`'s
   "Follow-ups due" section and the contact detail page. No AI anywhere in this feature area, no
   Gmail-derived contacts/interactions/reminders, no relationship scores or "reconnect"
   heuristics, and no background notifications outside the product itself — see
   `docs/IMPLEMENTATION_PLAN.md` "Phase 6" for what's still deferred.

## 3. Non-goals (explicit)

These are deliberate exclusions, not gaps to be filled opportunistically:

- **No autonomous submission.** The extension fills approved fields; the human clicks submit
  on the employer's site. Career OS never submits an application on the user's behalf.
- **No fact fabrication.** If the system doesn't have an approved fact to answer a question,
  it says so. It does not infer, estimate, or generalize an employer, title, date, metric, or
  skill into existence. See `docs/AI_GROUNDING.md`.
- **No continuous surveillance.** No screen recording, no keystroke capture, no browsing
  history collection, no background page monitoring. The extension only inspects the current
  page after an explicit user action. See `docs/EXTENSION_DESIGN.md`.
- **No continuous mailbox monitoring** in the initial version. Gmail sync only ever runs
  attended — a manual click, or a throttled auto-check while the user has `/settings` open —
  never a background job, cron, or webhook (`docs/EMAIL_INTEGRATION.md` §1).
- **No billing in the initial version.** Usage limits and feature flags are built now so
  billing can be added later without restructuring; the billing system itself is documented,
  not implemented (see `docs/IMPLEMENTATION_PLAN.md` Phase 8).
- **No coupling to mypham.space.** Separate repo, separate database, separate deploy
  pipeline. See `docs/ARCHITECTURE.md` §1 and §6.
- **No aggregate match score.** The requirement-evidence mapping feature (Phase 5A) never
  computes or displays an "ATS score," hiring probability, or interview probability — only a
  per-requirement breakdown of which approved facts support it. Hard eligibility (e.g. work
  authorization) is shown separately from general qualification coverage, never blended into
  one number. See `docs/AI_GROUNDING.md` §8.

## 4. Public vs. private product areas

### Public (`apply.mypham.space`, unauthenticated)

- Product explanation and feature previews
- Privacy explanation
- Screenshots or demo content (seed data only — never real user data, see
  `docs/SECURITY_AND_PRIVACY.md`)
- Login
- Join waitlist / create account (gated by `public_signups_enabled` feature flag)
- Link back to `mypham.space`
- "Built by My Pham" attribution

### Must never be exposed publicly, under any route or API response

- Real applications or application statuses
- Résumés or résumé-derived content
- Recruiter information, or any networking contact/tag/application-link/interaction data
  (Phase 6)
- Company email contents or Gmail signals
- Generated answers
- Work-authorization information
- User analytics
- Private candidate-profile facts (anything with `visibleOnPublicProfile = false`, which is
  the default for every fact)

This boundary is enforced structurally (route groups + middleware + RLS), not just by page
design — see `docs/ARCHITECTURE.md` §5 and `docs/SECURITY_AND_PRIVACY.md`.

## 5. Core workflow (product-level summary)

See `docs/USER_FLOWS.md` for the step-by-step version with actors and system responsibilities
for each step. In short: upload résumé → system extracts candidate facts → user reviews and
approves facts → user opens a job posting → extension analyzes the page on click → backend
ranks approved experiences against the job → Claude drafts suggestions from approved facts
only → user reviews/edits/approves/skips each suggestion → extension fills only approved
fields → user saves the opportunity to the dashboard (tracked as `SAVED` or `IN_PROGRESS` —
this can happen before, during, or after filling, and repeated saves update the same tracked
application rather than duplicating it) → user submits manually on the employer's own site,
outside Career OS's control → user explicitly clicks **Mark as Applied** and confirms — first
passing a deterministic consistency check (Phase 5B.2: a contradiction between two of the
application's own answers blocks outright; a difference between an answer and stored profile/
evidence requires explicit per-finding acknowledgement, never pre-checked) — which is the _only_
action that ever changes the tracked status to `APPLIED`, and which atomically creates one
immutable historical record of what was actually submitted (Phase 5B.1's "submission packet") →
optional Gmail sync proposes timeline updates for confirmation from there.

Saving, autofilling, or completing every field never implies submission or `APPLIED` status —
those are two independently human-triggered signals (the actual submit click happens on the
employer's site, entirely outside what Career OS can observe or control; "Mark as Applied" is
the user separately telling Career OS that submission happened).

## 6. Candidate profile scope

The profile covers: personal contact information, education, work experience, leadership,
research, projects, skills, languages, certifications, awards, work authorization, location
preferences, relocation preferences, links, and résumé versions. Full fact schema in
`docs/DATA_MODEL.md` §"candidate_facts".

A separate résumé library (`/resumes`, Phase 7A) tracks the user's master résumé and any tailored
résumés as permanent version history — each edit creates a new version rather than changing one in
place. An application may select a "working" résumé version to plan around, and — the one time an
application is marked Applied — that version is frozen into the application's own immutable
submission record (§5), independent of anything selected later. As of Phase 7C, a version can hold
real structured content (Header, Education, Experience, Projects, Leadership, Skills), edited
manually in the Resume Studio (`/resumes/[id]/studio`) and deterministically rendered to LaTeX; an
Advanced mode supports a custom LaTeX override. PDF compilation is not implemented yet (no
sandboxed compilation environment exists in this deployment) — see `docs/RESUME_STUDIO.md`. As of
Phase 7E, the application detail page can also generate a grounded, job-specific tailoring
*proposal* against the working résumé version — a bounded set of reorder/rewrite/omit/add
operations, never a model-generated résumé or LaTeX, and never saved automatically; keeping any
part of it still means editing it manually in the Resume Studio. No company research, no ATS
score — see `docs/AI_GROUNDING.md` §11, `docs/RESUME_STUDIO.md` §12, and `docs/DATA_MODEL.md`
§"resumes"/§"resume_versions".

## 7. Application tracker scope

Statuses: `SAVED`, `IN_PROGRESS`, `APPLIED`, `APPLICATION_RECEIVED`, `ASSESSMENT`,
`INTERVIEW`, `ACTION_REQUIRED`, `OFFER`, `REJECTED`, `WITHDRAWN`, `UNKNOWN`.

Dashboard surfaces (as actually built — see `docs/IMPLEMENTATION_PLAN.md` Phase 5C.1/5C.2/5C.4 for
the full design): an attention-sorted overview (`/dashboard`) grouping applications by a
deterministically-derived next action rather than a flat list — attention-needed, applications to
finish (Phase 5C.4 — a separately-labeled, still-`LOW`-priority home for `SAVED`/not-yet-reviewed
applications, never counted as an urgent need), follow-up suggestions (explicitly labeled as a
Career OS recommendation, never a known employer deadline), a pipeline-stage count breakdown, and
a recent-activity feed of real status-change events; a table view (`/applications`) with status
filtering, free-text company/title search, and each row's next action; an application detail page
(notes, associated résumé, generated-answer history, event timeline, manual status changes, undo
for automated updates, and — Phase 6A — a People section listing linked networking contacts and
their role on that application, with link/unlink and "add new contact" affordances). Every
dashboard/table row linking to an application jumps straight to the
relevant panel on the detail page via a plain page anchor — never a mechanism that bypasses the
detail page's own re-check of what's currently true. No Kanban view, location/date filters, or
rate-based summary metrics (interview rate, offer rate, etc.) exist yet — Phase 5C.2 deliberately
preferred plain counts over percentages for a v1 with a small per-user sample size; a rate metric
may be added later if it can be computed transparently.

The application detail page also offers explicit, user-triggered AI *assistance* on top of two
next actions (Phase 5C.3, see `docs/IMPLEMENTATION_PLAN.md` "Phase 5C.3" for the full design): a
grounded follow-up-message draft when the next action is "Consider following up," and grounded
interview-preparation material (role priorities, evidence to emphasize, STAR-story prompts,
potential questions to prepare for, questions to ask, gaps to prepare) when the next action is
"Prepare for the interview." Neither feature runs automatically, neither changes an application's
status or priority, and neither can send anything — Career OS drafts, the user sends. AI never
decides whether or when to follow up; that stays entirely deterministic. The extension popup, once
a job is tracked, also offers a lightweight "Open in Career OS" handoff link to the same detail
page (Phase 5C.4) — never AI content generation inside the popup itself.

## 8. Initial beta constraints

- Account registration is invite/approval-gated via a `public_signups_enabled` feature flag,
  off by default.
- Gmail integration is behind its own `gmail_integration_enabled` feature flag.
- AI requests are rate-limited per user.
- Onboarding is minimal but present (not a placeholder screen).
- Demo data used anywhere in the public surface contains no real personal information.
- No billing. See `docs/IMPLEMENTATION_PLAN.md` Phase 8 for how billing would attach later
  without restructuring the data model (plan-limit fields are reserved but unused).
