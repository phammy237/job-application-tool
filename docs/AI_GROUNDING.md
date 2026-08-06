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
limits are generous during solo/private-beta use, so opening signups later (Phase 7) doesn't
require retrofitting cost controls.
