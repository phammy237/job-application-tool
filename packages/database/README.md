# packages/database

Supabase client factory, typed query helpers, and hand-maintained database types. Wraps all
row-level-security-sensitive access so every query is scoped to the authenticated user; no
app code should import `@supabase/supabase-js` directly outside this package.

`client/browser.ts`, `client/server.ts`, `client/admin.ts`, `types/database.types.ts`, and a
query module under `src/queries/` per table. `types/database.types.ts` is intentionally
hand-maintained, not generated — this has stayed true from Phase 1 through Phase 6A even though
a live, linked Supabase project has existed the whole time (see that file's own header comment
for the full reasoning and how to verify it against the live schema). Whoever adds a migration
updates this file by hand in the same PR. See `docs/DATA_MODEL.md`.
