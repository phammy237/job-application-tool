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
  not implemented (see `docs/IMPLEMENTATION_PLAN.md` Phase 7).
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
- Recruiter information
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

## 7. Application tracker scope

Statuses: `SAVED`, `IN_PROGRESS`, `APPLIED`, `APPLICATION_RECEIVED`, `ASSESSMENT`,
`INTERVIEW`, `ACTION_REQUIRED`, `OFFER`, `REJECTED`, `WITHDRAWN`, `UNKNOWN`.

Dashboard surfaces (as actually built — see `docs/IMPLEMENTATION_PLAN.md` Phase 5C.1/5C.2 for
the full design): an attention-sorted overview (`/dashboard`) grouping applications by a
deterministically-derived next action rather than a flat list — attention-needed, follow-up
suggestions (explicitly labeled as a Career OS recommendation, never a known employer deadline),
a pipeline-stage count breakdown, and a recent-activity feed of real status-change events; a
table view (`/applications`) with status filtering, free-text company/title search, and each
row's next action; an application detail page (notes, associated résumé, generated-answer
history, event timeline, manual status changes, undo for automated updates). No Kanban view,
location/date filters, or rate-based summary metrics (interview rate, offer rate, etc.) exist
yet — Phase 5C.2 deliberately preferred plain counts over percentages for a v1 with a small
per-user sample size; a rate metric may be added later if it can be computed transparently.

The application detail page also offers explicit, user-triggered AI *assistance* on top of two
next actions (Phase 5C.3, see `docs/IMPLEMENTATION_PLAN.md` "Phase 5C.3" for the full design): a
grounded follow-up-message draft when the next action is "Consider following up," and grounded
interview-preparation material (role priorities, evidence to emphasize, STAR-story prompts,
possible question topics, questions to ask, gaps to prepare) when the next action is "Prepare for
the interview." Neither feature runs automatically, neither changes an application's status or
priority, and neither can send anything — Career OS drafts, the user sends. AI never decides
whether or when to follow up; that stays entirely deterministic.

## 8. Initial beta constraints

- Account registration is invite/approval-gated via a `public_signups_enabled` feature flag,
  off by default.
- Gmail integration is behind its own `gmail_integration_enabled` feature flag.
- AI requests are rate-limited per user.
- Onboarding is minimal but present (not a placeholder screen).
- Demo data used anywhere in the public surface contains no real personal information.
- No billing. See `docs/IMPLEMENTATION_PLAN.md` Phase 7 for how billing would attach later
  without restructuring the data model (plan-limit fields are reserved but unused).
