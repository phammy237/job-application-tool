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
the exact same script a developer runs locally.

## 17. Future phases (explicitly deferred, not built here)

```
[x] D1 — Global job catalog + source registry
[x] D2 — Greenhouse / Lever / Ashby ingestion
[x] D3 — Freshness, lifecycle, daily synchronization
[ ] D4 — Deterministic feature extraction + personalized ranking
[ ] D5 — /discover dashboard
[ ] D6 — Discovery → existing Career OS application handoff
[ ] D7 — Generic company career-site crawler
[ ] D8 — Feedback-driven ranking
```

Not built in this track, on purpose: personalized ranking/match scores, role taxonomy, BM25/
TF-IDF/embeddings, `/discover` UI, saved/hidden jobs, discovery events, the catalog→application
handoff, generic HTML crawling, Workday/LinkedIn/Indeed/ZipRecruiter support, any extension
change, résumé/PDF changes. Real résumé PDF compilation/preview/download is a separate,
later Career OS delivery feature and is not part of this track at all.
