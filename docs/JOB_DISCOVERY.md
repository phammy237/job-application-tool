# Job Discovery

Design source of truth for the **Job Discovery Track** (`D1`–`D8`, this document covers
`D1`–`D3`): the front half of Career OS that finds opportunities itself, upstream of the
existing job-analysis/apply/track workflow. See `docs/IMPLEMENTATION_PLAN.md`'s "Job Discovery
Track" roadmap for phase status.

## 1. Purpose

Everything downstream of "the user finds a job" is already strong: job analysis → immutable
snapshot → requirement mapping → company research → résumé tailoring → application autofill →
mark applied → submission packet → Gmail tracking → next actions → interview prep. Nothing in
Career OS helped the user *find* the job in the first place. D1–D3 build the global discovery
catalog and the deterministic ingestion pipeline that keeps it fresh — the foundation the later
ranking/`/discover`/handoff phases (D4+) will sit on top of.

The eventual full flow (only the first box is built in D1–D3):

```
career sites / ATS feeds
        ↓
[D1-D3] Career OS global job catalog  ◄── you are here
        ↓
[D4]  deterministic personalized ranking
        ↓
[D5]  /discover dashboard
        ↓
[D6]  user chooses a job → existing Career OS application workflow
        ↓
tailored résumé + PDF preview/download → open employer application →
extension autofill → user submits manually → Mark Applied →
existing tracker / Gmail / interview workflow
```

## 2. `job_catalog` is NOT `jobs`/`job_snapshots`

Two genuinely different concepts, kept structurally separate:

| | `job_catalog` (this doc) | `jobs` / `job_snapshots` (`docs/DATA_MODEL.md`) |
| --- | --- | --- |
| Answers | "What jobs currently exist on the internet?" | "What job did *this user* decide to analyze/apply to, and what exactly did Career OS know at that moment?" |
| Ownership | Global/shared, no `user_id` — platform data | Per-user (`jobs`); immutable per-user capture (`job_snapshots`) |
| Mutability | Mutable — a posting's content is overwritten in place as it changes on the provider's site | `jobs` mutable (re-extraction overwrites); `job_snapshots` immutable forever once captured |
| Written by | The daily/manual discovery sync only | The extension's extraction flow (`jobs`) and `upsert_application_with_snapshot` (`job_snapshots`) |
| Read by | (D5, not yet built) a future `/discover` dashboard | The existing application workflow throughout |

**D1–D3 never writes to `jobs`, `job_snapshots`, `applications`, or any other existing table.**
Viewing/discovering a catalog job does not create an application, does not create a
`job_snapshot`, and a catalog job disappearing never modifies an existing user's application.
The handoff from a catalog row to "prepare an application" (a real `job`/`job_snapshot`) is
`D6`, explicitly out of scope here — the two systems are upstream/downstream and loosely
coupled by design, not merged.

## 3. Zero AI, by construction

```
Claude calls: 0
Tavily calls: 0
embeddings: 0
LLM parsing: 0
```

D1–D3 is deterministic data engineering: fetch → validate → normalize → hash → upsert →
reconcile. No step anywhere infers, guesses, or generates content — a missing provider field is
always `null`, never fabricated (the same CLAUDE.md "never invent a fact" rule that governs
`packages/ai` applies here too, even though this path never calls a model). See §11 "AI/search
call audit" for the verification.

## 4. Data model (migration `0029_job_discovery_catalog.sql`)

### `job_sources`

Global registry of employer ATS boards. `(source_type, source_identifier)` is unique — the same
board can never be configured twice. `source_type` is a CHECK constraint (`GREENHOUSE`,
`LEVER`, `ASHBY` only for this phase — matching this repo's established preference for CHECK
constraints over enums, see `docs/DATA_MODEL.md`), not a Postgres enum, so adding a provider
later is an additive migration, not a type-widening one. Health fields
(`last_crawled_at`/`last_success_at`/`last_error_at`/`last_error`/`consecutive_failures`) are
updated after every attempted crawl — see §8.

### `job_catalog`

The mutable, global catalog. Key columns beyond the obvious identity/content fields:

- `normalized_title` / `normalized_location` — deterministic comparison/search representations
  (§6), not a predicted role taxonomy.
- `city` / `state_region` / `country` — filled only when a conservative, unambiguous parse is
  possible; `null` otherwise (§6 "Location").
- `dedupe_fingerprint` — a pure helper output for future duplicate *analysis* (§7), never an
  auto-merge key.
- `first_seen_at` / `last_seen_at` / `content_updated_at` — freshness bookkeeping (§9 "Upsert
  semantics").
- `consecutive_misses` / `status` / `closed_at` — the closed-job lifecycle (§9 "Freshness /
  closed-job lifecycle").
- `content_hash` — `"v1:" + sha256hex` of the canonicalized meaningful content
  (`packages/shared/src/lib/job-catalog-content-hash.ts`), the same pattern
  `job_snapshots.content_fingerprint` already established.

### Job identity

The one authoritative identity is `(source_id, source_job_id)`, database-enforced via a unique
constraint. Deliberately **not** `company + title` (two legitimate openings can share a title)
and **not** `canonical_apply_url` (different jobs can share a generic apply page).

## 5. Normalization (`packages/shared/src/lib/`)

All deterministic, no AI:

- `normalize-job-title.ts` — whitespace/punctuation-spacing/case normalization for comparison
  only. Never rewrites semantic meaning ("Sr. Engineer" and "Senior Engineer" stay distinct —
  that's D4's role-taxonomy territory, not this phase's).
- `normalize-company-name.ts` (`normalizeCompanyNameForDedupe`) — conservative: whitespace/case/
  trailing-punctuation only, deliberately does **not** strip legal suffixes ("Inc"/"LLC"/"Ltd"),
  unlike the pre-existing `consistency-rules.ts` helper of a similar name used for a different
  purpose (matching a user-typed company name) — stripping suffixes here would risk merging two
  different legal entities that share a common name.
- `normalize-location.ts` — retains the original text verbatim always; `parseLocation` derives
  structured `city`/`stateRegion`/`country` only for the unambiguous `"City, ST"` (a curated
  US-state-code list) and `"City, <known country name>"` patterns. Multi-location strings
  (`"Seattle, San Francisco, New York City"`), bare city names, and anything else stay
  unparsed — never guessed.
- `canonicalize-url.ts` (pre-existing, reused as-is) — strips query string/fragment, lowercases
  host, drops default port and one trailing slash. Already generic enough to reuse for
  `canonical_apply_url` without modification.
- `job-catalog-content-hash.ts` / `job-catalog-dedupe-fingerprint.ts` — see §4/§7.
- `decode-html-entities.ts` — a small, fixed-entity-set decoder (no DOM parser dependency, since
  this package runs in both Node and the extension's content-script context) for Greenhouse's
  double-encoded `content` field (§10).

## 6. Adapters (`packages/discovery/src/adapters/`)

One shared contract (`packages/discovery/src/types.ts`):

```ts
interface JobSourceAdapter {
  fetchJobs(source): Promise<AdapterFetchResult>;
}
type AdapterFetchResult =
  | { status: 'SUCCESS'; jobs: RawDiscoveredJob[]; rejected: RejectedJob[] }
  | { status: 'FAILURE'; jobs: []; rejected: RejectedJob[]; error: string };
```

`RawDiscoveredJob` (`packages/shared`) is the one common intermediate shape — provider response
shapes never leak past the adapter boundary into normalization/upsert. Every adapter validates
every individual item defensively (missing id/title/apply-URL → rejected, counted, logged —
never thrown) and distinguishes that from "the provider response itself was malformed/
incomplete" (missing top-level envelope, non-2xx HTTP, network error, invalid JSON) — only the
first case allows the crawl to proceed to upsert; the second always returns `FAILURE`, which is
the one thing that gates closed-job reconciliation (§9).

### Greenhouse

`GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true` — verified
against `docs.greenhouse.io/job-board.html` and live boards. `content` (job description HTML) is
entity-decoded (it arrives double-encoded, e.g. `&lt;h2&gt;`). `pay_input_ranges` (behind
`?pay_transparency=true`) exists per the docs, but no live board sampled during this phase
populated it with a non-empty array, so its internal shape could not be confirmed — salary is
left `null` for Greenhouse rather than guessed (CLAUDE.md "never invent a fact"). No
`workplaceType`/structured qualifications/responsibilities field exists in this API at all — all
description content lives in the one `content` field.

### Lever

`GET https://api.lever.co/v0/postings/{site}?mode=json` — verified against
`github.com/lever/postings-api` and live boards. `workplaceType` (`unspecified | on-site | remote
| hybrid`) and optional `salaryRange` (`{min, max, currency, interval}`) map directly. Lever
posting objects carry no company-name field of their own — `companyName` always comes from the
configured `job_sources` row.

### Ashby

`GET https://api.ashbyhq.com/posting-api/job-board/{boardName}?includeCompensation=true`. The
dedicated public-reference page for this exact unauthenticated endpoint could not be located
(Ashby's `/reference/*` docs describe a different, authenticated API) — every field this adapter
reads was instead confirmed against real, live board responses during implementation, not
guessed. `compensation.summaryComponents` entries with `compensationType: "Salary"` carry
`minValue`/`maxValue`/`currencyCode`. `isListed: false` postings are silently excluded (not a
rejection — the provider itself marks them non-public).

Every adapter has fixture-based tests (`packages/discovery/src/adapters/*.test.ts`,
`__fixtures__/`) covering: a normal posting, nullable/missing optional fields, a malformed
individual item, and an invalid top-level response — no live-network dependency in the test
suite itself (the fixtures were seeded from real responses, then hand-edited for edge cases).

## 7. Deduplication

Guaranteed **within** a source by `(source_id, source_job_id)` — the database uniqueness
constraint, not application logic, is the real guarantee. A duplicate provider id appearing
twice in one crawl response is handled deterministically (first occurrence wins, the rest count
as rejected) both in the orchestrator (`syncSource`) and, as a last-resort safety net, inside
`upsertDiscoveredJobsForSource` itself (a duplicate `ON CONFLICT` target twice in one SQL
statement is a hard database error, not a soft one).

**Cross-source** dedup is deliberately conservative and *not* automated in this phase:
`dedupe_fingerprint` (normalized company + title + location + canonical apply URL) is computed
and stored for every row as a pure helper output, available for future analysis, but D1–D3 never
merges two different provider records based on it — false merging is worse than a temporary
duplicate discovery record. One company normally has one authoritative ATS source in the initial
registry, which substantially reduces how often this would even come up.

## 8. Ingestion orchestrator (`packages/discovery/src/orchestrator/`)

`syncSource` (one source, `sync-source.ts`): select adapter by `source_type` → `fetchJobs` →
(on `SUCCESS`) dedupe by provider id → normalize → `upsertDiscoveredJobsForSource` → **only
then** `reconcileMissingJobsForSource` → `recordJobSourceCrawlSuccess`. On `FAILURE`:
`recordJobSourceCrawlFailure` and return immediately — upsert/reconcile are never reached, so a
failed crawl can never touch any existing row's status or miss-count.

`runDiscoverySync` (all due sources, `run-sync.ts`): loops `syncSource` over every source,
catching an unexpected throw from any single source and recording it as that source's own
failure (§10 "Failure isolation") — a source list of `N` always produces `N` results, and one
broken company never stops the loop.

## 9. Upsert semantics / freshness / closed-job lifecycle

No custom Postgres RPC — `packages/database/src/queries/job-catalog.ts` implements this with two
batched PostgREST round trips (a pre-fetch of existing rows by `source_job_id`, then
differentiated writes), which comfortably covers the "hundreds of sources / tens of thousands of
jobs" scale target (§12) without the added risk of a hand-written upsert-with-classification SQL
function. See that file's own doc comments for why this was the deliberate choice over a
service-role RPC (CLAUDE.md: "don't add service-role RPCs gratuitously when normal batched
operations suffice").

**Upsert** (`upsertDiscoveredJobsForSource`, called with every job seen on a successful crawl):

| case | result |
| --- | --- |
| new `source_job_id` | insert: `status=ACTIVE`, `first_seen_at = last_seen_at = now`, `misses=0` |
| existing, same `content_hash` | touch only `last_seen_at`/`misses=0`/`status=ACTIVE`/`closed_at=null` — `first_seen_at` and `content_updated_at` untouched, content columns untouched |
| existing, changed `content_hash` | rewrite content + `content_updated_at=now`, `last_seen_at=now`, `misses=0`, `status=ACTIVE`, `closed_at=null` — `first_seen_at` preserved |
| previously `CLOSED`, reappears | reopened: same row, `status=ACTIVE`, `misses=0`, `closed_at=null` — never a duplicate row |

**Reconciliation** (`reconcileMissingJobsForSource`, called *only* after a successful upsert of a
complete crawl): every `ACTIVE`/`POSSIBLY_CLOSED` row for the source whose `source_job_id` wasn't
in this crawl's seen set gets `consecutive_misses += 1`; a resulting value of `1` →
`POSSIBLY_CLOSED`, `>= 2` → `CLOSED` (`closed_at` set the first time it enters `CLOSED`). A
`CLOSED` row is excluded from this query — a closed job re-missing again doesn't do anything
further; reopening is handled entirely by the upsert path above, whenever the job is seen again.

This exact state machine is covered by the lifecycle scenarios from the original design spec
(A–I), split across `packages/database/src/queries/job-catalog.test.ts` (upsert/reconcile
scenarios A, B, C, D, E, G, H — using a deterministic in-memory fake of the exact PostgREST call
shapes the query layer issues) and `packages/discovery/src/orchestrator/sync-source.test.ts`
(scenario F "a failed crawl leaves every row untouched," and scenario I "one malformed posting
doesn't fail the crawl," which are orchestrator-level, not query-layer, behaviors).

## 10. Failure isolation

```
for each source:
    try sync(source)
    catch:
       record failure
       continue
```

A 404/500/network error/invalid response from one company's board records that source's failure
and moves on — the daily run for every other company continues unaffected. A genuinely
catastrophic failure (e.g. Supabase credentials entirely invalid) is different: it isn't caught
by per-source isolation at all if it happens *before* the loop even starts (listing which sources
are due for crawl), and if it manifests inside the loop (every write failing with the same
underlying error), `scripts/discovery/sync.ts` treats "every attempted source failed" as a
systemic failure and exits non-zero — the CLI never prints "0 jobs synced" as if the run were
healthy when the run was actually broken.

Source health (`job_sources.last_crawled_at`/`last_success_at`/`last_error_at`/`last_error`/
`consecutive_failures`) is updated after every attempted crawl regardless of outcome.
`last_error` is bounded to 2000 characters and sanitized to a plain message — never a raw
provider response body, stack trace, or secret (enforced both in `recordJobSourceCrawlFailure`
and by a database CHECK constraint as a second, independent backstop).

## 11. AI/search call audit

Grep-verified: no import of `@career-os/ai`, no `fetch` to `api.anthropic.com` or `api.tavily.com`,
no embeddings anywhere in `packages/discovery`, `packages/database`'s new
`job-sources.ts`/`job-catalog.ts`, or `scripts/discovery/`. The daily GitHub Actions workflow
(`.github/workflows/job-discovery-sync.yml`) declares only `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` as required secrets — it cannot reach Claude/Tavily/Google even if it
wanted to, since those credentials are never in its environment.

## 12. Scale assumptions

Designed for hundreds of configured companies, tens of thousands of active jobs, daily refresh —
not prematurely architected for millions of jobs. Indexes on `job_catalog`:
`(source_id, source_job_id)` (unique identity), `(source_id, status)` (reconciliation's own
lookup), `status` (global filtering), `last_seen_at` / `posted_at` (freshness-ordered reads),
`content_hash` (future duplicate-content analysis), `dedupe_fingerprint` (future cross-source
analysis, partial index). Batch sizes in `job-catalog.ts` (chunked existing-row lookups, chunked
upserts, chunked freshness-only updates) avoid N+1 PostgREST calls for a source with thousands of
postings without needing a custom RPC.

## 13. Security / write boundary

- `job_sources`: RLS enabled, **no policy for `anon` or `authenticated`** — every access
  (including reads) goes through the service-role ingestion path. There is no current
  user-facing surface that needs to read it.
- `job_catalog`: RLS enabled, **select-only policy for `authenticated`** (`using (true)`) — it's
  exactly the data a future `/discover` dashboard (D5) will need to read, and it carries nothing
  sensitive (no `user_id`, no private content). No policy for `anon` (no public route exists
  yet). No insert/update/delete policy for `authenticated` on either table.
- Every write happens exclusively through the service-role admin client
  (`createSupabaseAdminClient`), which bypasses RLS as a role property — the same posture
  CLAUDE.md already requires for every other privileged global operation in this codebase.
  `packages/database`'s query functions never trust a client-supplied id for anything security-
  relevant (there is no client in this path at all — only the CLI/GitHub Actions worker calls
  these functions).
- Deliberately **no `user_id` column** on either table — these are genuinely global, shared
  records, and adding one merely to fit the repo's usual RLS template would fabricate an owner
  that doesn't exist (CLAUDE.md is explicit that no table should get `user_id` "to fit" a
  pattern that doesn't apply).
- pgTAP coverage: `supabase/tests/database/0032_job_discovery_catalog.test.sql` (30 assertions,
  live-verified against the linked Supabase project) — anon/authenticated read/write denial on
  both tables (including the RLS nuance that `UPDATE`/`DELETE` silently match zero rows rather
  than erroring, unlike `INSERT`'s `WITH CHECK` failure), service-role writes succeeding, both
  uniqueness constraints, every CHECK constraint, the `updated_at` trigger's attachment, and the
  `job_sources → job_catalog` FK cascade.

## 14. Non-AI design (recap)

No step in `packages/discovery`, the new `packages/database` query functions, or
`scripts/discovery/` calls Claude, Tavily, or any embedding model — see §11. Company research
(Phase 7G, `packages/ai`) is completely untouched by this track; the two systems don't share code
or call paths.

## 15. Manual ingestion CLI

```bash
npm run discovery:sync -- [--source <id>] [--provider GREENHOUSE|LEVER|ASHBY] [--limit <n>] [--dry-run]
npm run discovery:import-sources -- <path-to-sources.json> [--dry-run]
```

`discovery:sync` loads every enabled source whose `crawl_interval_hours` has elapsed since
`last_crawled_at` (or that has never been crawled), syncs each via `runDiscoverySync`, prints a
structured per-source log line plus a final aggregate summary, and exits non-zero only if every
attempted source failed (§10). `discovery:import-sources` validates a JSON source file with Zod
and idempotently upserts each entry keyed on `(sourceType, sourceIdentifier)` — an omitted
optional field (`enabled`/`crawlIntervalHours`/`careersUrl`) is left untouched on an existing row
rather than reset to a default, so re-running the same file never clobbers operational tuning
(e.g. an operator disabling a noisy source). `scripts/discovery/sources.sample.json` is a real,
live-verified starter set spanning all three providers (Stripe/Greenhouse, Palantir+Pipedrive/
Lever, Ramp+Notion+Vanta+Linear/Ashby).

## 16. Daily automation

`.github/workflows/job-discovery-sync.yml` — daily cron (`workflow_dispatch` also available for
manual triggering), a `concurrency` group so two crawls never overlap, a 30-minute timeout, and
only the two Supabase secrets in its environment (§11). Runs `npm run discovery:sync` as-is —
the exact same script a developer runs locally — and then, only if that step succeeds, `npm run
discovery:rank` (no `--user-id`). See §53 for why the second step exists and what it does and
does not change.

## 18. D4 — Deterministic feature extraction, user-configurable ranking, and eligibility

D4 answers three deliberately separate questions about a (user, job) pair — never collapsed into
one number (a non-negotiable product decision):

| Question | Output | Notes |
| --- | --- | --- |
| **Match** — "how well does this fit what the user wants and can credibly bring?" | 0–100, user-weighted | `computeMatchScore` |
| **Eligibility** — "does the posting conflict with the user's self-reported eligibility?" | `ELIGIBLE` / `UNKNOWN` / `CONFLICT` | a separate rules engine, never folded into Match |
| **Coverage** — "how much of the user's enabled scoring model could we actually evaluate?" | 0–100%, data coverage | NOT statistical confidence |

Zero AI: no Claude/Tavily/embedding call anywhere in D4 (§25 below is the audit). Career OS owns
the supported criteria/checks; users choose importance and preferences within them, never
arbitrary executable rules.

## 19. Job feature model (`job_catalog_features`, one row per `job_catalog` row)

Global, user-independent, deterministic — computed once per job (per `feature_version`), reused
for every user's scoring. Every classification field uses an explicit `'UNKNOWN'` enum member
(unlike `job_catalog` itself, which uses `null`) since this table exists specifically to represent
"what could Career OS determine" as a first-class value. Computed by
`extractJobCatalogFeatures` (`packages/shared/src/lib/extract-job-catalog-features.ts`), which
combines every extractor below — pure, synchronous, no I/O.

- `plainTextDescription` — `htmlToPlainText(job_catalog.description)` (§20).
- `roleFamily`, `seniority` — title-only classification (§21).
- `isInternship`, `isNewGrad` — derived from `normalizedEmploymentType` OR title patterns, so
  Greenhouse (which never supplies `employment_type`) still gets a correct internship flag from
  the title alone.
- `normalizedEmploymentType`, `normalizedWorkplaceType` (§22).
- `locationTokens` (§23).
- `extractedCompetencyCodes` (§24).
- `requiredYearsMin`/`Max`, `graduationYearMin`/`Max` — conservative regex extraction from
  `plainTextDescription`, guarded against confusing a graduation year/company age/revenue figure
  with years of experience (only inside a sentence mentioning both "experience" and "year(s)").
- `sponsorshipSignal`, `citizenshipRequirement`, `clearanceRequirement`,
  `workAuthorizationRequirement`, `evidence` — §26.
- `contentHashAtExtraction`, `featureVersion` — staleness detection (§29).

## 20. HTML → plain text (`packages/shared/src/lib/html-to-plain-text.ts`)

Regex-based (no `DOMParser` dependency — this package runs in Node and the extension content-
script/service-worker, neither guaranteed to have one). `<script>`/`<style>` blocks are removed
entirely, including their content. Block-level tags' *closing* tag (and `<br>`) becomes a line
break; the matching opening tag is stripped silently, so two adjacent blocks produce exactly one
line break, not two. Entities are decoded (reuses `decodeHtmlEntities`). Whitespace is collapsed
within a line; runs of blank lines collapse to one. The raw `description` column is never
modified — every extractor downstream (role/seniority/competency/experience/graduation/
sponsorship/citizenship/clearance) runs on the derived plain text, never the HTML.

## 21. Role family / seniority extraction

Both are **title-only** in V1 (no description fallback) — job-description keyword scanning is
noisy (boilerplate, "nice to have" lists) and a wrong guess is worse than UNKNOWN.

**Role family** (`extract-role-family.ts`): `PRODUCT_MANAGEMENT`, `TECHNICAL_PROGRAM_MANAGEMENT`,
`PRODUCT_ANALYTICS`, `DATA_ANALYTICS`, `DATA_SCIENCE`, `SOFTWARE_ENGINEERING`,
`BUSINESS_ANALYTICS`, `STRATEGY_OPERATIONS`, `CONSULTING`, `UNKNOWN`. An ordered, phrase-matched
rule list, most-specific first (`"technical program manager"` before any generic manager rule) —
no company-specific branches (a genuinely ambiguous, company-specific title like Palantir's
"Deployment Strategist" is honestly `UNKNOWN`, not force-fit).

**Seniority** (`extract-seniority.ts`): `INTERN`, `NEW_GRAD`, `ENTRY`, `MID`, `SENIOR`, `STAFF`,
`PRINCIPAL`, `MANAGER`, `DIRECTOR_PLUS`, `UNKNOWN`. Only the explicit signals the design spec
named are used — there is deliberately no rule for `ENTRY`/`MID` (a plain "Software Engineer"
title stays `UNKNOWN`, never guessed as `MID`). A dedicated wrinkle: many titles legitimately
contain "manager" as a *functional* label (Product Manager, Program Manager, Technical Program
Manager, Account Manager) without indicating a people-management level — a denylist of those
phrases is checked before the generic `MANAGER` rule, so "Product Manager" is `UNKNOWN` seniority
(correct — it says nothing about level), while "Engineering Manager" is `MANAGER`.

Phrase matching (`phrase-matcher.ts`) uses lookaround (`(?<![A-Za-z0-9])...(?![A-Za-z0-9])`), not
plain regex `\b`, so it correctly matches phrases that themselves end in punctuation ("C++",
"Sr.") — plain `\b` never matches at the boundary between two non-word characters (e.g. "+" then
a space), which would otherwise silently break those specific phrases.

## 22. Employment type / workplace type normalization

**Employment type** (`normalize-employment-type.ts`): raw `job_catalog.employment_type` → `FULL_TIME`
/ `PART_TIME` / `CONTRACT` / `INTERNSHIP` / `TEMPORARY` / `UNKNOWN`. Live data showed 8+ distinct
raw spellings for ~5 categories, including within one provider (Lever: "Full Time" vs
"Full-time") — normalization strips whitespace/punctuation/case before matching. `null` (100% of
Greenhouse) always maps to `UNKNOWN`, never a guessed default.

**Workplace type** (`normalize-workplace-type.ts`): prefers the structured `job_catalog.workplace_type`
value; only when that's `null` does it fall back to a conservative phrase scan of `location_text`
ALONE (never the full description — too noisy). ONSITE is never inferred from the mere absence of
a "remote"/"hybrid" phrase.

## 23. Location tokens (`extract-location-tokens.ts`)

A *separate, additive* module from D1-D3's `parseLocation` — `job_catalog`'s own `city`/
`state_region`/`country` columns are untouched. No geocoding: a small deterministic alias table
sufficient for preference *matching*. Multi-location postings are preserved as multiple tokens
(split on the unambiguous `;` separator, confirmed live e.g. `"New York, NY; San Francisco, CA"`)
— comma-only multi-city strings (`"Seattle, San Francisco, New York City"`) stay unparsed, the
same conservative call D1-D3 already made. Equivalent raw strings normalize to the same token:
`"New York, NY (HQ)"`, `"New York, NY"`, and `"New York, New York"` all produce `NEW_YORK_NY`
(trailing parenthetical stripped; both 2-letter state codes and full state names recognized).
`"UK"` and `"United Kingdom"` both produce `UNITED_KINGDOM`. An empty array means UNKNOWN — never
a guessed "primary" location.

## 24. Competency / skill fit

A small, explicit, alias-based concept registry (`competency-registry.ts`) — not a naive keyword
count, not a speculative ontology. Concepts are justified by observed candidate vocabulary,
observed catalog vocabulary, and the target role families (technical: SQL, Python, JavaScript/
TypeScript, C++/C#, data analysis, machine learning; product/business: product strategy, product
analytics, experimentation, customer research, roadmap, stakeholder management, cross-functional
collaboration, project/program management, B2B, technical fluency). Every match is word/phrase-
boundary safe (§21's lookaround technique) — bare single-letter language names ("R", "C", "Go")
are deliberately excluded as too ambiguous; "C++"/"C#" are included since they're unambiguous. A
concept is counted once regardless of repetition in the source text.

Candidate-side evidence (`deriveOwnCandidateCompetencyCodes`, `packages/database`) comes
**exclusively** from trusted, approved profile data — `skills.name` (matched directly, already a
high-trust structured label), `experiences`/`projects` descriptions, and `candidate_facts.normalizedValue`,
every one gated on `userApproved && approvedForApplications` (the same grounding rule
`docs/AI_GROUNDING.md` defines for `packages/ai`, applied here even with zero AI). `education` is
inspected but contributes nothing (school/degree/GPA text carries no competency vocabulary).

`COMPETENCY_FIT` = `|job concepts ∩ candidate concepts| / |job concepts|` — `null` (UNKNOWN) when
the job has zero extracted concepts (nothing to evaluate against), never when the candidate
simply matches none of them (that's a real, known `0` fit, not UNKNOWN — see §27).

## 25. Sponsorship / work-authorization / citizenship / clearance extraction

All in `packages/shared/src/lib/extract-{sponsorship-signal,work-authorization-requirement,
citizenship-requirement,clearance-requirement}.ts` — explicit phrase rules, sentence-scoped,
each returning a bounded (300-char) evidence snippet alongside the classification. Silence always
means `UNKNOWN`, never a guess.

- **Sponsorship**: `AVAILABLE` / `NOT_AVAILABLE` / `UNKNOWN`. Negative phrases checked first
  ("unable to sponsor", "no sponsorship", "must not require sponsorship now or in the future",
  "without sponsorship"); positive phrases second ("sponsorship available", "we sponsor H-1B",
  "OPT/CPT candidates welcome").
- **Work authorization**: a *narrower*, separate signal from sponsorship — "must be authorized to
  work" style language, but explicitly excluding any sentence that also mentions "sponsor" (that
  sentence belongs to the sponsorship extractor; the same statement is never double-counted into
  two checks).
- **Citizenship**: V1 covers only the dominant explicit US-market pattern ("US citizens only",
  "must be a US citizen") — not a general nationality parser.
- **Clearance**: distinguishes `ACTIVE_CLEARANCE_REQUIRED` (already-held) from
  `CLEARANCE_ELIGIBILITY_REQUIRED` (merely eligible to obtain) — not interchangeable. Live-data
  fix: a real Palantir phrase, *"Active clearance or an ability to obtain an active clearance in
  the country the job is advertised"*, is explicitly classified `CLEARANCE_ELIGIBILITY_REQUIRED`
  (the posting itself offers the more permissive bar as an alternative), not the stricter
  category — caught by the live ranking run against the real catalog (§31) and fixed by widening
  the extractor with an "eligibility qualifier" check, not by touching the eligibility rules
  engine itself.

None of these extractors ever infer from company identity, size, industry, location, or silence
— and D4 makes no web search of any kind.

## 26. Discovery Scoring Profile (`discovery_scoring_profiles`, user-owned)

One row per user (`getOrCreateOwnScoringProfile`, same get-or-create safe-fallback pattern as
`getOrCreateOwnUserSettings`), created with DB-column BALANCED-preset defaults on first access.
Fields:

- `preset` — `BALANCED` / `CAREER_FIT_FIRST` / `LOCATION_FIRST` / `CUSTOM`. **One scoring engine**
  — a preset only pre-populates the same editable fields below; it never forks the algorithm.
- `criteriaWeights` — `{criterion: 0-10}` for the seven V1 criteria (`ROLE_FIT`, `COMPETENCY_FIT`,
  `SENIORITY_FIT`, `LOCATION_FIT`, `WORK_MODE_FIT`, `EMPLOYMENT_TYPE_FIT`, `OBSERVED_FRESHNESS`).
  `0` disables a criterion — excluded entirely from scoring and coverage, not scored as
  zero-fit. Values do **not** need to sum to 100; normalization happens at scoring time (§27).
  Deliberately excludes salary, ATS provider, company popularity/prestige, applicant counts,
  employer size, and raw provider `posted_at` — see §31 for why each was left out.
- `rolePreferences`, `seniorityPreferences` — `{value: 0-10}` maps. A value the job has but the
  user never rated is `UNKNOWN` for that criterion (see §27's missing-data symmetry), not an
  implicit 0 — a deliberate interpretation this document flags explicitly since the design spec
  didn't literally say what to do with an *unrated* known value.
- `locationPreferences` — `{locationToken: 'PREFERRED'|'ACCEPTABLE'|'AVOID'|'EXCLUDE'}`.
  `PREFERRED`=1.0, `ACCEPTABLE`=0.7, `AVOID`=0.2 fit constants. `EXCLUDE` is a **hard personal
  filter**, not a score — a job with any `EXCLUDE`-matching location token is removed from
  consideration entirely (no `user_job_match_scores` row is written for it at all), never merely
  scored 0. This is a *discovery preference*, structurally distinct from Eligibility (§28) — never
  labeled a "conflict."
- `workModePreferences`, `employmentTypePreferences` — `{value: 0-10}` maps, same symmetry rule.

RLS: standard four-policy pattern (`docs/DATA_MODEL.md` "RLS policy pattern") — a user can read/
update only their own row, same as `profiles`/`candidate_facts`. Chosen over the "select-only,
service-role-write" posture (`job_snapshots`' pattern) specifically because D5 will let users edit
this directly through their own session; D4's CLI (`scripts/discovery/set-profile.ts`) writes
through the service-role admin client today, which works identically either way.

## 27. Match-score math / UNKNOWN handling / Coverage

```
matchScore = Σ(weight·fit) / Σ(weight for KNOWN enabled criteria) × 100
coverage   = Σ(weight for KNOWN enabled)  / Σ(weight for ALL enabled)  × 100
```

(`computeMatchScore`, `packages/shared/src/lib/match-score.ts`) — reproduces the design spec's
own worked example exactly (weights Role 10/Competency 9/Seniority 8/Location 7/WorkMode 4/
Freshness 2, one UNKNOWN criterion → 87.78 match, 90% coverage).

- A criterion with weight `0` is **disabled** — excluded from both sums entirely (not "missing
  data", the user turned it off).
- A criterion with weight `> 0` but `fit: null` (UNKNOWN) is excluded from the match-score
  numerator/denominator but **does** count toward the coverage denominator — that's what makes
  Coverage fall when provider data is sparse or the user hasn't rated a value the job has.
- Never divides by zero: if nothing is both enabled and known, `matchScore = 0` (not thrown) — a
  job Career OS can say nothing about defaults to the bottom of a ranked list, never the top. If
  nothing is enabled at all, `coverage = 0`.
- `evaluateCriteria` (`evaluate-criteria.ts`) is the per-criterion fit layer that feeds this —
  every "missing data never penalizes" rule lives there, applied **symmetrically** to missing job
  data (extractor returned UNKNOWN) and missing user data (job has a known value the user never
  rated).

**A load-bearing finding from the live run (§31)**: sorting purely by `matchScore` surfaces a real
pathology — jobs where almost every criterion is UNKNOWN except one lucky `OBSERVED_FRESHNESS=1.0`
(a job discovered in the last two days) land at `matchScore: 100` with `coverage` as low as 4%.
The math is correct (100% of what little was knowable was a perfect fit) but the result is
uninformative. **D5 must never rank by `matchScore` alone** — pairing it with a coverage
floor/weighting is necessary for a useful list. This is a UX/ranking-composition finding for D5 to
own, not a D4 engine defect (confirmed: filtering the same live results to `coverage >= 60%`
produces a highly sensible, preference-aligned top list — see §31).

## 28. Eligibility architecture

A **separate rules engine** (`packages/shared/src/lib/evaluate-eligibility.ts` +
`eligibility-aggregation.ts`) — never `+N`/`-N` points folded into Match.

**Profile** (`discovery_eligibility_profiles`, user-owned, standard four-policy RLS, same
get-or-create pattern as the scoring profile): `currentlyAuthorizedToWork`,
`requiresSponsorshipNow`, `requiresSponsorshipFuture`, `isUsCitizen`, `hasActiveSecurityClearance`,
`eligibleToObtainSecurityClearance`, `graduationYear` — every field nullable, defaulting to `null`
("hasn't told us"), never inferred. `currentlyAuthorizedToWork` and the two sponsorship fields are
deliberately three separate fields, never collapsed — an F-1/OPT-style candidate is commonly
*currently* authorized (via OPT) while also genuinely *requiring future* sponsorship (e.g. H-1B);
conflating those would misrepresent a very common real situation. CPT/OPT status is never assumed
to satisfy an employer's stated requirement — only the user's own explicit answers are read.

**Check types**: `SPONSORSHIP`, `WORK_AUTHORIZATION`, `CITIZENSHIP`, `SECURITY_CLEARANCE`,
`GRADUATION_WINDOW`. Deliberately excludes years-of-experience and skill mismatch — those stay
Match-only (a JD's "3+ years" is routinely wishlist language, not a hard legal bar).

**Per-check relevance**: each of the five evaluators returns `null` (meaning: omit this check
entirely from the result) whenever it isn't *applicable* — the user never answered the relevant
question, or the posting never made the relevant statement. There is no fourth "not applicable"
status; omission from the `checks[]` array *is* the "not applicable" signal. Example: `SPONSORSHIP`
is only ever produced when the user has said `requiresSponsorshipNow` or `requiresSponsorshipFuture`
is `true` — a user who doesn't need sponsorship gets no `SPONSORSHIP` check at all, even against a
posting with restrictive language (never muddied into a false conflict).

**Aggregation** (`aggregateEligibility`): any `CONFLICT` → overall `CONFLICT`; else any `UNKNOWN`
→ overall `UNKNOWN`; else (including zero applicable checks) → `ELIGIBLE`. **Documented semantics,
deliberately precise**: `"ELIGIBLE"` means *"Career OS found no conflict among the explicit
eligibility requirements it could evaluate from this posting and the user's self-reported
profile"* — it is **not** *"the employer will accept this applicant."* A user with an entirely
empty eligibility profile gets `ELIGIBLE` on every job (vacuously — there's nothing to conflict
with); D5's copy should account for this rather than implying a stronger guarantee.

Each check carries a stable `reasonCode`, a template-generated (never AI-generated) `explanation`,
a bounded `evidenceText` when the conclusion came from posting text, and a `sourceField`.

## 29. Persistence, versioning, and recomputation

Four tables (migration `0030_job_discovery_ranking.sql`):

| Table | Ownership | RLS | Written by |
| --- | --- | --- | --- |
| `job_catalog_features` | global | `authenticated` select-only (like `job_catalog`) | `scripts/discovery/extract-features.ts` (service-role) |
| `discovery_scoring_profiles` | user | standard 4-policy | the user's own session (future D5), or the dev CLI (service-role) |
| `discovery_eligibility_profiles` | user | standard 4-policy | same as above |
| `user_job_match_scores` | user | select-only, scoped to caller (like `job_snapshots`) | `scripts/discovery/rank.ts` (service-role) only |

`user_job_match_scores` keeps **exactly one current row per `(user_id, job_catalog_id)`**
(`unique` constraint, upserted in place) — V1 deliberately keeps no score history.

Three independent version strings, each stamped onto every `job_catalog_features`/
`user_job_match_scores` row at compute time: `featureVersion` (`d4-features-v2` — bumped once
already, live, after the clearance-extractor fix in §25/§31), `rankingVersion` (`d4-ranking-v1`,
the Match/Coverage math), `eligibilityVersion` (`d4-eligibility-v1`, the eligibility rules).
Recomputation is explicit, not a queue: `listJobCatalogRowsNeedingFeatureRecompute` finds every
job whose `content_hash_at_extraction` or `feature_version` no longer matches current reality;
`scripts/discovery/rank.ts` always runs feature extraction first, then re-scores every user with a
scoring profile. Both are idempotent — confirmed live (§31): a second `extract-features` run finds
0 candidates, a second `rank` run reproduces identical counts.

**A real bug this recomputation path caught live** (§31): the first "fetch every `job_catalog`
row" implementation used a plain `.select()` with no pagination and a 500-UUID `.in()` chunk size.
Against the real 1,371-row catalog this (a) silently returned only PostgREST's default 1,000-row
page, and (b) overflowed the ~16KB HTTP header limit on the `.in()` filter
(`HeadersOverflowError`), confirmed via the exact live error. Fixed in
`packages/database/src/queries/job-catalog-features.ts`: every "fetch all rows" query now pages
explicitly in chunks of 1,000, and the `.in()` id-lookup chunk size was reduced from 500 to 150.
Both fixes are covered by unit tests and reverified against the live 1,371-job catalog afterward.

## 30. Provider bias audit

Dedicated test suite: `packages/discovery/src/ranking/provider-fairness.test.ts` — three
`RawDiscoveredJob` fixtures shaped exactly as each real adapter would produce them (Greenhouse:
`employmentType`/`workplaceType` always `null`; Lever: `employmentType` known, `workplaceType`
often `null`; Ashby: both known), identical title/location/description/company otherwise. Proves,
as executable tests: (1) criteria available equally across providers (role/competency/seniority/
location/freshness) produce identical Match Score and Coverage regardless of provider; (2) a
provider's structurally-missing fields lower Coverage but never the Match Score itself (UNKNOWN is
excluded from the numerator/denominator, not averaged toward zero); (3) an UNKNOWN criterion is
never mathematically equivalent to a real, known mismatch (0% vs 100% coverage distinguishes
them); (4) salary/provider/`posted_at` are not inputs to Match at all — they aren't in the
criterion registry.

**Live decomposition** (§31 has the full numbers): the real run showed Greenhouse/Stripe's average
Match Score notably lower than Lever/Ashby's for one test persona. Decomposed before concluding
anything: Greenhouse's own `ROLE_FIT`-when-known average (0.465) is actually *higher* than
Lever's (0.238) — ruling out an anti-Greenhouse scoring bias. The real driver: Stripe (this
catalog's one Greenhouse source) posts proportionally more `SOFTWARE_ENGINEERING`-classified
roles, which this specific test persona rated `2/10`, *and* Greenhouse's structural data gaps mean
there are fewer other known criteria available to offset that one low, correctly-known fit. This
is the ranking system correctly reflecting a genuine difference in the underlying job mix — not a
provider-identity bug — verified both by the isolated unit tests and by this live-data
decomposition.

## 31. Live ranking analysis (real 1,371-job catalog)

Run against every real Greenhouse/Lever/Ashby job ingested by D1-D3, with one representative
test scoring/eligibility profile (a PM/TPM/analytics-leaning persona, an F-1/OPT-style candidate
currently authorized but requiring future sponsorship) applied via a disposable test `auth.users`
account (created and deleted via the Supabase Admin API for this verification only — never a
hardcoded id in code).

```
Jobs considered (ACTIVE):         1,371
Jobs scored:                      1,326
Excluded by EXCLUDE preference:      45   (all matched the test profile's SINGAPORE = EXCLUDE)

Role family (global):    UNKNOWN 885 · SOFTWARE_ENGINEERING 340 · PRODUCT_MANAGEMENT 40 ·
                          CONSULTING 41 · STRATEGY_OPERATIONS 23 · DATA_SCIENCE 12 ·
                          TECHNICAL_PROGRAM_MANAGEMENT 20 · DATA_ANALYTICS 9 · PRODUCT_ANALYTICS 1
Seniority (global):      UNKNOWN 875 · MANAGER 217 · SENIOR 72 · STAFF 58 · INTERN 51 ·
                          NEW_GRAD 48 · DIRECTOR_PLUS 39 · PRINCIPAL 11

Eligibility distribution: UNKNOWN 1,322 · CONFLICT 3 · ELIGIBLE 1
  - All 3 CONFLICTs: GRADUATION_WINDOW_MISMATCH (Notion internships requiring a 2027 grad
    class; the test profile's graduationYear was 2026) — correctly detected and evidenced.
  - SPONSORSHIP: 1,325 UNKNOWN / 1 ELIGIBLE / 0 CONFLICT — almost no posting in this catalog
    states an explicit sponsorship policy (matches D1-D3's own text-mining findings).
  - WORK_AUTHORIZATION: 24 ELIGIBLE (0 UNKNOWN/CONFLICT — always resolvable once applicable).
  - CITIZENSHIP / SECURITY_CLEARANCE: 0 postings in the whole 1,371-job catalog contain
    explicit citizenship-only language; exactly 1 contains explicit clearance language (the
    live-data fix in §25/§29).

Coverage:  min 4.35% · p25 23.9% · median 43.5% · p75 60.9% · max 100% · avg 44.2%
Match:     min 18.18 · median 52.11 · avg 52.5 · max 100.00

Average Match by provider:  ASHBY 61.7 (cov 58.0) · LEVER 67.8 (cov 52.1) ·
                             GREENHOUSE 38.0 (cov 30.5) — see §30 for the fairness decomposition.

UNKNOWN rate by criterion:  SENIORITY_FIT 87.3% · LOCATION_FIT 67.6% · ROLE_FIT 64.0% ·
                            WORK_MODE_FIT 48.9% · EMPLOYMENT_TYPE_FIT 45.0% ·
                            COMPETENCY_FIT 32.4% · OBSERVED_FRESHNESS 0.0% (always known)
```

**Idempotency, confirmed live**: `extract-features` run twice → 1,371 then 0 candidates. `rank`
run twice → identical `1371 considered / 1326 scored / 45 excluded` both times.

**Top 25 by coverage-filtered Match** (`coverage >= 60%` — see §27 for why unfiltered `matchScore`
alone is misleading) is dominated by exactly the roles this test persona's preferences predict:
Technical Program Manager (Palantir, 92.4/85.2), Product Manager (Ramp/Linear/Vanta, 69.7-73.2),
Forward Deployed Software Engineer/TPM roles (Palantir). **Bottom 25** is entirely Stripe generalist
roles (sales, recruiting, operations, various "Manager" functional titles) the persona rated low —
confirming the engine's output is preference-driven, not arbitrary.

## 32. Manual CLI (D4 additions)

```bash
npm run discovery:extract-features                       # recompute stale job_catalog_features
npm run discovery:rank -- [--user-id <uuid>]              # recompute user_job_match_scores;
                                                           # no --user-id ranks every user with
                                                           # a scoring profile (never a hardcoded id)
npm run discovery:set-profile -- --user-id <uuid> <file>  # dev-only profile configuration,
                                                           # Zod-validated, D5 will replace this
                                                           # with a real settings UI
```

`discovery:rank` always runs feature extraction first (cheap, idempotent) so scoring never runs
against stale features.

## 33. Future phases (explicitly deferred, not built here)

```
[x] D1 — Global job catalog + source registry
[x] D2 — Greenhouse / Lever / Ashby ingestion
[x] D3 — Freshness, lifecycle, daily synchronization
[x] D4 — Deterministic feature extraction + personalized ranking + eligibility
[x] D5A — /discover feed: search, deterministic filters, default ranking, job details
[ ] D5B — Editable scoring/eligibility preferences UI (currently CLI-only, see §32)
[ ] D5C — AI-generated explanations / semantic search on top of the deterministic D5A feed
[ ] D6 — Discovery → existing Career OS application handoff
[ ] D7 — Generic company career-site crawler
[ ] D8 — Feedback-driven ranking
```

Not built in D4, on purpose: `/discover` UI, job cards, "See details" modal, preference/settings
UI (D5's job — D4's backend output is explicitly shaped so D5 can render `Match: 91 · Eligibility:
Eligible · Coverage: 84%` plus a full component/check breakdown without recomputation), arbitrary
user-created executable criteria, formula scripting, AI ranking, embeddings, behavioral learning,
automatic hidden weight adjustments, application/interview/offer probability, salary ranking,
company prestige scoring, the catalog→application handoff, generic HTML crawling, Workday/
LinkedIn/Indeed/ZipRecruiter support, any extension change, résumé/PDF changes. A future D8
behavioral-learning phase should *suggest* preference changes, never silently change a user's
explicitly-chosen weights — user control is a product principle, not a D4-only rule.

**Update, D5A**: the `/discover` UI and job details described above as "D5's job" are now built —
see §34-39. Still explicitly not built: the preference/settings UI itself (D5B — `/discover`
reads whatever scoring/eligibility profile already exists via the D4 CLI, it does not let a user
create or edit one), AI-generated explanations or semantic search (D5C), and every other item in
the "not built" list above (still true verbatim for D5A — no AI ranking, no embeddings, no
behavioral learning, no application handoff).

## 34. D5A — `/discover` feed and detail pages

The first user-facing surface over D4's output: `apps/web/app/(app)/discover/page.tsx` (list) and
`apps/web/app/(app)/discover/[id]/page.tsx` (detail), following the same server-component +
`<form method="get">` + dedicated-detail-route pattern already established by `/applications` and
`/network` — no drawer/sheet component exists anywhere in `packages/ui`, so a dedicated route was
the correct architectural choice per that precedent, not a new one invented for this feature.
Both pages read exclusively through `packages/database/src/queries/discovery-feed.ts`
(`listOwnDiscoveryFeed`, `listDiscoveryLocationTokens`, `getOwnDiscoveryFeedJobDetail`) — every
number a user sees is a value D4 already persisted in `user_job_match_scores`/
`job_catalog_features`/`job_catalog`; nothing is recomputed in React. Auth/RLS: both pages call
`requireUser()` for the auth gate and a session-scoped `createClient()` (never the service-role
admin client) for every read, exactly the pattern every other `apps/web` page already uses; the
feed/location RPCs are additionally scoped by their own `auth.uid()` binding (§36).

Nav: `{ href: '/discover', label: 'Discover' }` added to `NAV_ITEMS` in
`apps/web/app/(app)/layout.tsx`, positioned right after Dashboard — no new shell, header, or nav
pattern.

## 35. Default discovery order

The D4 live audit (§31) found that a naive `ORDER BY match_score DESC` surfaces low-Coverage
noise at the top — a job where almost every criterion is UNKNOWN except one lucky
`OBSERVED_FRESHNESS: 1.0` can hit `match_score: 100` with `coverage` as low as ~4%; this build's
own live verification (§39) reproduced exactly that shape on a real Stripe posting. The fix is
explicitly not a composite score (Match × Coverage is never computed anywhere in this product) —
it is a two-level, documented sort: **coverage tier first, Match within the tier second.**

Single source of truth, pure and unit-tested: `packages/shared/src/lib/default-discovery-order.ts`
— `getCoverageBucket(coverage)` classifies `HIGH` (coverage >= 60), `MODERATE` (30-59), or `LOW`
(< 30); `compareForDefaultDiscoveryOrder` sorts bucket ascending, then `matchScore` descending,
then `jobCatalogId` ascending as a final deterministic tiebreaker (never provider identity, never
insertion order — a dedicated test documents this guarantee). The 60%/30% thresholds are not
arbitrary: they're the D4 live audit's own measured 75th (60.9%) and 25th (23.9%) coverage
percentiles (§31) — HIGH starts where coverage is comfortably informative, LOW ends where it's
comfortably uninformative.

This rule is mirrored, never re-derived, as a `GENERATED ALWAYS ... STORED` SQL column
(`user_job_match_scores.coverage_bucket`, migration `0031_job_discovery_feed.sql`) so it can be
indexed and sorted on directly — Postgres cannot use an index for an `ORDER BY` over an ad-hoc
`CASE` expression computed at query time. `isLowCoverage(coverage)` (same file) is the exact LOW-
bucket check the UI's "Limited job data" notice uses (§38), so the visual warning and the ranking
behavior can never drift apart from each other.

## 36. Search and filters

`list_own_discovery_feed` (migration `0031_job_discovery_feed.sql`) is the one query the feed
issues — a `SECURITY INVOKER` Postgres RPC, not a service-role function: it grants no privilege
the calling `authenticated` user doesn't already have via RLS (`job_catalog`/
`job_catalog_features` are already authenticated-select-all; `user_job_match_scores`' own RLS
already restricts a caller to their own rows), it just does a genuine 3-table join with several
optional filters and a computed-column-first sort in one indexed round trip — something
PostgREST's embedded-resource filtering cannot express, and that would otherwise mean fetching
unbounded intermediate result sets to join/sort/paginate in application code (the exact
"fetch the whole catalog into memory" anti-pattern D4's own live-verification bugs, §39, warn
against repeating). The explicit `ujms.user_id = auth.uid()` filter inside the function body is
redundant with RLS by design — defense-in-depth, and it lets the query planner use the covering
index directly.

Search is deterministic substring matching only — `ILIKE '%term%'` across title/company/location,
backed by `pg_trgm` GIN indexes (`job_catalog_title_trgm_idx`, `job_catalog_company_name_trgm_idx`)
so it doesn't degrade to a sequential scan as the catalog grows. No AI, no fuzzy matching, no
embeddings — a standard, well-understood Postgres extension, not a new external dependency.

Filters, all optional and combinable: role family, location (a single token from
`list_discovery_location_tokens`, matched via `location_tokens @> array[token]`), workplace type,
employment type, eligibility result (the only one of the four enum filters that includes `UNKNOWN`
as a valid target — role/workplace/employment's own `UNKNOWN` member is excluded from the filter
UI, since "filter to unknown role" isn't a meaningful positive intent the way "show me jobs I
can't yet evaluate eligibility for" is), min Match, min Coverage, and freshness (days since
`first_seen_at`). Every filter's parsing lives in one place —
`packages/shared/src/schemas/discovery-feed-query.ts`'s `parseDiscoveryFeedQuery` — a Zod
`safeParse` that never throws: an unrecognized enum value is silently dropped (a stale bookmarked
URL degrades to "no filter," not an error page), numeric filters are clamped to sane ranges, and a
malformed `page` defaults to 1. The `/discover` filter UI itself exposes single-value dropdowns
(one role, one workplace type, etc. at a time) — the parser's own array support exists for
forward-compatible deep-linking, not because the current UI offers multi-select; a future
iteration could add checkbox groups without any query-layer change.

`list_discovery_location_tokens` is a second small RPC serving the location filter's own options
— `job_catalog_features.location_tokens` is an array column PostgREST cannot `unnest`/`distinct`
in a plain `select()`, and flattening every row's array in application code just to populate a
dropdown is wasteful; `unnest`+`distinct`+`limit 200` server-side is the correct-sized tool here.

Both RPCs are granted to `authenticated` only — **and explicitly revoked from `anon`, not just
`public`**, a real bug this build's own live verification caught (§39): Supabase's platform-level
default privileges grant `anon`/`authenticated`/`service_role` EXECUTE on every function in
`public` directly, so `revoke ... from public` alone left both functions callable by an anonymous
request with zero error. Fixed at the source (migration 0031 itself, before it shipped) and now
covered by a pgTAP assertion (`supabase/tests/database/0034_job_discovery_feed.test.sql`) so a
future RPC in this codebase that repeats the "revoke from public only" mistake would need to
consciously break this same assertion pattern to go unnoticed.

## 37. Pagination strategy

`listOwnDiscoveryFeed` (`packages/database/src/queries/discovery-feed.ts`) requests `pageSize + 1`
rows from the RPC and slices the extra one off in application code to derive `hasNextPage`,
deliberately instead of a `count(*) over()` total-row count: that approach has no sane answer for
a page requested past the end of the result set, and computing an exact total row count on every
request is extra work the UI doesn't actually need (`/discover` shows "Page N" plus Previous/Next,
never "showing N of TOTAL"). This is the same discipline behind D4's own two live-caught bugs
(§39 and the D4 entry in `docs/IMPLEMENTATION_PLAN.md`) — PostgREST's default 1,000-row cap on an
unbounded `select()`, and an oversized `.in()` filter chunk overflowing the ~16KB HTTP header
limit — neither of which this query shape can reproduce: it is always exactly one indexed,
server-side `LIMIT`/`OFFSET` round trip, never a client-side fetch-everything-then-filter.

URL state: `q, role, location, workplace, employment, eligibility, minMatch, minCoverage,
freshness, page` are the only query params `/discover` reads, all parsed by the same
`parseDiscoveryFeedQuery` described in §36. Prev/Next links rebuild the full query string with
only `page` replaced (`buildPageHref` in `apps/web/app/(app)/discover/page.tsx`) so paging never
silently drops an active filter; changing a filter via the form naturally resets to page 1 (the
form has no `page` field).

## 38. Match/Coverage/Eligibility presentation, low-coverage treatment, and eligibility UI

Enforced structurally, not just by convention: `MatchCoverageEligibility`
(`apps/web/app/(app)/discover/match-coverage-eligibility.tsx`) is the one place Match, Coverage,
and Eligibility are laid out together, reused by both the feed's job cards and the detail page's
summary header — three separate labeled values (`Match 78%` / `Coverage 65%` / an eligibility
badge), never combined into one number, never a star rating, never "Perfect match"/"Bad match"
language, never a red/green pass-fail color scheme. `EligibilityBadge`
(`apps/web/app/(app)/discover/eligibility-badge.tsx`) maps the three real statuses to calm,
always-text-labeled variants — `ELIGIBLE` → "No conflicts found" (not "Eligible," which would
overclaim an employer decision Career OS cannot make), `UNKNOWN` → "Eligibility unknown",
`CONFLICT` → "Possible conflict" (the only variant that reads as an alert, since a real conflict
between the posting and the user's profile deserves visibility).

A result in the LOW coverage bucket (§35's `isLowCoverage`) shows a subtle "Limited job data"
notice under its Match/Coverage row — never hidden by default, never claiming the score is
"inaccurate," never inventing a numeric confidence figure D4 never computed. Low-coverage results
are still shown (just ranked lower by §35's default order); nothing in D5A filters them out
unless the user explicitly sets a min-Coverage filter.

The detail page's Match breakdown (`apps/web/app/(app)/discover/[id]/match-breakdown.tsx`) renders
the persisted `score_components` array exactly as `computeMatchScore` produced it
(`packages/shared/src/lib/match-score.ts`) — a criterion with `weight: 0` (the user's own scoring
profile turned it off) is omitted entirely rather than shown as "0% fit"; a criterion with
`weight > 0` but `known: false` shows "Not evaluated for this posting," never a fabricated
percentage. The detail page's eligibility section
(`apps/web/app/(app)/discover/[id]/eligibility-checks.tsx`) renders the persisted
`eligibility_checks` array verbatim — each check's `type`, its already-deterministic `explanation`
(template text naming both the posting's requirement and the user's own profile fact, produced by
`evaluateEligibility`, §28 — never re-derived or paraphrased here), and its `evidenceText` when
present; a CONFLICT check gets a visually distinct destructive-tinted border, and the section
always carries an explicit disclaimer: "Career OS cannot determine the employer's actual hiring
decision." A check that doesn't apply to this user/posting combination was never added to the
array by `evaluateEligibility` in the first place (§28's "omission, not a fourth status" rule) —
D5A renders that as "None of the eligibility checks Career OS runs... applied to this posting,"
never a synthetic "N/A" row. "View original posting" links through the existing
`isSafeExternalUrl` validator (`packages/shared/src/lib/is-safe-external-url.ts`, unchanged),
preferring `job_catalog.sourceUrl` and falling back to `canonicalApplyUrl`/`applyUrl` (the latter
is non-nullable, so a link is always available when at least one candidate URL passes the safety
check).

## 39. D5A live verification (real 1,371-job catalog)

pgTAP: `supabase/tests/database/0034_job_discovery_feed.test.sql`, 26/26 assertions — the
generated `coverage_bucket` column's three thresholds, `list_own_discovery_feed`'s default order
and every filter (role/workplace/employment/eligibility/min-Match/min-Coverage/search/location/
freshness) against hand-built fixtures, exact-count pagination including past-the-end, cross-user
isolation through the RPC itself (a second user's own row on the *same* job never appears in, or
leaks its value into, the first user's result), `list_discovery_location_tokens`'s exact distinct
set, and the `anon`-cannot-call fix described in §36.

Live run: a disposable test `auth.users` account (created via the Supabase Admin API, password
sign-in used to mint a real session — not a service-role bypass — deleted afterward, never a
hardcoded id in code) configured with a software-engineering-leaning `CUSTOM` profile
(`requiresSponsorshipNow: true`, `isUsCitizen: false`, `graduationYear: 2026`) and ranked via
`discovery:rank` against the full real catalog (1,371 jobs considered, 1,371 scored).

```
Top-25 default order: HIGH-coverage (65-74%) Software/Security Engineer roles at Vanta, Linear,
  Stripe, Ramp — match_score strictly non-increasing within each coverage tier, confirmed.
Eligibility distribution (this profile): UNKNOWN 200+ · CONFLICT 3 · ELIGIBLE 1 — all 3 CONFLICTs
  are real GRADUATION_WINDOW_MISMATCH cases (Notion internships requiring a 2027 grad class vs.
  this profile's 2026), each rendering the full explanation + evidence text correctly through the
  real `getOwnDiscoveryFeedJobDetail` composer.
Low-coverage/high-match reproduction: 5 real Stripe postings at coverage 5.71% / match_score
  100.00 (coverage_bucket = 2/LOW) — exactly the D4-audit pattern §35's default order exists to
  push down, and exactly what triggers the "Limited job data" notice; confirmed both jobs sort
  after every HIGH/MODERATE result and are never hidden.
Filters against real data: workplace=REMOTE → 200+ results (capped by the verification query's own
  limit, not the RPC); employment=INTERNSHIP → 41; search="engineer" → 200+ (capped); pagination
  offset 20/limit 20 boundary confirmed non-overlapping and contiguous with offset 0.
```

**AI/search-provider audit**: zero references to `@career-os/ai`, Tavily, Claude, or embeddings
anywhere in the D5A code path (`apps/web/app/(app)/discover/**`, `packages/database/src/queries/
discovery-feed.ts`, `packages/shared`'s new discovery-feed files, migration 0031) — confirmed by
grep, not just by construction.

Cleanup: the disposable test user and every row it produced (`user_job_match_scores`,
`discovery_scoring_profiles`, `discovery_eligibility_profiles`) were deleted/cascade-deleted and
confirmed at zero afterward — no residue left in the linked project.

## 40. D5B — `/settings/discovery`: user-facing scoring/eligibility preferences

The developer/CLI-only path (`scripts/discovery/set-profile.ts`) is now also a real authenticated
UI: `apps/web/app/(app)/settings/discovery/page.tsx` loads the caller's own
`discovery_scoring_profiles`/`discovery_eligibility_profiles` rows via the exact same
`getOrCreateOwnScoringProfile`/`getOrCreateOwnEligibilityProfile` functions the CLI already used
(never a separate frontend default — a fresh user gets the same DB-column BALANCED-preset/all-
null defaults either way, migration 0030), and a client form
(`discovery-settings-form.tsx`) lets the user edit every field D4 already persists. No new
migration, no new table, no new RPC — `discovery_scoring_profiles`/`discovery_eligibility_profiles`
already use standard 4-policy RLS (§26/§28), so reading/writing them through the caller's own
session was already possible; D5B only adds the UI and the one new save/recompute endpoint below.
Reachable from `/discover` via an "Edit preferences" link in the page header; a successful save
offers "View updated jobs" back to `/discover`.

**Scoring section ("What matters to you")**: renders `ALL_SCORING_CRITERIA` (the same closed,
seven-member D4 registry, §26/§27) — each with an enable/disable checkbox and a 0-10 numeric
input, never a slider (per the spec's own "allow precise 0-10 values" requirement, a plain
`<input type=number>` gives that for free without extra keyboard-accessibility work a custom
slider would need). Disabled (`weight: 0`) is visually and textually distinct from "enabled but
this job's evidence was UNKNOWN" — the settings page has no per-job data to show the latter at
all, so it never renders that state; the section intro explicitly tells the user the two are
different concepts, pointing at `/discover/[id]`'s "Not evaluated for this posting" as where the
UNKNOWN case actually shows up. Preference maps (role family, seniority, work mode, employment
type) share one small `PreferenceWeightEditor` — an add/remove list built from `packages/ui`'s
existing `Select`/`Input`/`Button`, no tag-input library. Removing a rated value deletes the map
key entirely (back to UNKNOWN for that user, §26/§27's "missing user data" case) rather than
setting it to `0` (which would mean something different: an explicit "I rated this a zero," §27's
disabled-equivalent case for a *preference value* rather than a criterion). Location preferences
get their own `LocationPreferenceEditor` (category picker: Preferred/Acceptable/Avoid/Exclude
entirely) since they're category-based, not a 0-10 weight — its copy calls out that "Exclude
entirely" is a hard personal filter, not part of Match (§26). Competency: the settings page never
lets a user manually enter skills/competencies here — only a weight for how much competency
alignment matters — with a direct link to `/profile` next to that row, since
`deriveOwnCandidateCompetencyCodes` (§24) already derives the actual competency set from approved
profile data exclusively; duplicating that as editable text here would create a second, divergent
source of truth, which this UI deliberately does not do.

**Eligibility section**: the same seven `discovery_eligibility_profiles` fields (§28) as tri-state
Yes/No/Unknown selects (`EligibilityBooleanField`) plus a plain numeric graduation-year field —
never a checkbox, since a checkbox has no clean third state and every one of these fields is
genuinely nullable (`null` = "hasn't told us," never inferred, never defaulted to No). No field is
required; leaving everything at Unknown is a fully valid, save-able state. Copy matches the spec's
required semantics exactly ("Eligibility settings are used to identify stated conflicts... They do
not affect your Match score" / "Career OS detects conflicts with requirements explicitly stated in
a posting. It cannot determine whether an employer will make an exception or ultimately consider a
candidate.") — no "you qualify"/"you can work here" language anywhere on the page (a dedicated
regression test asserts this).

## 41. Save/recompute lifecycle and no-op detection

`POST /api/discovery/settings` (not a server action — like `/api/gmail/sync`, it needs to return a
rich result a plain action doesn't model as naturally): `userId` comes only from `getCurrentUser()`
(the verified session), never the request body. Validates the payload against
`discoverySettingsRequestSchema` (`packages/shared`, composed via `.omit()` from the *existing*
`discoveryScoringProfileSchema`/`discoveryEligibilityProfileSchema` — never a redefined shape that
could drift), then compares it against the currently-persisted profiles via
`computeDiscoverySettingsChanges` before writing anything.

**No-op detection is a plain, order-independent deep-equality comparison, not a new hash/version
system** — deliberately: `discovery_scoring_profiles.profile_version` is a *schema-shape* version
(bumped when the row's own columns change), not a content hash of one user's chosen values, and
`rankingVersion`/`featureVersion`/`eligibilityVersion` version the *engine's rules*, not a user's
preference data; neither answers "did this specific save actually change anything," so reusing
either would have been reusing the wrong tool. `computeDiscoverySettingsChanges`
(`packages/shared/src/lib/discovery-settings-diff.ts`) key-sorts every `jsonb` preference map
before comparing (`{A,B}` and `{B,A}` are the same map, never a false "changed") and trims the
current persisted profile down to exactly the request's own field shape via the same Zod schema
(so a resubmit with a stale `updatedAt` is still correctly recognized as a no-op). A true no-op
writes nothing and never calls `rankJobsForUser` at all — live-verified (§43): a resubmit of the
exact persisted state left `discovery_scoring_profiles.updated_at`/
`discovery_eligibility_profiles.updated_at`/every `user_job_match_scores.computed_at` completely
unchanged.

**Which profile changed determines both what gets written and what the user is told** — this is
the one place D5B distinguishes "scoring changed" from "eligibility changed" per the spec's
required copy:

```
both unchanged  -> no writes, no recompute, "No changes to save."
scoring only    -> write scoring profile only, recompute, "Your job matches have been updated."
eligibility only-> write eligibility profile only, recompute, "Your eligibility results have been updated."
both changed    -> write both, recompute, "Your discovery results have been updated."
```

**Recompute itself is never split into a "scoring-only" or "eligibility-only" pass** —
`rankJobsForUser` (`packages/discovery`, unchanged, §29) always evaluates Match+Coverage+
Eligibility together for every job in one pass; there is no finer-grained recompute mode in the
engine, and D5B does not add one (that would mean forking or duplicating the scoring engine, which
the spec explicitly forbids). The honest framing is: no-op detection avoids recomputing when
*nothing* changed; once *anything* changed, the existing single recompute path runs exactly once,
and the message shown reflects which profile the user actually edited, not which parts of the
recompute pass happened to touch which numbers.

**Failure semantics — no misleading partial state**: a malformed payload -> `400`, nothing
touched. A profile-persistence failure -> `500`, reports exactly which profile(s) didn't save,
recompute never attempted (recomputing against a possibly-inconsistent partial write would be
worse than not recomputing). Both profile writes succeed but `rankJobsForUser` itself throws ->
`502`, `recompute: { attempted: true, succeeded: false }` — the saved preferences are real and
will be used the next time ranking runs (a retried save, or the next scheduled `discovery:rank`),
but the response never claims jobs were re-ranked when they weren't; the UI shows the server's own
honest error text and never renders "View updated jobs" in that case. Synchronous request/
response by design, same posture as `/api/gmail/sync`'s own `maxDuration = 60` — no queue system
added solely for this: a save only ever happens while the user has the page open and clicks Save.

**Recompute needs the service-role admin client** for exactly the write step
(`user_job_match_scores` stays select-only for `authenticated`, §29) — the same posture as
`deleteAccount()` in `settings/actions.ts`, the one other place this codebase already needed the
admin client for an operation RLS structurally can't grant an authenticated user directly, with
the id still taken only from the verified session. Reading/writing the two profile rows themselves
uses the ordinary session-scoped client throughout; the admin client is never used for those.

## 42. Scoring/Eligibility independence — proof, not just policy

The spec's core invariant — a scoring change never touches Eligibility, an eligibility change
never touches Match/Coverage — already followed structurally from `rankJobsForUser`'s own code
(`computeMatchScore`/`evaluateCriteria` read only the scoring profile + job features;
`evaluateEligibility` reads only the eligibility profile + job features; neither function's
inputs or outputs cross into the other, §27/§28). D5B adds two direct regression tests proving
this against the real orchestrator (`packages/discovery/src/ranking/rank-user.test.ts`, "D5B
independence invariants"), not a UI-level or API-route-level mock:

- **Invariant A**: holding the job/features/scoring-profile fixed, running `rankJobsForUser` once
  per eligibility profile (one with no sponsorship requirement, one requiring sponsorship against
  a job that states none is available — a real, non-vacuous `CONFLICT`) asserts `matchScore` and
  `coverage` are `toBe`-identical (not merely close) across the two runs.
- **Invariant B**: holding the job/features/eligibility-profile fixed, running `rankJobsForUser`
  once per scoring profile (`ROLE_FIT` rated 10 vs. rated 2, producing `matchScore: 100` vs. `20`
  — a real, non-trivial difference) asserts `eligibilityStatus` **and the entire `eligibilityChecks`
  array** (`toEqual`, not just the aggregate status) are identical across the two runs.

Both were then reproduced live against the real 1,371-job catalog (§43) — a real scoring-weight
edit through the actual `/settings/discovery` UI changed 289 jobs' `match_score` and all 1,371
`coverage` values while leaving every single `eligibility_status`/`eligibility_checks` value
byte-for-byte identical; a real eligibility-field edit (graduation year) flipped 5 jobs'
`eligibility_status` (a mix of `UNKNOWN` → `CONFLICT` and `CONFLICT` → `UNKNOWN`, non-vacuous)
while leaving all 1,371 `match_score`/`coverage` values byte-for-byte identical.

## 43. D5B live verification (real 1,371-job catalog)

Two disposable test `auth.users` accounts (created via the Supabase Admin API, password sign-in
used to mint real sessions, deleted afterward, never hardcoded ids in code). User A got a `CUSTOM`
scoring profile + a sponsorship/graduation-year eligibility profile via the existing CLI, then
`discovery:rank` (1,371/1,371 scored) to establish a real baseline. Every step below was driven
through the actual running `/settings/discovery` page and `/discover` page in a real headless
Chromium session (Playwright), not a service-role-only fake path:

```
1. /settings/discovery loaded the persisted CUSTOM profile exactly (Role fit weight: 8,
   "Software Engineering" role preference visible) — confirmed live.
2-4. Edited Role fit 8 -> 9 in the real UI, clicked Save. Response: scoringChanged=true,
   eligibilityChanged=false, recompute.succeeded=true, jobsScored=1371. UI showed "Your job
   matches have been updated. 1371 jobs re-ranked..." with a working "View updated jobs" link.
5-6. /discover's top result changed after the save (confirmed live); a full-catalog diff showed
   289 match_score changes and 1371 coverage changes (weights affect the coverage denominator
   too), 0 eligibility_status/eligibility_checks changes — Invariant A held on real data.
7. Restored the original scoring profile via the CLI; a full-catalog diff against the pre-change
   baseline showed 0 changes anywhere — exact restoration confirmed.
8-10. Edited Graduation year 2026 -> 2027 in the real UI, clicked Save. Response:
   scoringChanged=false, eligibilityChanged=true, recompute.succeeded=true. UI showed "Your
   eligibility results have been updated." and never showed the scoring-change message.
11. Full-catalog diff: 5 real eligibility_status changes (UNKNOWN<->CONFLICT, both directions —
   non-vacuous), 7 eligibility_checks changes, 0 match_score changes, 0 coverage changes —
   Invariant B held on real data, byte-for-byte.
12. Restored the original eligibility profile via the CLI; a full-catalog diff showed 0 changes
   anywhere.
```

Also verified live: a true no-op resubmit (the exact persisted scoring+eligibility shape) returned
`scoringChanged: false, eligibilityChanged: false, recompute: { attempted: false }`, and a direct
database check confirmed `discovery_scoring_profiles.updated_at`, `discovery_eligibility_profiles.
updated_at`, and a sampled `user_job_match_scores.computed_at` were all still stamped from the
prior CLI restore — completely untouched by the no-op request. A malformed payload (`preset:
"NOT_REAL"`) returned `400` with per-field Zod errors. An unauthenticated `POST` returned `401`;
an unauthenticated `GET /settings/discovery` redirected to `/login`. A second disposable user (User
B) loading `/settings/discovery` saw their own fresh BALANCED-default profile (Role fit weight: 7,
the migration's own default) — never User A's `CUSTOM` profile or role preference — and User B's
own save (`scoringChanged: true`, 1,371 jobs scored) left every one of User A's 1,371 rows
byte-for-byte unchanged, confirmed via an independent service-role read. Both test users' every
row (`discovery_scoring_profiles`, `discovery_eligibility_profiles`, `user_job_match_scores`) was
confirmed at zero after deletion — no residue left in the linked project.

**Snapshot methodology note**: every live full-catalog comparison paged `user_job_match_scores` in
chunks of 1,000 (never a bare `.select()`) — the exact PostgREST default-row-cap pitfall §29/§39
already document; a plain unbounded fetch against this 1,371-row table would have silently
truncated the verification itself.

**AI/provider audit**: zero references to `@career-os/ai`, Tavily, Claude, or embeddings anywhere
in the D5B code path (`apps/web/app/(app)/settings/discovery/**`, `apps/web/app/api/discovery/**`,
`packages/shared`'s new discovery-settings files) — confirmed by grep.

## 44. D5B — consciously deferred

No new preference semantics were added for UI convenience — every field in the settings form maps
1:1 to an existing `discovery_scoring_profiles`/`discovery_eligibility_profiles` column, and the
preset picker itself was deliberately left out of the UI (a preset only pre-populates the same
editable fields, §26 — there is nothing a preset selector would do that editing the fields
directly doesn't already do more precisely). Explicitly not built, matching the spec: AI
recommendations/explanations, semantic search, embeddings, behavioral learning, automatic weight
tuning, the D6 application handoff, résumé/Gmail changes, and a second scoring system. D5A's
default `/discover` ranking rule (§35) was not touched.

## 45. D6 — discovery → application domain distinction

D6 is a handoff layer, not a new application system. Two concepts stay structurally separate,
exactly as before:

```
job_catalog        = a globally discovered opportunity (D1-D3, mutable, no user_id)
applications        = one user's relationship with an opportunity (unchanged shape + semantics)
```

The only new thing is a **nullable provenance link**, `applications.job_catalog_id`, pointing the
second at the first — never a merge, never a second tracker, never a dependency that makes the
application's own history rely on the catalog row staying unchanged (migration 0032; full column
docs in `docs/DATA_MODEL.md` "applications"). `job_catalog` rows are never hard-deleted by any
existing D1-D3 code path (only status-transitioned `ACTIVE -> POSSIBLY_CLOSED -> CLOSED`), so in
practice this FK's `on delete set null` almost never fires — but it's the correct, defensive
choice regardless: an application and its historical snapshot must survive the catalog lifecycle
doing *anything* to the source row, including a future cleanup job this phase doesn't build.

Historical preservation is two independent things, as the spec requires, and D6 reuses the
existing mechanism for each rather than inventing anything new:

1. **Durable catalog provenance** — the `job_catalog_id` FK itself, a stable pointer.
2. **Historical application snapshot** — the pre-existing `job_snapshots` table (Phase 5A),
   reused verbatim. `source_job_id`, deliberately never FK-enforced since it was first added
   ("outlives the row it was captured from" — see `docs/DATA_MODEL.md`), now also legitimately
   holds a `job_catalog.id` for a discovery-originated snapshot; no new "discovery snapshot"
   table was created, and none was needed.

## 46. Handoff API/action architecture

`POST /api/discovery/[id]/start-application` (`id` = `job_catalog.id`) is the one canonical
handoff operation — no logic duplicated in the React component, mirroring the exact
service-role-only-RPC-called-from-a-route-handler pattern `upsert_application_with_snapshot`
already established (Phase 5A). No request body: everything the operation needs is either the
path param or derived server-side from the verified session and the already-readable
catalog/feature/score rows. `userId` comes only from `getCurrentUser()` — never accepted from the
client, exactly the CLAUDE.md rule already governing every other write path in this codebase.

**Why service-role at all**: `job_snapshots` has no `authenticated` INSERT policy (select-only —
Phase 5A), so the one new database function this needs, `start_application_from_catalog_job`
(migration 0032), must run as `service_role` regardless of the route's own careful RLS-respecting
read choices elsewhere. It is `SECURITY INVOKER` (not `DEFINER`) and granted only to
`service_role` — the exact same posture as `upsert_application_with_snapshot`, not a new pattern.
`job_catalog`/`job_catalog_features`/the caller's own match score are all still read via the
ordinary session-scoped client (no reason to elevate for tables that are already
authenticated-readable or already RLS-scoped to the caller).

**A real bug this route's own live verification caught**: `job_sources` — unlike `job_catalog` —
has *no* `authenticated` SELECT policy at all (migration 0029: "no policy at all for
job_sources"). The route's first draft read it via the session-scoped client anyway; RLS silently
returned no row (not an error) for every single call, so `sourceType` was always `null` in both
the snapshot and the event metadata regardless of the job's real ATS provider. No unit test could
have caught this — a mocked Supabase client has no RLS to enforce. Confirmed live (a real Linear
job's snapshot showed `source_type: null` despite `job_sources.source_type = 'ASHBY'` for that
exact row), fixed at the source (read `job_sources` via the admin client, alongside the write step
that already needs it), covered by a new regression test asserting the call site's client
argument, and reverified live against three different real jobs across three different providers
(Ashby, Ashby, Lever) — every one now shows the correct `source_type` in both the snapshot and the
`DISCOVERY_HANDOFF` event metadata. See §51.

## 47. Idempotency guarantee

Non-negotiable, and proven at the database level, not by convention:

- **`applications_user_job_catalog_id_key`** — a partial unique index on `(user_id,
  job_catalog_id) where job_catalog_id is not null` (migration 0032). At most one application per
  (user, catalog opportunity), enforced by Postgres itself, not by a `SELECT` the application code
  merely hopes ran first.
- **Tiered lookup under `for update` row locking, wrapped in a bounded `unique_violation` retry
  loop** — the exact same shape `upsert_application_from_extension` (Phase 4D) already
  established, applied here for the same reason: a plain `SELECT`-then-`INSERT` has a real race
  window; locking the candidate row and retrying on the unique index's own violation is what makes
  concurrent calls converge safely rather than merely "usually work."
  - Tier 1: `job_catalog_id` match — this exact discovery opportunity, already tracked by this
    user. Return it, write nothing new.
  - Tier 2: `canonical_url` match (the **pre-existing** `applications_user_canonical_url_key`
    index, Phase 4D) on a row with `external_id is null and job_catalog_id is null` — an
    extension-created application at the identical posting URL that was never linked to any
    catalog job. Converge onto it (backfill `job_catalog_id`, and `job_snapshot_id` only if the
    application hasn't yet moved past `SAVED`/`IN_PROGRESS` — the identical freeze rule
    `upsert_application_with_snapshot` already applies) rather than create a second row for the
    same real-world posting. See §48 for why this specific tiering is the correct answer to
    extension interoperability.
  - Neither tier matches: insert a new application (`status` hardcoded to the literal `'SAVED'` —
    there is no parameter for anything else, see §46), record one `STATUS_CHANGE` event
    (`null -> SAVED`, matching every other first-creation path in this codebase) and one
    `DISCOVERY_HANDOFF` event.

Proven live, not just by unit test: **10 genuinely concurrent HTTP requests** from a real
authenticated browser session against the real running server and the real linked database, all
targeting the same catalog job, converged onto exactly one application id, with exactly one
response reporting `created: true` — confirmed independently at the database level (exactly one
`applications` row, exactly one `STATUS_CHANGE` event, exactly one `DISCOVERY_HANDOFF` event). See
§51.

## 48. Extension interoperability

Two real convergent flows, both handled by the *same* tiered lookup (§47), no new heuristic
invented for either:

- **Discover first, then the extension** — a user starts an application from `/discover`
  (creating a row with `job_catalog_id` set, `canonical_url` populated from
  `job_catalog.canonical_apply_url`), then later encounters the same employer posting page and
  saves it through the extension. The extension's own `upsert_application_from_extension` tiering
  (Phase 4D) already checks `canonical_url` as its own tier-2 key — since both paths compute
  `canonical_url` the same way (`canonicalizeUrl`, `packages/shared`), and D6 populates it too,
  the extension's own save naturally finds and updates the *same* row rather than creating a
  second one, with zero D6-specific code required for this direction.
- **Extension first, then discover** — the reverse (a user saves via the extension before the
  same opportunity ever appears in `/discover`) is D6's own tier 2 (§47): the handoff RPC matches
  the pre-existing extension-created row by `canonical_url` and backfills `job_catalog_id` onto
  it, never creating a duplicate.

Deliberately **not** built: company+title matching, or any other weak heuristic — two rows are
only ever considered "the same opportunity" via a deterministic identifier (`canonical_url`, both
sides computed by the identical function) or an explicit FK (`job_catalog_id`), never by fuzzy
text similarity. Verified live end-to-end (§51): a synthetic extension-created application (via
the real `upsert_application_from_extension` RPC, a real `jobs` row, a real `canonical_url`
matching a real catalog job's `canonical_apply_url`) converged onto the *same* application id when
the discovery handoff was called for the matching catalog job — `created: false`, `job_catalog_id`
correctly backfilled, confirmed independently at the database level.

## 49. Application status, events, and catalog lifecycle

**Status**: discovery handoff creates `SAVED`, never anything else — structurally, not just by
convention: `start_application_from_catalog_job` has no `status`/`p_status` parameter at all, so
there is no value to pass that could produce `APPLIED` even by a future editing mistake. A second,
independent backstop already exists regardless: migration 0015's
`reject_direct_applied_transition` trigger only exempts `current_user = 'service_role'` from its
APPLIED-transition guard — this function's own role *is* that exemption, so even a hypothetical
future parameter would still need to defeat that trigger too, not merely this function's own
logic. Neither viewing a job, clicking "Start application," opening the original posting, nor any
other D6 interaction ever infers `APPLIED` — only the pre-existing `markOwnApplicationApplied`
does that, completely untouched by this phase.

**Events**: `DISCOVERY_HANDOFF` (new `event_type`, migration 0032) records the one meaningful
transition — "discovered opportunity → tracked application" — never a per-interaction stream (no
"viewed," "clicked details," "opened external URL" events; opening the original posting link
creates nothing at all, see §50). Fired exactly once on first creation (alongside the ordinary
`STATUS_CHANGE` event every other creation path already records), and again — with no
`STATUS_CHANGE` alongside it, since status never changes in that case — the one time an existing
extension-created application gets retroactively linked via tier 2. Never fired again on a
repeat/idempotent handoff call. Its `metadata` (§50) is durable provenance only.

**Catalog lifecycle**: `job_catalog.status` (`ACTIVE`/`POSSIBLY_CLOSED`/`CLOSED`, D1-D3) is
deliberately never a gate on starting an application — a user may reasonably want to track/record
a job that closed moments ago (e.g. they already have an interview scheduled through another
channel, or just want a record of it). The only validation is that the referenced `job_catalog`
row exists at all (checked in the route, and again inside the RPC as the real enforcement point);
an already-created application is never affected by anything that later happens to its source
catalog row — not a status change, and not even a hard delete, which this phase's `on delete set
null` FK explicitly protects against (§45). Verified via pgTAP against the real linked project
(§51): deleting a `job_catalog` row leaves every application that referenced it fully intact, with
only `job_catalog_id` cleared to null.

## 50. Match/Coverage/Eligibility treatment

Discovery intelligence is useful historical provenance; it is never application state. D6 never
creates a composite score, never makes Eligibility an application status, never lets Match
influence application priority or Coverage influence "completeness." The only place a
Match/Coverage/Eligibility value is preserved at all is the `DISCOVERY_HANDOFF` event's own
`metadata` column (`jobCatalogId`, `sourceType`, `matchScore`, `coverage`, `eligibilityStatus`,
`rankingVersion`, `featureVersion`, `eligibilityVersion`) — a bounded (4000 chars as text),
clearly historical snapshot of what `/discover` showed at the exact moment of handoff, read back
by nothing else in this codebase and capable of driving no lifecycle decision. `null` when the job
hadn't been scored for this user yet (rather than a fabricated 0/UNKNOWN triple). This satisfies
all three conditions the spec sets for preserving this data at all: it fits the existing event/
provenance model cleanly (no new table), it is unambiguously historical (an event log entry, not
a live-read field), and nothing in the codebase treats it as authoritative.

## 51. D6 live verification (real 1,371-job catalog)

Two disposable test `auth.users` accounts, each given a `BALANCED` scoring profile and ranked via
`discovery:rank` against the full real catalog (1,371/1,371 scored each). Every step below was
driven through the real running `/discover`, `/discover/[id]`, and `/applications/[id]` pages in a
real headless Chromium session (Playwright, real password-authenticated cookies), never a
service-role-only fake path, against real Greenhouse/Lever/Ashby-sourced jobs:

```
1-8.  User A opened an untracked /discover/[id] (a real Ashby-sourced Linear posting), clicked
      Start application, was redirected to the real new /applications/[id], which correctly
      showed the job title, the "View discovery details" link (href verified exact:
      /discover/<catalog id>), and — confirmed via a full-body text search after the source_type
      fix (see §46) — the "Discovered through Career OS" provenance line.
9-10. Returned to /discover; a targeted search for the same job title confirmed the card now
      shows "View application" linking to the correct real application id (the job wasn't on the
      unfiltered first page of this profile's own ranking, which is expected and not a bug — the
      targeted search proved the feed RPC's LEFT JOIN itself works correctly regardless).
11-12. Returned to /discover/[id]: "Start application" was gone, replaced by "View application"
      with the correct href — never both shown at once.
13-15. Called the handoff endpoint again manually (the real fetch, real cookies): identical
      application id returned, created=false, database-confirmed no new row/event.
```

**Concurrency**: 10 simultaneous real HTTP requests (same real session, same real catalog job)
all returned status 200 with the identical `applicationId`; exactly one reported `created: true`.
Independently confirmed at the database level: exactly one `applications` row, exactly one
`STATUS_CHANGE` event, exactly one `DISCOVERY_HANDOFF` event survived.

**Extension interoperability**: a synthetic extension-created application (real `jobs` row, real
`upsert_application_from_extension` RPC call, `canonical_url` matching a real catalog job's
`canonical_apply_url`) — the discovery handoff for that exact catalog job converged onto it
(`created: false`, same application id), and `job_catalog_id` was confirmed backfilled at the
database level.

**Cross-user isolation**: User B, opening the *same* job User A had already tracked, correctly saw
"Start application" (never User A's tracked state) and correctly saw no "View application" link.
User B's own independent handoff call created a *separate* application — confirmed at the database
level: two distinct `applications` rows for the same `job_catalog_id`, one per user, and User B's
own session correctly returned zero rows when querying for User A's applications directly (RLS).

**Malformed/unauthorized**: an unauthenticated `POST` returned `401`; a non-UUID path segment
returned `400` with `{"error": "Invalid job id."}` — both live-confirmed via `curl` against the
real running route.

**Catalog lifecycle**: proven via the pgTAP suite (§ below) running against the real linked
project rather than a mutation of real shared catalog data — deleting a synthetic `job_catalog`
row inside a rolled-back transaction left every application referencing it fully intact,
`job_catalog_id` cleared to null, matching §49's documented behavior exactly.

**pgTAP**: `supabase/tests/database/0035_discovery_application_handoff.test.sql`, 33/33
assertions against the real linked project (structural existence; `ASHBY` widening; first-call
creation with correct status/events/snapshot/provenance; idempotent repeat with zero new writes;
the raw duplicate-insert rejection via the partial unique index; tier-2 convergence with correct
event/status/snapshot-freeze behavior; missing-catalog-job rejection; service-role-only grants,
including a re-confirmation that `anon` still cannot call `list_own_discovery_feed` after this
migration's drop+recreate; cross-user independence and isolation; the feed's tracked-state LEFT
JOIN scoped correctly per user; catalog-deletion FK behavior).

**A second genuine live bug this suite's own first run caught**: Postgres auto-declares every
`RETURNS TABLE` output column as a local `plpgsql` variable in the function body — the RPC's own
`status` output column collided with the `applications.status` *table* column referenced inside
the function (`42702 column reference "status" is ambiguous`), and separately, `job_snapshot_id`
collided the same way inside the tier-2 `UPDATE`. Fixed by renaming the output column to
`application_status` and explicitly table-aliasing every `public.applications` reference inside
the function body (`app.status`, `app.job_snapshot_id`, `app.id`) — the more robust fix, since
renaming only the first colliding name would have left the second latent. Reapplied and reverified
live (31/31, then 33/33 after two additional assertions were added) before any TypeScript layer
was written against the corrected signature.

**Cleanup**: both test users' every row (`applications`, `application_events`, `jobs`,
`job_snapshots`, `discovery_scoring_profiles`, `discovery_eligibility_profiles`,
`user_job_match_scores`) confirmed at zero after deletion — no residue left in the linked project.

**AI/provider audit**: zero references to `@career-os/ai`, Tavily, Claude, or embeddings anywhere
in the D6 code path (`apps/web/app/(app)/discover/start-application-button.tsx`, `apps/web/app/api/
discovery/[id]/start-application/**`, migration 0032) — confirmed by grep. Starting an application
never triggers resume tailoring, company research, interview prep, or any other existing
AI-assistance action; those remain the explicit, separate user actions they already were on
`/applications/[id]`.

## 52. D6 — consciously deferred

No new preference/status/eligibility semantics were invented for UI convenience — every new field
(`applications.job_catalog_id`, `application_events.metadata`/`DISCOVERY_HANDOFF`) maps to an
existing table, and every value it carries is provenance, never authoritative application state.
Explicitly not built, matching the spec: automatic application submission, AI-driven application
priority/ranking, a second application/tracker system, automatic résumé tailoring triggered by the
handoff, any change to D4's scoring formulas or D5A's default ranking policy or D5B's profile
semantics, and any retroactive backfill matching historical (pre-D6) applications to catalog jobs
— `job_catalog_id` stays `null` forever for every application that predates this phase, exactly as
designed, never guessed from company+title or any other weak signal.

## 53. D6.5 — daily ranking automation (P1 fix)

**The gap.** `list_own_discovery_feed` (§29) inner-joins `user_job_match_scores` — a job is
invisible in `/discover` until a score row exists for that `(user, job)`. Before this fix, the
scheduled workflow (§16) ran only `discovery:sync` (catalog ingestion); `user_job_match_scores`
was populated only by a manual `discovery:rank` CLI run or by `/settings/discovery`'s save
endpoint, and the latter only recomputes on an actual preference change, not on a no-op save.
Net effect: after a user's first ranking, every subsequent day's newly-synced jobs stayed
permanently invisible in their feed with no automated path to fix it — a real gap against this
track's own purpose ("see new postings"), not a cosmetic one.

**The fix.** `.github/workflows/job-discovery-sync.yml` now runs `npm run discovery:rank` (no
`--user-id`) as a second step, immediately after `discovery:sync`, in the same job, on the same
schedule. Ordinary GitHub Actions step sequencing means the rank step only runs if sync
succeeds, and a rank failure fails the job visibly (no `continue-on-error`, no swallowed exit
code) — nothing new was added to make either of those true. No second scheduler, no new API
route, no change to `discovery:rank`/`rankJobsForUser`/`extractFeaturesForStaleJobs` themselves
(§27–§29's Match/Coverage/eligibility math is untouched), no AI/search call introduced (`rank`
was already, and remains, zero-Claude/Tavily/embedding). `discovery:rank` already ran feature
extraction before scoring (§32), so nothing extra was added there either.

**Live-verified, real linked project, disposable test user** (created and deleted via the
Supabase Admin API for this check only, zero residue after): a fresh account with a scoring
profile and zero `user_job_match_scores` rows went to 1,371 scored rows after one
`discovery:rank` run, and those rows were immediately visible through a real password-authenticated
session calling `list_own_discovery_feed` directly (not just present in the table via the admin
client) — with no preference edit and no manual CLI invocation by the user. `discovery:rank`
with no `--user-id` and zero scoring profiles in the project also confirmed exits `0` (`Ranking
for 0 user(s).`), so the step is safe to add even before any user has a profile yet.

**Deferred scalability note (do not build now).** Today, the scheduled job re-ranks *every* user
with a scoring profile after each catalog sync — a full re-score of the whole catalog per user,
every run. This is intentionally acceptable at personal-beta/current scale (one real user,
~1,371 jobs, a few seconds of compute). It is **not** optimized here. If user volume ever grows
enough that this becomes a real cost or duration problem, the future fix is per-user or
incremental recomputation (e.g. only re-score users whose preferences changed, or only re-score
jobs new/changed since the last run) — flagged as a future scaling concern only, not implemented
now.

## 54. Quality-gate hardening (post-D7.1 audit)

An architecture audit ("does a catalog job ever reach `/discover` before it's fully, correctly
processed") found three real gaps against this document's own stated invariants — all fixed as
small, additive changes, no new tables, no new workflow engine:

**Closed/merged jobs never became invisible.** `list_own_discovery_feed` (§29, §34) inner-joins
`job_catalog` → `job_catalog_features` → `user_job_match_scores` with no `job_catalog.status`
filter at all. `upsertUserJobMatchScoresBatch` only ever inserts/updates a score row for a
currently-`ACTIVE` job (mirroring `listActiveJobsWithFeatures`'s own `status = 'ACTIVE'` read) —
it never deletes one for a job that has since left that set. Net effect: a job that transitions to
`POSSIBLY_CLOSED`/`CLOSED` (§9 reconciliation) kept its last-computed score row forever, and the
feed had nothing to exclude it with — the mirror image of §53's "newly-synced jobs never become
visible" gap, on the opposite end of a job's lifecycle. (`MERGED` rows were already safe —
`mergeJobCatalogRowIntoAtsMatch` explicitly deletes the Jobright row's own match scores as part of
merging — this is the one case the gap didn't reach.) **Fix** (migration `0043`): the feed function
now also filters `jc.status = 'ACTIVE'`, the exact predicate scoring already uses to decide whether
to keep refreshing a job — applied symmetrically to reading it. Deliberately excludes
`POSSIBLY_CLOSED` too, not just `CLOSED`: a job Career OS already suspects may be closed should not
be freshly recommended as a live opportunity while that uncertainty stands. Covered by
`supabase/tests/database/0040_discovery_feed_active_only.test.sql`.

**Feature extraction lacked the failure isolation every other stage already has.**
`runDiscoverySync`, `runJobrightEnrichment`, and `runOfficialPostingResolution` each isolate one
item's failure from the rest (§10, and each stage's own module doc). `extractFeaturesForStaleJobs`
(§29, `packages/discovery/src/ranking/extract-features.ts`) did not — a single candidate whose
title/description tripped an unexpected exception inside `extractJobCatalogFeatures` threw out of
a plain `.map()`, aborting the *entire* batch. Since `scripts/discovery/rank.ts` always runs
feature extraction before re-scoring every user (§32), one bad candidate would have silently
blocked the whole day's ranking recompute for *every* user — reintroducing §53's gap by a different
path. **Fix**: each candidate's extraction is now wrapped individually; a failure is skipped
(its existing `job_catalog_features` row, if any, is left untouched, never persisted
half-computed) and reported in the summary's new `failed`/`failures` fields, which both CLI
scripts (`discovery:extract-features`, `discovery:rank`) now log. Covered by
`packages/discovery/src/ranking/extract-features.test.ts`.

**The Discovery → Application handoff had its own, undocumented URL-selection logic.** The
card/detail page's `selectJobApplyActions` (§6 above) and
`POST /api/discovery/[id]/start-application`'s canonical-URL decision are deliberately *different*
questions (a wide-audience "should this be a trusted primary CTA" allowlist vs. a single user's
own "what should this tracked application record" blocklist) — but the handoff route expressed its
answer as three lines of inline `classifyJobPostingHost(...) === 'REJECTED_AGGREGATOR' ? ... : ...`
rather than a named function, risking silent drift between the two decisions over time with no
single place documenting why they're allowed to differ. **Fix**: extracted, unchanged in behavior,
into `selectCanonicalHandoffUrl` next to `selectJobApplyActions` in
`packages/shared/src/lib/select-job-apply-actions.ts`, with a doc comment cross-referencing its
sibling and explaining the intentional narrower-vs-wider difference. The route now calls it by
name instead of reimplementing it. Covered by `select-job-apply-actions.test.ts`; the existing
`start-application/route.test.ts` assertions pass unchanged (behavior-preserving refactor).

**Explicitly not changed by this audit**: no separate description-fetch was added for a resolved
Jobright job's official employer URL — `jobright-enrichment.ts` already obtains the richest
reliable description directly from Jobright's own detail-page JSON-LD (§9-10 there), independently
of URL resolution (§ above), and duplicating that with a second fetch of the *resolved* URL would
be a second parser for no confirmed benefit. Backfilling existing pre-D7.1 Jobright rows needs no
new tooling either — `discovery:enrich-jobright`/`discovery:resolve-postings`/`discovery:rank` are
already idempotent and already prioritize never-processed rows first (`listJobrightEnrichmentCandidates`
sorts `description IS NULL` rows before stale-but-already-enriched ones); catching up a backlog
larger than one run's bound (30 enrichments, a handful of resolutions) is simply a matter of
running the existing CLI commands again, or letting the daily schedule cycle through it.
