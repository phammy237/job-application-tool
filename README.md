# Career OS

A privacy-first job application assistant: a structured, approve-before-use candidate
profile, a Chrome extension that analyzes job postings and fills only what you've approved,
an AI tailoring system that never fabricates a fact, and an optional Gmail application-status
tracker.

Built by My Pham. Deployed at [apply.mypham.space](https://apply.mypham.space), linked from
the personal portfolio at [mypham.space](https://mypham.space) — **separate codebase,
separate database, separate deployment pipeline.** See `docs/ARCHITECTURE.md` §1 for the
boundary.

## Status

Phases 1–3 are built (auth, database, candidate profile, manual tracker, Chrome extension
shell with page extraction, and Claude-generated suggestions), plus Phase 4A (the popup's
field review/approval UI), Phase 4B (the centralized safe autofill engine), and Phase 4C
(application saving and dashboard tracker integration). Phase 4D (end-to-end integration and
safety verification) is next. See
`docs/IMPLEMENTATION_PLAN.md`'s Status checklist for the current phase and the phased build
plan.

## Documentation

| Doc                                                            | Covers                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)                 | What Career OS is and isn't, public/private surface                                |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md)                     | Step-by-step flows: onboarding, résumé review, extension use, Gmail sync, deletion |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Monorepo layout, system diagram, multi-user architecture, mypham.space separation  |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)                     | Full Supabase schema: tables, indexes, RLS policies                                |
| [`docs/EXTENSION_DESIGN.md`](docs/EXTENSION_DESIGN.md)         | Manifest V3 permissions, adapter architecture, field classification, popup UI      |
| [`docs/AI_GROUNDING.md`](docs/AI_GROUNDING.md)                 | Retrieval pipeline, Claude response contract, fabrication-rejection gate           |
| [`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md)       | Gmail OAuth, attended sync (manual + throttled auto-check), classification, data minimization |
| [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md) | Threat model, RLS strategy, secrets, deletion flows                                |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                     | Domains, environments, hosting, CI/CD shape                                        |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)   | Phase-by-phase build plan                                                          |
| [`CLAUDE.md`](CLAUDE.md)                                       | Permanent engineering rules for AI-assisted work in this repo                      |

## Repository structure

```
apps/
  web/            Next.js App Router — dashboard + public landing page
  extension/      Chrome MV3 extension — React + Vite
packages/
  shared/         Zod schemas + TS types shared by web and extension
  ui/             shadcn/ui component library + design tokens
  ai/             Server-only Claude integration
  email/          Server-only Gmail integration
  database/       Supabase client + typed, RLS-aware query layer
supabase/
  migrations/     SQL migrations (schema + RLS policies)
  seed.sql        Non-personal demo data only
docs/             Architecture and planning documentation (this table, above)
```

## Tech stack

TypeScript, Next.js App Router, React, Tailwind CSS, shadcn/ui, Chrome Manifest V3, Vite,
Supabase (Auth, Postgres, Storage, Row Level Security), Zod, Claude API (server-side only),
Gmail API (server-side OAuth only), Vitest, Playwright, ESLint, Prettier, npm workspaces.

## Core principles

- **Multi-tenant from the first migration.** Every user-owned table has `user_id` and Row
  Level Security. Nothing is built around one hardcoded user.
- **No fabrication.** AI-generated content may only use candidate facts the user has
  explicitly approved. When there isn't enough approved information, the system says so
  instead of guessing.
- **No autonomous submission.** The extension fills only user-approved fields; the human
  always clicks submit.
- **No surveillance.** The extension inspects the page only after an explicit user action —
  no screen recording, keystroke capture, browsing history, or background monitoring.
- **Gmail is optional and attended-only.** Sync runs from a manual click or a throttled
  auto-check while the page is open — no continuous mailbox monitoring in the initial version.

## Development

```
npm install
npm run dev          # apps/web dev server
npm run lint
npm run typecheck
npm run test         # vitest, all workspaces
npm run test:e2e      # playwright, apps/web
```

Requires a `.env` (see `.env.example`) with Supabase project credentials and
`ANTHROPIC_API_KEY` for `packages/ai`.
