# myOS Sprint Report

Branch `worktree-myos-sprint` (worktree `.claude/worktrees/myos-sprint`), based on `main@8bf5d91`.
Not pushed, not deployed.

# Executive Summary

Career OS now has **myOS**, a personal evidence layer at `/my`. It is a relational evidence graph
built on the existing `projects`, `skills`, `experiences` and `education` tables. It adds evidence,
achievements, STAR stories, typed edges, inferred candidates, GitHub ingestion and a portfolio
opt-in. Every statement carries provenance (`VERIFIED` / `USER_PROVIDED` / `INFERRED` /
`AI_GENERATED`). Inferred knowledge stays a pending candidate until you accept it, and gaps are
shown instead of being filled.

myOS is connected back into Career OS in three places:

- **Applications:** an evidence-backed requirement match and a "From your evidence" interview prep
  panel on the application page.
- **Resume Studio:** a "Why this bullet?" panel per bullet that flags unsupported numbers and
  technologies.
- **Portfolio:** an opt-in, read-only `PUBLIC` export API for mypham.space.

All myOS logic is deterministic. It makes no LLM calls and uses none of your AI quota, so a claim
cannot exist without stored evidence behind it.

Two QA/red-team rounds ran. Round 1 found 1 HIGH and 15 MED issues; round 2 found 8 MED. All of
them are fixed with regression tests. The things I could not verify here are listed under
**Known Issues**.

# Features Implemented

| Area | What exists |
| --- | --- |
| Evidence graph | Nodes are projects, experiences, education, skills, achievements, stories and evidence. Typed edges are DEMONSTRATES, USES, BELONGS_TO, SUPPORTS, REPRESENTS and REFERENCES. Endpoint integrity is enforced by triggers. |
| Provenance | A verification state on every evidence row and edge. Users can't self-forge VERIFIED: only the service role writes VERIFIED or GITHUB_* rows, enforced by DB triggers. VERIFIED is never downgraded on re-sync. A metric is never VERIFIED without supporting evidence. |
| Projects (`/my/projects`, `/[id]`) | A structured evidence container per project: skills, achievements and metrics, evidence with provenance, collaborators, talking points, visibility, approvals, suggestions to accept or reject, and delete. |
| Skills (`/my/skills`) | Transparent levels: NONE, LIMITED, MODERATE, and STRONG (shown as "Well supported"). Each skill shows "why this strength", recency, evidence quality and counts. A legend explains the rules. Detected but unadded technologies are listed. |
| GitHub (`/my/github`) | Connect with a username, or add a fine-grained token (stored encrypted). Sync is incremental, idempotent and retryable. You choose which repos to import as projects. Evidence comes from the repo, README and your own merged PRs. |
| Extraction | Deterministic: repo languages, topics and README become PENDING candidates for skills, talking points, summaries and competencies. Each candidate carries a rationale and a dedupe key, and nothing is invented. |
| Timeline (`/my/timeline`) | Grouped by year, with filters and an undated section. |
| Achievements (`/my/achievements`) | Achievements, awards, metrics and launches. You can link evidence and run a "Mark verified" action. |
| Stories (`/my/stories`) | STAR story bank covering 11 competencies, linked to projects, experiences and evidence. Shows competency coverage and a "ready for interviews" state. |
| Graph (`/my/graph`) | Interactive SVG with no new dependencies: pan, zoom, filters, search, focus mode and a details panel. Below 768px it falls back to a list. |
| Ask (`/my/ask`) | Evidence-backed answers laid out as answer, then claims, then evidence, then source. A claim can't be created without support, and insufficient evidence is stated plainly. |
| Job matching | For each requirement: the matching skill, the projects or experiences behind it, and the evidence. Shows STRONG, MODERATE, LIMITED or NONE, explicit gaps, and an honest fit verdict. |
| Interview prep | Competency areas, STAR stories, relevant projects, your own talking points, gaps and questions to prepare, all grounded in myOS. |
| Resume Studio | "Why this bullet?" with supporting evidence, flagging unsupported numbers and technologies. |
| Portfolio (`/my/settings`, `GET /api/portfolio/v1`) | Visibility levels PRIVATE, CAREER_OS_ONLY and PUBLIC. Export needs PUBLIC, approval and opt-in. Uses a hashed API key, filters at query level, and is fuzz-tested for leaks. |
| Home (`/my`) | An honest snapshot, evidence coverage and gaps, strongest skills, ready stories, GitHub state, and a 6-step onboarding that says what the system does not know. |

# Architecture

See `docs/myos/ARCHITECTURE.md`, which has Mermaid diagrams. Data flows like this:

1. `loadOwnEvidenceGraph` returns `EvidenceGraphData`.
2. Pure functions in `packages/shared/src/lib/myos` work on that data.
3. Server components and actions in `apps/web`.

GitHub I/O lives in the server-only `packages/myos`.

# Database Changes

`supabase/migrations/0060_myos_evidence_graph.sql`. It is numbered 0060 to avoid colliding with your
in-flight 0044–0047.

- **New tables:**
  - `myos_evidence`, `myos_achievements`, `myos_stories`, `myos_edges`, `myos_candidates`
  - `github_connections`, `github_credentials` (service role only: RLS on, no policies)
  - `github_repositories`, `github_sync_runs`, `portfolio_settings`
- **Additive columns:**
  - `projects`: `status`, `summary`, `collaborators`, `talking_points`, `origin`, `visibility`
  - `skills` and `experiences`: `visibility`
  - Composite `(user_id, id)` keys on `projects`, `skills`, `experiences` and `education`
- Every table has RLS, and every user-writable table has the standard policies.
- **Ingestion-owned writes:** inserts into `github_repositories`, `github_sync_runs` and `github_connections` are service role only. End users can change only `selected` and `project_id`.
- **Triggers:**
  - edge endpoint validation
  - node-delete edge cleanup
  - provenance guard
  - candidate evidence ownership
  - `search_path` pinned
- Hand-maintained `database.types.ts` updated.

# Routes Added

- **Pages:** `/my`, `/my/projects`, `/my/projects/[id]`, `/my/skills`, `/my/timeline`, `/my/achievements`, `/my/stories`, `/my/stories/[id]`, `/my/graph`, `/my/ask`, `/my/github`, `/my/settings`.
- **API:** `POST /api/myos/github/{connect,sync,disconnect}`, `POST /api/myos/github/repositories/[id]/select`, `GET /api/portfolio/v1`.
- `/my` added to the middleware `PROTECTED_PREFIXES` and to the sidebar ("myOS").

# GitHub Integration

`docs/myos/GITHUB_INGESTION.md`.

**Client:**
- Pagination is capped.
- ETag/304 requests.
- Rate-limit awareness, including Retry-After for secondary limits.
- Bounded retries with backoff.
- Typed errors.
- The token is a `#private` field.
- `redirect:'manual'`, and no host other than api.github.com is ever contacted.

**Sync:**
- Per-repo error isolation, ending the run PARTIAL.
- Rate limit ends the run as PARTIAL with a reset time.
- 3-way concurrency with a 45s budget.
- Cooldowns: 60s per user, 10 minutes for token-less syncs.
- Repo renames re-key evidence instead of duplicating it.
- Text is sanitized (NUL bytes, lone surrogates).

**Ownership:** a username-only connection can't prove the account is yours. In that mode evidence
is `USER_PROVIDED` and the PR sample is skipped. Repo-wide counts are never presented as your
activity.

# Career OS Integrations

`docs/myos/CAREER_INTEGRATION.md`. These are application page panels, the Resume Studio grounding
panel, and candidate generation after sync. None of it touches the existing AI pipelines, guards or
quota.

# Tests Added

- **Shared logic:** strength, graph, timeline, extraction, matching, Ask, interview prep, bullet evidence, portfolio (including a fuzz test) and the QA regression tests.
- **Database queries:** user_id filtering, idempotency, VERIFIED non-downgrade, metric rules, token never returned, and hardening.
- **GitHub:** client, normalization, sync (idempotency, 304, rate limit, retry, error isolation, ownership) and text sanitizing.
- **Web:** routes for connect, sync, disconnect, select and portfolio; actions for projects, skills, stories and achievements (ownership, validation, compensation); page helpers; render tests for the integration panels.
- **pgTAP:** `supabase/tests/database/0050_myos_evidence_graph.test.sql` covers cross-user isolation on every table, credentials being inaccessible, edge validation and cascade, the provenance guards and default visibility.

# Test Results

Final gate, run on the last commit:

| Check | Result |
| --- | --- |
| `npm run typecheck` (all workspaces) | ✅ clean |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm test` | ✅ **3,065 passed**, 0 failed (baseline 2,599, so +466 and nothing removed) |
| `npm run build --workspace=@career-os/web` | ✅ compiles; all `/my/*` and API routes present |
| Migration in PGlite (PG18) | ✅ 0001 + 0060 apply; RLS, triggers and provenance guards behave as designed |
| pgTAP (`supabase test db`) | ⚠️ **not run** (no Docker) |

Per workspace, baseline → final:

| Workspace | Baseline | Final |
| --- | --- | --- |
| extension | 139 | 139 |
| web | 651 | 812 |
| ai | 314 | 314 |
| database | 254 | 299 |
| discovery | 291 | 291 |
| email | 19 | 19 |
| myos | — | 40 (new) |
| shared | 931 | 1,151 |

**Optimization pass (requested mid-sprint):**

- **One graph load per request.** A React `cache()` loader replaces the repeated loads on every page, action and integration panel.
- **Shared support index.** Each request now builds it once instead of 3×.
- **Precompiled matchers.** Text and regex matchers are compiled once instead of in hot loops.
- **Faster pure logic** on a synthetic graph:
  - skill strengths: ~150 → 50 ms
  - requirement matching: ~150 → 30 ms
- **Batched candidate writes** after GitHub sync.
- **Memoized graph rendering**, so pan and zoom no longer re-render the node lists.
- **One copy of each helper.** Duplicates were consolidated and dead code removed, with Prettier applied.
- **Behaviour unchanged.** A 40-random-graph old-vs-new comparison produced identical outputs.

# Security Review

Two red-team rounds covered RLS, user_id filtering on service-role paths, tokens, SSRF, injection,
XSS, the public export, the CSRF posture, and the client-bundle boundary.

**Fixed:**
- A user could self-forge VERIFIED evidence.
- `javascript:` URLs rendered as links.
- The public export read in memory instead of filtering at query level.
- A private-repo name could leak through the export.
- A user could import someone else's GitHub identity through a username-only connection; that evidence is now unverified.
- Exposure to the shared unauthenticated GitHub quota (cooldowns added).
- Body-size and redirect hardening.
- Atomic repo claim.
- Fixed message codes instead of reflected query text.

**Verified safe:**
- Tokens never appear in responses, logs or errors.
- `user_id` always comes from the session or key hash.
- No server-only package is imported from a client component.
- No `dangerouslySetInnerHTML`.

# UX Review

Persona review covered a new user, recruiters, an engineer, security, a designer/accessibility
reviewer and data integrity.

- No dead links.
- Empty-graph safe.
- aria-live results.
- Labelled forms.
- Dark-mode badge variants.
- ≥40px nav targets.
- A heading hierarchy fix.
- The STRONG label relabelled "Well supported", so it no longer reads as a proficiency rating.
- Honest fit-verdict thresholds.

The pages have **not** been viewed in a real browser against a live database (see below).

# Known Issues

- **The SQL was not run on real Postgres here.** There is no Docker. The migration and behavioural checks did run in PGlite (PG18). `supabase test db` (pgTAP) has **not** run; CI's `db-tests` job will be the first real run.
- **The UI has not been exercised end to end in a browser.** Unit and render tests plus a production build pass.
- The portfolio rate limit is per instance (best effort).
- The sync mutex is check-then-insert. Sync is idempotent, so a lost race only repeats API calls.
- Legacy talking points could ground a number in a resume bullet.
- CSRF on JSON POST routes relies on SameSite=Lax (the same as existing routes).

# Deferred Work

- **LLM layer (optional, quota-metered):** STAR drafting and summary polishing through the existing `unsupportedClaims` pipeline.
- **GitHub:** an OAuth app instead of a PAT, webhook-driven sync, and commit-level evidence.
- **Resume Studio:** grounding inside the tailoring review session; it needs a route for proposed bullets.
- **Portfolio:** a richer case-study format.
- **Discover:** ranking that uses myOS evidence.

# Commits

Commits on `worktree-myos-sprint`, oldest first. None has a co-author trailer, per your standing preference.

```
af2038a feat(myos): add evidence graph schema, shared schemas, and reconnaissance
c113f7b feat(myos): add query layer, skill/graph/timeline/extraction/portfolio and matching/ask/interview logic
de9da0f feat(github): add incremental, idempotent repository ingestion and myOS shell navigation
87f23c6 feat(myos): add interactive evidence graph, evidence-backed ask, and portfolio export API
99958ac feat(myos): add skills evidence explorer, timeline, achievements, and story bank
ed06f9f feat(career): connect job matching, interview prep, and resume bullets to the evidence graph
2b17c51 feat(myos): add myOS home, project intelligence, and GitHub import UI
a315a9e fix(myos): harden provenance, GitHub ingestion, URL safety, and grounding after QA review
196d5d8 fix(myos): tighten skill strength and fit verdicts, add achievement evidence linking, atomic repo import, and UX polish after QA round 2
aeebec8 perf(myos): cache per-request graph loads, share indexes, dedupe helpers, and format sprint files
(+ final docs commit with this report)
```

# Recommended Next Steps

1. Run `supabase start && supabase test db` (or push to CI) and fix anything pgTAP reports.
2. Apply 0060 to a staging project, then click through `/my`, a GitHub sync and an application page.
3. Review the default thresholds (skill strength, fit verdict) against your own data.
4. Merge or rebase onto your `fix/security-hardening-ci` work. Migration numbering is already
   collision-free.
