# myOS — Repository Reconnaissance

Captured at the start of the myOS sprint (base commit `8bf5d91`, branch `worktree-myos-sprint`).
The repository is the source of truth; this document records what was found and the decisions
that follow from it.

## Baseline

`npm test` (all workspaces) passes before any change: 2,599 tests. By workspace: extension 139,
web 651, ai 314, database 254, discovery 291, email 19, shared 931. All green. No Docker is available locally,
so the pgTAP suite (`supabase test db`) cannot run here; it runs in CI (`db-tests` job).

## Architecture

- npm-workspaces monorepo: `apps/web` (Next 15 App Router, React 19, Tailwind 3), `apps/extension`,
  `packages/{ai,database,discovery,email,shared,ui}`, `supabase/migrations` (0001–0043).
- Supabase Postgres + RLS. Clients: anon/RLS (`createClient()`), service-role (`createAdminClient()`,
  server-only). `database.types.ts` is **hand-maintained** — every migration needs a manual edit.
- Query layer: `packages/database/src/queries/*.ts`, `(supabase, userId, …)`, always `.eq('user_id')`,
  rows mapped through Zod schemas from `@career-os/shared`.
- Zod v3 schemas in `packages/shared/src/schemas`; pure deterministic logic in `shared/src/lib`.
- AI: `packages/ai` (server-only). Claude calls are quota-metered (`increment_ai_request_usage`),
  `ai_usage_events.task_type` has a drop-and-recreate CHECK. Grounding via
  `listOwnApprovedFactsForGeneration` (`user_approved AND approved_for_applications`).
- Existing profile data: `candidate_facts`, `experiences`, `education`, `projects`, `skills`
  (each with `user_approved`, `approved_for_applications`, `visible_on_public_profile`).
- Job side: `job_snapshots` → `requirement_mapping_runs` → `requirement_evidence_mappings`
  (matched facts with provenance); discovery ranking is deterministic (`packages/discovery/ranking`).
- Resume Studio: `resumes` / immutable `resume_versions` (STRUCTURED_V1), tailoring plan generator
  with numeric/technology guards and a human review gate. Interview prep is ephemeral.
- Gmail OAuth is the only OAuth precedent (state cookie, `TOKEN_ENCRYPTION_KEY` AES-GCM helper).
  **No GitHub integration exists.**
- Auth: `requireUser()` (pages), `getCurrentUser()` (routes), `middleware.ts` `PROTECTED_PREFIXES`
  (a new top-level `/my` must be added).

## Reusable systems

| Need | Reuse |
| --- | --- |
| Projects / skills / experiences | existing tables, extended additively (visibility, status, summary) |
| Token encryption | `encryptRefreshToken`/`decryptRefreshToken` (generic AES-256-GCM) |
| RLS + composite ownership FKs | `0017_networking_contacts.sql` pattern |
| Requirement-evidence mappings | `requirement_evidence_mappings.matched_facts` (job side) |
| Deterministic retrieval | `packages/ai/src/retrieval` tokenizer/scoring ideas |
| UI primitives | `packages/ui` Button/Card/Badge/Input; `network/` page as page+actions template |

## Risks

1. Hand-maintained DB types → silent drift; mitigated by Zod parsing in `rowToX` and tests.
2. Service-role paths bypass RLS → every query filters `user_id` explicitly.
3. No local Postgres → SQL cannot be executed here; migration is written conservatively and
   covered by a pgTAP file to be run in CI. **Flagged as unverified in the sprint report.**
4. Shared AI quota; adding AI features requires widening a CHECK. myOS therefore ships
   **deterministic** (no LLM) retrieval/extraction/matching, with the grounding guarantees that
   implies. LLM synthesis is a deferred, optional layer.
5. Migration numbering: the author's in-flight branch uses 0044–0047. myOS uses **0060+** to
   avoid collisions.
6. CLAUDE.md: `packages/ai`/`packages/email` are server-only; the new `packages/myos` is likewise
   server-only (no client imports of GitHub token code).

## Integration points

- **Profile**: myOS projects/skills/experiences *are* the existing rows; graph edges and evidence
  link to them.
- **Job matching / requirement mapping**: new pure `matchRequirementsToEvidence` consumes job
  requirement text and the evidence graph; surfaced on `/my/jobs/[applicationId]`-style panel on
  the application page.
- **Resume Studio**: bullet suggestions carry evidence ids; "why this bullet" panel; unsupported
  metrics rejected by an evidence guard.
- **Portfolio**: `/api/portfolio/v1/*` token-less read of PUBLIC-only data keyed by a per-user
  publish key (see PORTFOLIO_API.md).
