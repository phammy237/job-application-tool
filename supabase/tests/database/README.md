# RLS isolation tests

pgTAP tests proving Row Level Security actually isolates one user's data from another's, per
`docs/DATA_MODEL.md` "RLS policy pattern" and the CLAUDE.md rule that every new table ships
with an RLS test in the same PR that creates it.

## Running

With Docker available:

```
supabase start
supabase test db
```

`supabase test db` runs every `*.test.sql` file in this directory with `pg_prove` against a
fresh local database that already has `supabase/migrations/` applied.

Without Docker (e.g. this environment), each file can be run individually against a linked
remote project instead, via `supabase db query --linked -f <file>`. That command only surfaces
the *last* statement's result set, so pgTAP's individual `ok`/`not ok` lines from earlier
statements in the file are otherwise invisible — route every assertion's output into a
temp-table log and aggregate it into one final `select` before `rollback` to see the full
report. All 12 files here have been run this way and pass (56/56 assertions).

## Pattern

Each file is self-contained: it creates two throwaway `auth.users` rows (`user A`, `user B`)
inside its own transaction, impersonates each in turn via
`set local request.jwt.claims`, and asserts:

1. User A can create and read their own row.
2. User B's `select` of user A's row returns zero rows (not an error — RLS filters, it
   doesn't reject the query).
3. User B's `update`/`delete` targeting user A's row affects zero rows — verified by switching
   *back* to user A's claims before reading the result. Checking as user B instead proves
   nothing: user B's own `select` of user A's row is already blocked by policy #2 regardless of
   whether the write succeeded, so re-reading as B can't distinguish "write blocked" from "read
   blocked." (An earlier version of these tests made exactly this mistake — some assertions
   read back as user B and either passed trivially or failed spuriously, independent of
   whether the underlying policy was actually correct.)
4. User A can still update/delete their own row.

The whole file runs inside `begin; ... rollback;`, so these tests never leave residue in a
real database.

## Coverage

One file per Phase 1 user-owned table (`profiles`, `resumes`, `candidate_facts`,
`experiences`, `education`, `projects`, `skills`, `jobs`, `applications`,
`application_events`, `user_settings`), plus `feature_flags`, which gets a different test
shape (readable by anyone, writable by no one at the application layer).
