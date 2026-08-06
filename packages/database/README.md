# packages/database

Supabase client factory, typed query helpers, and generated database types. Wraps all
row-level-security-sensitive access so every query is scoped to the authenticated user; no
app code should import `@supabase/supabase-js` directly outside this package.

**Status:** Phase 1 scaffolded — `client/browser.ts`, `client/server.ts`, `client/admin.ts`,
hand-authored `types/database.types.ts`, and query modules for every Phase 1 table under
`src/queries/`. `types/database.types.ts` is hand-maintained until a live Supabase project
exists to run `supabase gen types` against — keep it in sync with
`supabase/migrations/0001_init.sql` by hand until then. See `docs/DATA_MODEL.md`.
