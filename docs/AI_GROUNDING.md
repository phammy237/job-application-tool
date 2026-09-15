# AI Grounding

The single hardest constraint in Career OS: **the system must never invent an employer,
title, date, technology, responsibility, metric, academic record, skill, certification, or
result.** This document defines the pipeline that makes that a structural property, not a
prompt-engineering hope.

## 1. Principle

Claude is never the source of a fact. Claude only ever rephrases, ranks, and combines facts
the user has already approved. If the approved facts don't contain enough to answer a
question, the correct output is "cannot answer from approved facts" — not a plausible-sounding
guess.

## 2. Pipeline (deterministic retrieval before generation)

```
1. Parse job description (from packages/shared JobExtractionPayload)
        │
2. Extract responsibilities, qualifications, keywords
   — deterministic NLP/keyword extraction, no LLM call yet
        │
3. Compare against the user's approved facts
   (candidate_facts / experiences / education / projects / skills
    WHERE user_approved = true AND approved_for_applications = true)
        │
4. Rank experiences/projects/skills by relevance
   — deterministic scoring (keyword/tag overlap, recency, category match)
        │
5. Select top-N ranked facts → this is the ONLY candidate data sent to Claude
        │
6. Construct prompt: job context + selected approved facts + the specific
   field/question being answered. Explicit instruction: answer only from
   the provided facts; if insufficient, say so.
        │
7. Claude responds in the fixed JSON contract (§3)
        │
8. Zod-validate the response against that contract
        │
9. Reject if validation fails, or if unsupportedClaims is non-empty
        │
10. Only a passing response is surfaced to the user for review
```

Steps 1–5 run with zero LLM calls. This matters for two reasons: it keeps what's sent to
Claude minimal (only facts the user already approved — nothing extraneous, nothing
unapproved ever crosses that boundary), and it means ranking/relevance is inspectable and
debuggable independent of model behavior.

## 3. Generated-answer contract

Every Claude call in the tailoring system must return, and every response is Zod-validated
against, this shape (mirrors the `generated_answers` table in `docs/DATA_MODEL.md`):

```typescript
const GeneratedAnswer = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sourceFactIds: z.array(z.string().uuid()).min(1),
  reasoningSummary: z.string().max(400),
  unsupportedClaims: z.array(z.string()),
  requiresUserReview: z.boolean(),
});
```

- **`sourceFactIds`** — every fact id the answer actually drew on. An answer with an empty
  array is treated as unsupported and rejected (§4) — there is no such thing as a
  zero-provenance approved answer.
- **`reasoningSummary`** — a short, user-facing explanation of which approved facts
  supported the suggestion (e.g. "Based on your Acme Corp backend role and the Django
  project"). This is explicitly **not** the model's chain-of-thought; the prompt asks for a
  summary, not reasoning steps, and nothing resembling internal deliberation is stored or
  displayed.
- **`unsupportedClaims`** — Claude is asked to self-report anything in its own draft answer
  that it could not tie to a provided fact. This is a belt-and-suspenders check, not the only
  check — see §4 for the second, independent gate.
- **`requiresUserReview`** — effectively always `true` for anything beyond the auto-suggested
  `BASIC_PROFILE`/`EDUCATION` fields (see `docs/EXTENSION_DESIGN.md` §6); included in the
  contract so the UI doesn't need a separate lookup to decide.

## 4. Rejection gate

Two independent checks must both pass before a `generated_answers` row is ever shown to the
user:

1. **Self-reported:** `unsupportedClaims` must be an empty array.
2. **Zod schema validation** must succeed — malformed JSON, missing fields, or an
   out-of-range confidence value all fail closed.

If either check fails, the row is not surfaced. Depending on Phase 3 implementation detail,
a failed attempt either retries once with a stricter prompt or returns "cannot generate a
suggestion for this field from your approved facts" to the user — it never falls back to
returning the rejected draft anyway.

## 5. What "insufficient information" looks like

If retrieval (§2, step 5) finds no approved fact with meaningful overlap to a question (e.g.
a free-response question about a technology the user has no approved fact mentioning),
Claude is not called with a "do your best" instruction. The system either skips generation
entirely and shows the field as unanswered, or calls Claude with an explicit instruction to
return a "no supporting facts" response — either way, the result is a visibly empty
suggestion the user fills in themselves, never a fabricated one.

## 6. Data-minimization at the prompt boundary

- Only facts already `user_approved = true and approved_for_applications = true` are eligible
  for retrieval in step 3 — this is enforced in the `packages/database` query layer
  `packages/ai` calls, not left to prompt instructions alone.
- The full candidate profile is never sent to Claude — only the top-N ranked, relevant facts
  for the specific field being answered, which limits both cost and the blast radius of any
  single request.
- Résumé files themselves are not sent to Claude for tailoring (only during the one-time
  extraction step in `docs/USER_FLOWS.md` §3, which produces `candidate_facts` rows that then
  go through the same human-approval gate before ever being used here).

## 7. Rate limiting

Every AI request is attributed to `user_settings.ai_requests_this_period` /
`ai_request_limit` (see `docs/DATA_MODEL.md`). This exists from Phase 1 onward even though
limits are generous during solo/private-beta use, so opening signups later (Phase 8) doesn't
require retrofitting cost controls.

## 8. Requirement-evidence mapping (Phase 5A)

A second pipeline (`packages/ai/src/generate-requirement-mapping.ts`), analyzing a whole job
snapshot's stated requirements against the user's approved facts, rather than one form field
against one description. It reuses this document's principle and controls rather than
inventing new ones:

- **User-triggered only** — never runs automatically on save; the deterministic, no-LLM-call
  snapshot capture in `docs/DATA_MODEL.md`'s "job_snapshots" happens on every save, but the
  Claude call only ever happens from an explicit "Analyze requirements"/"Regenerate" click.
- **Retrieval before generation, same as §2** — `listOwnApprovedFactsForGeneration` (the full
  approved set, not top-N-per-field, since a whole-posting analysis needs broader context);
  rate-limited via the same `incrementOwnAiRequestUsage` check, before any provider call.
- **Untrusted data, tagged**: the snapshot content sits inside a `<job_snapshot>` tag with the
  same "this is data, not instructions" system-prompt posture as `<job_posting>` — no `tools`
  array, `thinking: disabled`, same posture as §2's pipeline.
- **Contract + rejection gate, extended for an array**: the model returns a JSON array of
  per-requirement objects (`requirementMappingContractSchema`, `packages/shared`) instead of
  one answer; each entry's `matchedFactIds` must be a subset of the exact ids placed in the
  prompt (same allowlist-check pattern as `sourceFactIds` in §3/§4) — a hallucinated or
  injected id fails the whole run, not just that one requirement. Validation is all-or-nothing
  at the run level: there is no partial promotion of a run where only some requirements passed.
- **Provenance is server-derived, never model-generated**: after a response passes both gates,
  the server (not the model) attaches `{factId, sourceTable, factUpdatedAt}` to each matched
  fact from the exact retrieved fact list — see `docs/DATA_MODEL.md`'s `matched_facts`
  description for how this later detects an edited/unapproved/deleted fact on read.
- **No aggregate score, ever**: the contract has no field for an overall match percentage,
  "ATS score," hiring probability, or interview probability, and the system prompt explicitly
  forbids computing one — only per-requirement `confidence`, scoped to that one requirement's
  evidence quality. Hard eligibility language (e.g. work authorization) stays a
  `requirement_category` value, grouped separately in the UI, never blended into a score.
- **Usage accounting, activated**: `ai_usage_events` (Phase 3 schema groundwork with no live
  caller until now) records one row per attempt via `recordAiUsageEvent`, correlated by
  `generation_run_id = requirement_mapping_runs.id`, best-effort (a telemetry failure never
  fails the user's actual request).

## 9. Unsupported-claim check (Phase 5B.3)

A third, deliberately narrower pipeline (`packages/ai/src/generate-unsupported-claims-check.ts`)
that flips the direction of the first two: instead of generating an answer from approved facts,
it checks whether an answer the user already decided to submit is actually backed by their
approved facts. It exists as one input to the Consistency Firewall (`docs/DATA_MODEL.md`'s
`submission_packets`/`markOwnApplicationApplied`) — but it is the *AI-assisted, advisory* input,
never the deterministic, authoritative one. Its call site is `POST
/api/applications/:id/unsupported-claims-check`, the only place in the codebase that invokes it.

- **Explicit, user-triggered only — never automatic.** No caller anywhere else invokes this
  route or the underlying pipeline: not on page load, not on extension popup open, not from the
  deterministic `GET /api/applications/:id/consistency-check`, not on every generated-answer
  edit, not from `markOwnApplicationApplied`/Mark Applied, not from a background job, not from
  Gmail sync. The dashboard's `MarkAppliedPanel` exposes it as a separate "Check unsupported
  claims" button inside the review step, fired only on click.
- **Always advisory, never blocking, never authoritative.** Every finding this pipeline can
  produce has `severity: 'WARNING'` — hardcoded in `generate-unsupported-claims-check.ts`, not
  model-controlled — and `ruleId: 'UNSUPPORTED_CLAIM'`. Its output is never passed into
  `markOwnApplicationApplied`'s `acknowledgedFindingIds` gate and never required to be
  acknowledged to submit; a model can never be the thing that stops a submission. The
  deterministic consistency-rule engine (`packages/shared/src/lib/consistency-rules.ts`) remains
  the sole authority for BLOCKING/WARNING findings enforced at mark-applied time. As of the
  Phase 5B hardening pass, this is now also a schema-level invariant, not just a code-review-time
  convention: `consistencyFindingSchema`'s `.superRefine` (`packages/shared/src/schemas/
  consistency-finding.ts`) rejects any finding pairing an AI-assisted rule id
  (`AI_ASSISTED_RULE_IDS`) with `severity: 'BLOCKING'` outright — defense in depth, not the only
  check, since the hardcoded `severity: 'WARNING'` above remains the actual load-bearing control.
- **Retrieval before generation, same as §2/§8.** Only `generated_answers` rows the user actually
  decided to use (`userDecision IN ('APPROVED', 'EDITED')`) are checked — a skipped or
  never-decided suggestion was never going to be submitted, so there is no claim to check. Facts
  come from the same `listOwnApprovedFactsForGeneration` retrieval as every other pipeline in
  this document — never an unapproved fact, never the full profile.
- **Untrusted data, tagged, same posture as §2/§8.** The user turn carries `<candidate_answers>`
  and `<candidate_facts>` tagged sections; the static system prompt
  (`build-unsupported-claim-system-prompt.ts`) instructs the model to treat their contents as
  data, not instructions, and never as this prompt's source. No `tools` array, `thinking:
  disabled`.
- **Positional contract, not id-echoed.** The model returns a JSON array of
  `{supportStatus, citedFactIds, explanation}` objects — one entry per answer sent, in the exact
  same order — rather than being asked to echo back an answer id (deliberately, to remove one
  more thing the model could hallucinate or mismatch). `validateUnsupportedClaimContract` rejects
  outright, before ever consulting the fact-id allowlist, if the returned array's length doesn't
  exactly match the number of answers sent (`reason: 'wrong_length'`) — a length mismatch means
  there is no safe way to know which entry maps to which answer, so it is never guessed.
- **Citation allowlist, same defense as §8.** Every `citedFactIds` entry across every array
  element must be an id that was actually placed in `<candidate_facts>` for that attempt — a
  hallucinated or prompt-injected id rejects the whole response (`reason:
  'unknown_source_fact_id'`), never just that one entry.
- **Conservative by design.** The system prompt explicitly instructs the model to prefer
  `UNCERTAIN` over guessing, and that "style differences, paraphrasing, or a
  plausible-but-unstated inference are not by themselves reasons to mark something UNSUPPORTED."
  Only `UNSUPPORTED` entries become findings; `SUPPORTED` and `UNCERTAIN` produce nothing — an
  uncertain result is not itself a claim to flag.
- **One retry, same policy as §8.** Exactly one retry, and only on a rejection (malformed JSON,
  schema violation, wrong length, an unallowlisted citation, or a refusal) — never on a hard
  `provider_error`. A `provider_error` surfaces to the caller as "unavailable" immediately.
- **Failure never blocks, never fabricates.** A rate limit, provider error, or a rejection that
  survives the retry all return a non-`ok` status; the API route maps every one of them to HTTP
  200 with `status: 'unavailable'` (or `'no_claims_to_check'` for "nothing to check yet") rather
  than an error — this check can never fail the user's ability to submit. A malformed model
  response is discarded, never surfaced as if it were a real finding.
- **Ephemeral — no persisted run table.** Unlike `requirement_mapping_runs`, this pipeline keeps
  no `PENDING`/`CURRENT`/`FAILED` run row. A fresh `generationRunId` (a plain `randomUUID()`) is
  generated purely to correlate this attempt's `ai_usage_events` row(s); nothing else about a
  given check is persisted anywhere. This was a deliberate scope decision — see
  `docs/IMPLEMENTATION_PLAN.md`'s Phase 5B.3 section for the rationale — rather than an
  oversight: an ephemeral, advisory result was judged sufficient for a check that is never
  authoritative and never frozen into the submission packet.
- **Not part of the frozen packet.** `submission_packets.consistency_findings` freezes only the
  deterministic findings/acknowledgements that gated the actual mark-applied transition. This
  pipeline's findings are never written there — a user can run this check, see nothing
  concerning, submit, and the packet will not contain any record that the check ran at all. The
  authoritative historical record is "what the deterministic gate required and the user
  acknowledged," not "every advisory tool the user happened to run."
- **Usage accounting.** `ai_usage_events.task_type = 'unsupported_claim_check'` (migration 0014),
  recorded best-effort via `recordAiUsageEvent` — a telemetry failure never fails the user's
  actual request. The pipeline's own more granular `'wrong_length'` contract-rejection reason is
  recorded under the shared `rejection_reason` column's existing `'validation_failed'` value
  (the DB's `ai_usage_events.rejection_reason` CHECK constraint was deliberately not widened for
  this one pipeline's more specific internal distinction).
- **Rate-limited, same as every other pipeline** — `incrementOwnAiRequestUsage` is checked first,
  before any retrieval or provider call, and this check consumes the same per-user AI request
  quota as every other Claude call in the system. No separate billing or quota carve-out.

## 10. AI action assistance — follow-up drafting and interview prep (Phase 5C.3)

Two more explicit, user-triggered pipelines
(`packages/ai/src/generate-follow-up-draft.ts`, `generate-interview-prep.ts`), with a different
relationship to a deterministic decision than §8/§9's: the Phase 5C.1 next-action engine
(`packages/shared/src/lib/next-action-rules.ts`) decides *what to do next* with no model
involvement at all; these two pipelines only help *do* it, once the engine has already decided
`CONSIDER_FOLLOW_UP`/`PREPARE_INTERVIEW`. Neither pipeline is ever consulted by, or able to
influence, the engine's own decision — grounding here is about preventing invented facts in the
*assistance*, not about deciding priority or timing.

- **Server-side eligibility gate, before rate limiting.** `packages/ai/src/derive-eligible-next-action.ts`
  re-derives the application's current `NextAction` from the database on every call — the client
  never gets to assert `actionType = PREPARE_INTERVIEW` and have it trusted. Unlike §2/§8/§9, this
  gate runs *before* `incrementOwnAiRequestUsage`: a structurally ineligible request (wrong action,
  application not owned) was never going to produce a result, so it should never cost quota.
- **No fact to invent from, by construction.** Follow-up drafting is never given a recruiter name,
  contact email, referral relationship, interview date, or prior conversation — none of that exists
  anywhere in this schema to place in a prompt. The system prompt additionally lists the exact
  disallowed claim shapes, and `validateFollowUpDraftContract` scans the model's output against a
  fixed denylist of fabrication-risk phrases (`spoke with`, `referred by`, `our interview`,
  `completed the assessment`, etc.), rejecting (with one retry) any match — sound specifically
  because drafting is only reachable while status is `APPLIED`/`APPLICATION_RECEIVED`, strictly
  before any interview/assessment stage exists to have happened.
- **Citation allowlist, same defense as §8/§9, for interview prep.** Every `sourceFactIds` entry
  must be a fact id actually placed in `<candidate_facts>`; every `sourceRequirementId`/
  `sourceRequirementIds` entry must be a requirement-mapping id actually placed in
  `<requirement_mappings>` (or null/empty when no current mapping exists at all). Both allowlists
  are re-derived per request from what was actually retrieved — `validateInterviewPrepContract`
  rejects (with one retry) on any unlisted id.
- **Reuses Phase 5A grounding, never re-runs it.** Interview prep reads an existing `CURRENT`
  requirement-mapping run if one exists (`getCurrentOwnRequirementMappingRun` +
  `listCurrentOwnRequirementMappings`); it never triggers §8's generation pipeline itself, silently
  or otherwise. No current mapping degrades to reading the job snapshot's own qualification lists
  directly, with every requirement id left null/empty, rather than blocking or fabricating ids.
- **Provenance is always server-computed, never a model claim.** Follow-up drafting's `usedContext`
  tags and interview prep's `provenanceSummary`/`usedCurrentRequirementMapping` are assembled from
  what the orchestrator actually retrieved, never asked of the model — deliberately narrower than
  the phase brief's illustrative `groundingNotes` field, which would have let the model write a
  free-text "source" claim that could itself fabricate a source. Same posture as
  `matchedFactProvenanceSchema`'s server-derived provenance in §8.
- **Untrusted content, tagged, same posture as §2/§8/§9.** `<application_context>`, `<job_snapshot>`,
  `<confirmed_employer_email>`, `<candidate_facts>`, `<requirement_mappings>`, and
  `<submitted_answers>` are all explicitly tagged as data, not instructions, in both static system
  prompts. No `tools` array, `thinking: disabled`, same as every other pipeline in this document.
- **Frozen answers, read-only.** Interview prep may surface `submission_packets.answers_snapshot`
  entries (label + truncated final/original answer text) so the user can "stay consistent with
  what you already submitted" — read-only, never reconstructed if missing, never presented as
  current profile data, and never itself sent to the model as something it can alter.
- **One retry, same policy as §8/§9.** Exactly one retry, only on a rejection (malformed JSON,
  schema violation, an unallowlisted citation, a fabrication-risk match, or a refusal) — never on a
  hard `provider_error`, which surfaces immediately.
- **Failure never blocks, never fabricates, never changes application state.** Neither pipeline
  writes to `applications` or calls `changeOwnApplicationStatus`/`markOwnApplicationApplied` at
  all — a rate limit, provider error, or rejection that survives the retry simply returns a
  structured non-`ok` status; the application's status/priority/next action are unaffected.
- **Ephemeral — no persisted result.** Same rationale as §9: no run-lifecycle table, no persisted
  draft/prep row. The only trace of an attempt is the existing `ai_usage_events` telemetry row.
- **Usage accounting.** `ai_usage_events.task_type` in `('follow_up_draft', 'interview_prep')`
  (migration 0016, additive — every prior value preserved), recorded best-effort via
  `recordAiUsageEvent`. Same shared per-user rate limit as every pipeline in this document; no new
  quota dimension.
- **No new Gmail scope, no send capability.** Follow-up drafting reads (never writes) the existing
  `email_signals` metadata (sender/subject/classification/receivedAt for a `CONFIRMED`/`AUTO_APPLIED`
  signal only — never a `PENDING`/`DECLINED` one, never a body, which this codebase never stores at
  all). Its output contract has no recipient field. There is no `gmail.send` scope anywhere in this
  product, and this phase did not add one.

## 11. Grounded résumé tailoring (Phase 7E)

A fourth kind of grounding problem, distinct from §2/§8/§9/§10: this pipeline
(`packages/ai/src/generate-resume-tailoring-plan.ts`) doesn't generate a text answer or check one
— it edits a whole résumé's *content and emphasis* for a specific job. The blast radius of "the
model invented something" is much larger here (a fabricated line lives on the résumé the user
actually sends to an employer), so this pipeline structurally cannot generate the document at all.
The rule stated plainly: **the AI may decide HOW TO EMPHASIZE the candidate's true experience —
reorder it, restate it, choose what to show for this role. It may NEVER invent experience.**

- **The model never returns a résumé, LaTeX, or a JSON Patch.** Its entire output is
  `{operations: [...]}` — a bounded array of one of exactly seven closed operation types
  (`resumeTailoringOperationSchema`, `packages/shared`), each referencing a bullet/entry/skill-
  group purely by an id already present in the base résumé. There is no field anywhere in this
  contract that could carry a whole document, a raw patch, or a LaTeX command — not "validated
  against," structurally absent.
- **The server resolves every structural fact the model would otherwise have to state
  correctly.** Which section a bullet lives in, its current text, its current position — all
  resolved by the server scanning the actual base résumé by id, never taken on the model's word.
  This removes "the model lied about where this is" as an attack surface entirely, rather than
  detecting it after the fact.
- **Retrieval before generation, same principle as §2, adapted for a whole-résumé edit.** The
  base résumé is always the application's current working version, re-derived server-side (never
  a client-supplied id — there is no such parameter). Facts come from the same
  `listOwnApprovedFactsForGeneration` retrieval as every other pipeline in this document — never
  an unapproved fact — selected by a purpose-built, bounded strategy
  (`select-resume-tailoring-facts.ts`) that always includes what the résumé and any current
  requirement mapping already cite, and fills the rest deterministically up to a cap.
- **A current requirement mapping is reused, never generated, same as §8/§10's precedent.** When
  none exists, requirement ids are synthesized directly from the job snapshot's own qualification
  lists (a deliberate difference from §10's interview-prep fallback, which leaves ids null/empty —
  see `docs/IMPLEMENTATION_PLAN.md`'s "Phase 7E" section for why this pipeline needs citable ids to
  exist even without a mapping) — the model is told plainly that grounding quality is reduced in
  this case.
- **Every id is a request-local allowlist entry, same defense as every other pipeline, applied to
  five different id kinds at once.** `bulletId`/`entryId`/`skillGroupId` must exist in the base
  résumé the server itself indexed; `sourceFactId` must be a fact actually placed in
  `<candidate_facts>`; `requirementId` must be a requirement actually offered. A hallucinated,
  prompt-injected, or cross-user id in any of the five rejects the whole plan.
- **Two deterministic, conservative content guards specific to this pipeline** — a numeric-claim
  guard and a named-technology guard — reject any `REWRITE_BULLET`/`ADD_BULLET` that introduces a
  number or a named tool/technology not already present in the bullet being rewritten or a fact
  actually cited for it. Both are explicitly documented as heuristics, not perfect NLP, and both
  are tuned to fail toward over-rejection rather than ever silently accepting a fabricated claim
  (`resume-tailoring-numeric-guard.ts`, `resume-tailoring-technology-guard.ts`).
- **Immutable-by-construction, not by convention.** No operation type has a field for an
  organization, role, school, degree, date, location, or project identity — the schema has nothing
  for the model to change them with. The only way to actually change one of those is the existing,
  fully human-driven Resume Studio (Phase 7D).
- **An internally-contradictory plan is rejected outright, all-or-nothing, same posture as §8's
  run-level validation.** A conflict matrix (`validate-resume-tailoring-plan.ts`) catches e.g. a
  `REWRITE_BULLET` and an `OMIT_BULLET` targeting the same id, or an `ADD_BULLET`/bullet-level
  operation targeting an entry another operation in the same plan also omits — there is no
  "last write wins," the whole plan fails closed.
- **One retry, same policy as every other pipeline in this document.** Exactly one retry, only on
  a rejection (malformed JSON, a schema violation, an unallowlisted id, an operation conflict, an
  out-of-range index, an ungrounded number, an ungrounded technology, or a refusal) — never on a
  hard `provider_error`, which surfaces immediately.
- **No aggregate score, ever, same as §8.** The response has `coverage.coveredRequirementIds`/
  `unsupportedRequirementIds` (a factual partition of the offered requirements, computed entirely
  server-side from what the *validated* plan actually cited) and a per-operation-type `summary` —
  never a single "match" or "ATS score" number, and an unsupported requirement is always surfaced
  explicitly ("no grounded evidence found"), never silently added to make the résumé look more
  matched.
- **Fully ephemeral — nothing is ever saved by this pipeline.** No résumé version is created, no
  working-résumé pointer changes, no submission packet is touched — the response is a read-only
  proposal, and the only durable trace of a generation attempt is the existing `ai_usage_events`
  telemetry row (`task_type: 'resume_tailoring'`, migration 0023), recorded best-effort. Turning
  any part of a proposal into something durable is Phase 7F's job (§12 below), not this pipeline's.
- **Rendering never touches the model.** The proposal's LaTeX preview comes from applying the
  validated plan to a copy of the base résumé (a pure function, `apply-resume-tailoring-plan.ts`)
  and rendering that copy with the existing, unmodified Phase 7C deterministic renderer — the model
  never sees or produces LaTeX at any point in this pipeline.

## 12. Reviewed résumé-tailoring save — provenance and re-grounding (Phase 7F)

Phase 7F (`docs/IMPLEMENTATION_PLAN.md` "Phase 7F") is the layer between §11's ephemeral proposal
and a real, immutable résumé version. It calls no provider at any point — every check below is
deterministic, and the grounding guarantees this section describes are re-verified, never merely
re-displayed, before anything is written.

- **Every operation starts unresolved.** The review UI defaults every operation to `PENDING`,
  never `ACCEPTED` — the same "grounded does not mean the user likes the wording" principle this
  whole system already applies to Claude's output applies equally to the user's own review: silent
  bulk-acceptance would defeat the entire point of a review step.
- **An untouched, accepted operation keeps its original grounding claim.** If the user accepts a
  `REWRITE_BULLET`/`ADD_BULLET` exactly as proposed, its `CANDIDATE_FACTS` provenance and cited
  fact ids carry through unchanged — §11's guards already verified it once, at generation time.
- **An edited operation is honestly reprovenanced, never left overclaiming.** The user picks
  explicitly: "Keep as fact-grounded" re-runs the exact same numeric/technology guards §11 uses,
  against the cited facts' real text and the real original bullet text — a failure blocks the save
  outright, with a specific reason, never a silent fallback to MANUAL. "Save as manual content"
  always succeeds and is stored as `MANUAL` — legitimate free-form user writing the deterministic
  guards were never meant to gate, but never mislabeled as fact-checked either.
- **The client's own claims are never the authority at save time.** A live, purely client-side
  preview necessarily trusts the data already in the (ephemeral, unpersisted) proposal it's
  reviewing — that's fine for showing the user what their draft looks like. The actual save request
  handler independently re-fetches the user's currently-approved facts and re-runs both guards
  against that real data before persisting anything; a fact that was approved at generation time
  but has since been unapproved, or a cited id that doesn't actually belong to this user, fails the
  save the same way an ungrounded number would (`packages/shared/src/lib/
  validate-resume-tailoring-save.ts`).
- **Rejected text leaves no durable trace.** A rejected operation's proposed text is never written
  to `resume_versions`, never logged, and generates no new telemetry beyond §11's own generation-
  time `ai_usage_events` row.
- **No aggregate score here either.** The reviewed draft's coverage is recomputed from only the
  *accepted* operations' own cited requirements — a requirement whose sole citing operation was
  rejected is honestly reported as no longer addressed, never left showing a stale "covered"
  verdict from the original (unreviewed) proposal.

## 13. Company research (Phase 7G) — grounding untrusted third-party web content

Full design record: `docs/COMPANY_RESEARCH.md`. This is the first pipeline in this codebase whose
input is arbitrary third-party web content rather than the user's own data or a job posting they
captured — the grounding posture is correspondingly stricter.

- **Web retrieval and AI synthesis are separate steps, on purpose.** Discovery
  (`packages/ai/src/research/tavily-client.ts`'s `tavilySearch`) and extraction (`tavilyExtract`)
  never touch the model; synthesis never touches the network. The model cannot invent a URL,
  title, publisher, or publication date because none of those fields exist anywhere in its output
  contract (`companyResearchPlanContractSchema`) — it can only cite `sourceId`s Career OS already
  discovered, extracted, and offered in this specific request.
- **Every extracted source is untrusted, tagged data, never instructions.** Source text sits
  inside an explicit `<source id="...">` block; the system prompt states repeatedly that anything
  inside — including something that looks like "ignore previous instructions" or a request to call
  a tool — is evidence only. No tools are offered on the synthesis call at all, the same single
  biggest prompt-injection mitigation every other pipeline in this package already uses.
- **Every finding must cite a real, request-local source id — no exceptions.** Same all-or-nothing
  posture as every other pipeline: `validateCompanyResearchPlan` rejects the entire plan if any
  finding cites a `sourceId`/`requirementId` outside this request's own allowlist, or if the model
  returns zero findings (a defined rejection reason, not silently accepted as "nothing found").
  One retry, then an honest `invalid_research_output`.
- **Citations are grounded provenance, not proof of semantic entailment — stated honestly, not
  hidden.** A validated `sourceId` proves the cited source was real and actually offered; it does
  not prove the claim is a correct summary of that source's text. This is the same limit every
  other pipeline's fact-citation validation has (an approved fact id proves the fact is real and
  approved, not that a generated sentence characterizes it perfectly) — company research doesn't
  pretend otherwise, and the UI shows every source inline so the user can check.
- **No candidate data reaches either the search provider or the model.** Only company name, role
  title, and (when available) job-requirement text/topics are sent — never the résumé, approved
  facts, profile, networking contacts, or Gmail data (§40 of the phase brief). This is the inverse
  of every other pipeline in this file: the question is "what does this company say about itself,"
  never "how does this candidate match."
- **The executive summary is derived, not generated.** `buildCompanyResearchSummary` builds the
  user-facing summary purely from already-validated findings' own `claim` text — there is no
  separate model-authored summary field that could introduce a claim no finding supports.

## 14. Research-aware résumé tailoring (Phase 7H) — a third provenance bucket that never grounds a claim

Extends §11/§12's résumé tailoring, not a new pipeline. The hard rule: **COMPANY RESEARCH MAY
CHANGE RELEVANCE. COMPANY RESEARCH MAY NOT CREATE CANDIDATE FACTS.**

- **Three provenance buckets, never merged.** Every operation may independently cite
  `sourceFactIds` (factual grounding — the only source of truth for "is this true"),
  `requirementIds` (role grounding — "does this address a job requirement"), and now
  `researchFindingIds` (company relevance — "why does emphasizing this matter for this company
  right now"). `validateResumeTailoringPlan` validates each against its own request-local
  allowlist independently; citing a research finding never satisfies the fact-id or requirement-id
  checks, and vice versa.
- **The numeric/technology guards never see research text — this is structural, not a runtime
  check alone.** `evidenceTexts` (the text the guards compare a proposed claim against) is built
  ONLY from cited approved-fact text and, for a rewrite, the original bullet text — company-
  research finding text (`claim`/`roleRelevance`) is never appended to it anywhere in the code, no
  matter how many findings an operation cites via `researchFindingIds`. Concretely: a finding
  stating "Company uses Snowflake" can justify *reordering or keeping visible* a genuinely
  Snowflake-related bullet the candidate already has real evidence for, but citing that same
  finding can never make "Built analytics pipelines with Snowflake" pass the technology guard if
  no approved fact or existing bullet already says so — the guard would reject it exactly as if no
  finding had been cited at all. Verified with dedicated adversarial tests in both
  `validate-resume-tailoring-plan.test.ts` and `generate-resume-tailoring-plan.test.ts` (a
  Snowflake-via-citation rewrite and a $10B-company-metric rewrite, both rejected).
- **`ADD_BULLET` still requires real evidence.** `sourceFactIds.length >= 1` is unchanged;
  `researchFindingIds` can never substitute for it — an add citing only research findings is
  rejected at the schema layer before the deep validator even runs.
- **Research findings are bounded, ranked, and minimized before they ever reach the model.**
  `selectResumeTailoringResearchFindings` (pure, `packages/shared`) selects at most
  `RESEARCH_TAILORING_MAX_FINDINGS` findings, reduced to `{id, category, claim, roleRelevance,
  requirementIds, sourceTypes}` — never full source excerpts, URLs, or the snapshot's other
  findings — same data-minimization posture as §6.
- **The snapshot itself is never trusted from the client.** `resolveResumeTailoringResearchSnapshot`
  re-resolves and ownership/compatibility-checks any requested `companyResearchSnapshotId`
  server-side before it can influence anything (docs/IMPLEMENTATION_PLAN.md "Phase 7H" §6/§7) — a
  stale or foreign snapshot is a real, surfaced rejection, never silently used.
- **Zero additional provider calls.** This pipeline reads an already-persisted Phase 7G snapshot;
  it never calls Tavily and never makes a second Claude call. Résumé tailoring remains exactly one
  attempt plus one retry, `task_type` still `resume_tailoring` — no new telemetry category, no
  double-counted `company_research` event.
- **UI language describes the company, never the candidate (§67 of the phase brief).** "Company
  research suggests this experience is particularly relevant" is correct; "you worked on a company
  priority" is not — the review UI is worded accordingly, and no UUID is ever shown to the user.
