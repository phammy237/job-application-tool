# RLS isolation tests

pgTAP tests proving Row Level Security actually isolates one user's data from another's, per
`docs/DATA_MODEL.md` "RLS policy pattern" and the CLAUDE.md rule that every new table ships
with an RLS test in the same PR that creates it.

## Running

Requires the Supabase CLI and Docker (neither was available in the environment this Phase 1
scaffold was built in — these tests are written and ready but have **not** been executed
against a real Postgres instance yet; run them before treating Phase 1's RLS guarantees as
verified):

```
supabase start
supabase test db
```

`supabase test db` runs every `*.test.sql` file in this directory with `pg_prove` against a
fresh local database that already has `supabase/migrations/` applied.

## Pattern

Each file is self-contained: it creates two throwaway `auth.users` rows (`user A`, `user B`)
inside its own transaction, impersonates each in turn via
`set local request.jwt.claims`, and asserts:

1. User A can create and read their own row.
2. User B's `select` of user A's row returns zero rows (not an error — RLS filters, it
   doesn't reject the query).
3. User B's `update`/`delete` targeting user A's row affects zero rows.
4. User A can still update/delete their own row.

The whole file runs inside `begin; ... rollback;`, so these tests never leave residue in a
real database.

## Coverage

One file per Phase 1 user-owned table (`profiles`, `resumes`, `candidate_facts`,
`experiences`, `education`, `projects`, `skills`, `jobs`, `applications`,
`application_events`, `user_settings`), plus `feature_flags`, which gets a different test
shape (readable by anyone, writable by no one at the application layer).
