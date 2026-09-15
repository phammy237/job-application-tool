# Deployment

## 1. Domain structure

| Domain                                                                               | Purpose                                          | Owner/repo                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `mypham.space`                                                                       | Existing public portfolio                        | Separate repository, unaffected by this project |
| `apply.mypham.space`                                                                 | Career OS — public landing + authenticated app   | This repository (`apps/web`)                    |
| `apply.mypham.space/dashboard`, `/profile`, `/applications`, `/resumes`, `/settings` | Authenticated routes within the same Next.js app | `apps/web`                                      |

`apply.mypham.space` is a subdomain pointed at a separate deployment target from
`mypham.space`'s root domain. DNS delegation is the only infrastructure the two products
share; no compute, database, or storage is shared.

## 2. Environments

- **Production** — `apply.mypham.space`, connected to the production Supabase project.
- **Preview/staging** — per-PR or a persistent staging deployment (e.g. Vercel preview
  deployments), connected to a separate Supabase project or a clearly isolated schema —
  never production data, given résumés/applications are real personal data even for the
  product owner's own account.

## 3. Hosting

- `apps/web` (Next.js App Router) deploys to a Node-compatible host with first-class Next.js
  support (e.g. Vercel) — final choice made at Phase 1 kickoff, not fixed here since it
  doesn't affect the architecture in this doc set.
- Supabase project is dedicated to Career OS: its own Auth configuration, Postgres instance,
  Storage buckets, and project-level API keys — never the same project backing any other
  product.
- `apps/extension` is not "deployed" the same way — it is built and published to the Chrome
  Web Store (or loaded unpacked during development/private beta) as a versioned artifact that
  points at the production API's base URL.

## 4. Secrets and environment variables

Managed through the hosting provider's environment variable store (not committed, not in
`.env` files in the repo). At minimum:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (safe for client use)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ANTHROPIC_API_KEY` (server-only, `packages/ai`)
- `TAVILY_API_KEY` (server-only, `packages/ai` — Phase 7G company research; optional, degrades to
  `research_provider_unavailable` when unset)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (server-only, `packages/email`)
- `TOKEN_ENCRYPTION_KEY` (server-only, for `encrypted_refresh_token`)

Preview/staging environments get their own values for all of the above — a staging deploy
must never be able to authenticate against the production Supabase project or the production
Google OAuth client.

## 5. Extension distribution

- Development: loaded unpacked, pointed at a local or staging API base URL via build-time
  env config.
- Private beta: either unpacked distribution to the small test-user list, or an unlisted
  Chrome Web Store listing — sufficient for the "approved test users" constraint in
  `docs/PRODUCT_SPEC.md` §8 without a public listing.
- Public (Phase 8+): standard Chrome Web Store listing, review process budgeted separately
  from the Gmail OAuth verification timeline (`docs/EMAIL_INTEGRATION.md` §6) — they are
  independent review processes with independent timelines.

## 6. CI/CD (shape, not final tool choice)

- Lint (ESLint/Prettier), typecheck, unit tests (Vitest), and build run on every PR.
- Playwright end-to-end tests run at least against the web app's authenticated flows before
  merge to `main`.
- Database migrations (`supabase/migrations/`) are applied via the Supabase CLI as an
  explicit, reviewed step — not auto-applied from a dev branch to production.

## 6a. Job Discovery daily sync (Job Discovery Track D1–D3)

Full design: `docs/JOB_DISCOVERY.md`. Runs as its own scheduled GitHub Actions workflow
(`.github/workflows/job-discovery-sync.yml`), independent of the app deploy pipeline —
`npm run discovery:sync` runs deterministic ATS ingestion (Greenhouse/Lever/Ashby) and needs
only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Deliberately does **not** need `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, or any `GOOGLE_OAUTH_*`
secret — the discovery path makes zero Claude/Tavily/embedding calls, so it has zero exposure
to those credentials even if the workflow's secret scope were misconfigured. GitHub Actions
secrets are configured once, separately from the hosting provider's environment store used for
`apps/web`, and are never printed in workflow logs.

## 7. What is explicitly not shared with mypham.space's deployment

- No shared build pipeline, no shared hosting project, no shared environment variable store.
- No shared Supabase project, and therefore no possibility of an RLS misconfiguration in one
  product affecting the other's data.
- The only sanctioned connection point is the future, optional, one-directional public-JSON
  export/import described in `docs/ARCHITECTURE.md` §6 — implemented as a plain HTTP contract,
  deployed as part of Career OS, consumed (if ever) by mypham.space as an external API caller
  like any other client.
