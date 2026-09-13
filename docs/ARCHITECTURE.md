# Architecture

## 1. Repository and product boundary

Career OS lives in its own GitHub repository, fully independent from the repository behind
`mypham.space`. There is no shared codebase, no shared database, and no shared deployment
pipeline. The only connection between the two products is:

- `mypham.space` may link to `apply.mypham.space` as a listed project.
- `apply.mypham.space` may, in the far future (Phase 8), consume a small, explicitly-defined
  public export/import format from `mypham.space` — never a live database connection, and
  never scraped HTML. See "Personal site integration" below and `docs/DEPLOYMENT.md` for the
  domain/DNS split.

Nothing in this repository assumes access to the personal site's source, database, hosting
account, or secrets. Treat `mypham.space` as an unrelated third-party site that happens to
share a domain suffix and an owner.

## 2. Monorepo layout

```
job-application-tool/
├── apps/
│   ├── web/                 # Next.js App Router — dashboard + public landing page
│   └── extension/           # Chrome MV3 extension — React + Vite
├── packages/
│   ├── shared/               # Zod schemas + TS types shared by web and extension
│   ├── ui/                   # shadcn/ui component library + design tokens
│   ├── ai/                   # Server-only Claude integration (retrieval, prompting, validation)
│   ├── email/                 # Server-only Gmail integration (OAuth, classification)
│   └── database/             # Supabase client + typed query layer (RLS-aware)
├── supabase/
│   ├── migrations/           # SQL migrations (schema + RLS policies)
│   └── seed.sql               # Non-personal demo data only
├── docs/                     # This documentation set
├── CLAUDE.md                 # Permanent engineering rules for AI-assisted work in this repo
└── README.md
```

npm workspaces will tie `apps/*` and `packages/*` together once repository setup begins in
Phase 1 (root `package.json`, shared `tsconfig`, ESLint/Prettier config). None of that
tooling exists yet — this document describes the target shape.

### Why this split

- **`packages/shared` is the contract.** The extension and the web app are built with
  different bundlers (Vite vs. Next.js) and run in different runtimes (content script /
  service worker vs. server + browser). The only thing that must stay byte-for-byte
  consistent between them is the shape of a candidate fact, a job extraction payload, a
  form-field classification, and a generated answer. Putting those Zod schemas in one package
  makes drift a type error instead of a runtime bug discovered in production.
- **`packages/ai` and `packages/email` are server-only by construction.** They are never
  imported by `apps/extension` or by any "use client" module in `apps/web`. This is enforced
  architecturally (see `docs/SECURITY_AND_PRIVACY.md`) so the Claude API key and Gmail OAuth
  secrets have exactly one possible egress path: Next.js server code / API routes.
- **`packages/database` is the only Supabase touchpoint.** All row access goes through one
  package so RLS assumptions (see §4) are enforced in one place and can be unit tested in
  one place, rather than re-derived at every call site.
- **The extension talks to the API, not the database.** `apps/extension` holds a Career OS
  session token and calls authenticated Career OS API routes. It never holds a Supabase key,
  a Claude key, or a Gmail token. If the extension is ever fully decompiled by a user, nothing
  sensitive leaks beyond what that user's own session already grants them.

## 3. System diagram

```
┌─────────────────────────┐        ┌────────────────────────────┐
│   apps/extension (MV3)   │        │      apps/web (Next.js)      │
│                           │        │                              │
│  popup UI (React)         │  HTTPS  │  /                → public   │
│  content script            │◄──────►│  /dashboard...    → authed  │
│  background service worker │  authed │  /api/*           → server  │
└─────────────────────────┘  fetch  └──────────┬───────────────────┘
                                                 │
                     imports (server-only)       │  imports
              ┌──────────────────────────────────┼───────────────────┐
              │                                  │                    │
    ┌─────────▼─────────┐              ┌─────────▼─────────┐  ┌───────▼──────┐
    │  packages/ai        │              │ packages/database  │  │ packages/ui   │
    │  (Claude, server-only)│            │ (Supabase client,  │  │ (shared with  │
    └─────────┬─────────┘              │  RLS-aware queries) │  │  web + popup) │
              │                         └─────────┬─────────┘  └──────────────┘
    ┌─────────▼─────────┐                          │
    │  packages/email      │                          │
    │  (Gmail, server-only)│                          │
    └─────────┬─────────┘                          │
              │                                     │
    ┌─────────▼─────────────────────────────────────▼─────────┐
    │                    Supabase project (Career OS only)      │
    │   Postgres + RLS · Auth · Storage                          │
    └─────────────────────────────────────────────────────────┘

    ┌─────────────────┐   ┌────────────────────┐
    │  Claude API       │   │  Gmail API (OAuth)  │      external, called only from
    │  (server-side key) │   │  (server-side OAuth) │     packages/ai and packages/email
    └─────────────────┘   └────────────────────┘
```

`packages/shared` is not drawn as a node — it has no runtime; it is compiled into both
`apps/web` and `apps/extension` at build time.

## 4. Multi-user architecture

Career OS is multi-tenant from the first migration, even though the only real user for a
while is the product owner. Concretely:

- **Every user-owned table carries `user_id uuid references auth.users(id)`.** There is no
  table that implicitly means "the owner's data" — see `docs/DATA_MODEL.md` for the full
  list.
- **Row Level Security is the enforcement boundary, not the frontend.** Every user-owned
  table has RLS enabled with a policy scoped to `auth.uid() = user_id` for select/insert/
  update/delete. The Next.js API routes additionally re-check `user_id` ownership
  server-side before acting — RLS is the backstop, not the only check, because a bug in a
  service-role code path (which bypasses RLS) must still fail closed.
- **No hardcoded user.** Nothing in `packages/database`, `apps/web`, or `apps/extension`
  references a specific email, UUID, or "is this me" branch. The product owner's account is
  created through the exact same signup flow as every future user, gated only by the
  `public_signups_enabled` feature flag (closed during private beta — see
  `docs/IMPLEMENTATION_PLAN.md` Phase 7/8).
- **Session-scoped extension auth.** The extension authenticates as a specific user (via
  Supabase auth session / token exchange) and every API call it makes is attributed to that
  user's `auth.uid()`. Two different users running the extension against the same job posting
  get two independent `jobs`/`applications`/`generated_answers` rows.
- **Usage limits are per-user.** AI request counts and Gmail sync frequency are tracked per
  `user_id` (see `user_settings` / rate-limit tracking in `docs/DATA_MODEL.md`), not globally,
  so the architecture doesn't need to change shape when a second real user signs up.

## 5. Public vs. private surface

`apps/web` serves both the public landing page and the authenticated product from the same
Next.js app, split by route group and enforced by middleware:

- **Public routes** (`/`, `/login`, `/join`, marketing/privacy pages): statically render
  product explanation, screenshots/demo content (using seed data, never real user data), and
  auth entry points. These routes must never query user-owned tables.
- **Authenticated routes** (`/dashboard`, `/profile`, `/applications`, `/resumes`,
  `/settings`): gated by Next.js middleware checking a valid Supabase session; every data
  fetch additionally goes through RLS as user `auth.uid()`.
- A route-group boundary (`app/(public)` vs `app/(app)`) plus a lint rule / code-review
  checklist item (see `CLAUDE.md`) prevents a public page from accidentally importing a
  component that fetches private data.

## 6. Personal site integration (future, optional)

Deferred to Phase 8 and explicitly optional. When built, it will be:

- **One-directional and format-based, not live.** Career OS can generate a sanitized public
  JSON profile (`GET /api/public-profile/:userId` returning only facts with
  `visibleOnPublicProfile = true`). `mypham.space` — or anything else — may fetch that JSON.
  Career OS never reads from `mypham.space` at runtime; the rendered site is not treated as a
  source of truth or scraped.
- **Import, if built, is a manual/reviewed action**, not a background sync: the user pastes
  or fetches a defined export from `mypham.space` and every imported fact still lands as
  `userApproved = false` until reviewed, same as résumé-extracted facts.
- **No shared tables, no shared auth.** The two products do not share a Supabase project, so
  this integration is necessarily an HTTP contract, which is what keeps the coupling loose by
  construction rather than by discipline.

## 7. Why these specific technology choices

- **Next.js App Router** — one deployable serves both the public marketing surface and the
  authenticated app, with server components keeping Claude/Gmail/Supabase-service-role code
  off the client bundle by default.
- **Supabase (Auth + Postgres + Storage + RLS)** — RLS gives per-row tenant isolation enforced
  by the database itself, not just application code, which matters because the product's
  entire premise is that user data (résumés, applications, email signals) is sensitive.
- **Zod everywhere the trust boundary changes** — job DOM extraction (untrusted HTML) →
  Claude output (untrusted generation) → Gmail messages (untrusted third-party content) all
  cross into typed, validated data before the app trusts them.
- **Chrome MV3 + `activeTab`** — the manifest and permission model are the primary technical
  control that keeps the extension from becoming a general browsing-activity monitor; see
  `docs/EXTENSION_DESIGN.md`.
- **npm workspaces** — sufficient for this repo's size (2 apps, 5 packages); avoids adopting
  a heavier monorepo tool before there's a scaling problem that justifies it.
