# Security and Privacy

## 1. Threat model summary

What Career OS protects, and against what:

| Asset                                                                 | Primary threat                                           | Primary control                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Résumés, candidate facts, applications                                | Cross-user data leakage (one user seeing another's data) | RLS on every table + server-side re-check, `docs/DATA_MODEL.md`                                         |
| Claude API key, Supabase service-role key, Google OAuth client secret | Client-side exposure                                     | Server-only packages (`packages/ai`, `packages/email`, `packages/database`), never imported client-side |
| Gmail refresh tokens                                                  | Theft from the database, or from logs                    | Encryption at rest, never logged, revoked on disconnect                                                 |
| Extension session tokens                                              | Theft from a compromised device                          | Hashed at rest, short-lived, individually revocable                                                     |
| Generated answers                                                     | Fabricated claims presented as factual                   | Deterministic retrieval + Zod contract + rejection gate, `docs/AI_GROUNDING.md`                         |
| User's browsing / page content                                        | Over-broad extension surveillance                        | `activeTab`-only permission model, click-triggered analysis, `docs/EXTENSION_DESIGN.md`                 |
| Sensitive form categories (demographic, legal)                        | Accidental auto-completion                               | Structural exclusion — no suggestion is ever generated for these classifications                        |
| Job posting content (job snapshots, requirement mappings, Phase 5A)   | Prompt injection via untrusted posting text; privileged RPC misuse | Same tagged-untrusted-data posture as `docs/AI_GROUNDING.md`; every Phase 5A write RPC is `service_role`-only, never callable by an authenticated user's own session |

## 2. Multi-user isolation

- Every user-owned table has `user_id` and RLS enabled with `auth.uid() = user_id` policies
  for all four operations (`docs/DATA_MODEL.md` "RLS policy pattern").
- RLS is the enforcement boundary, but **not the only check**: any server code path that uses
  the Supabase service-role key (which bypasses RLS by design — needed for a few admin/cron
  operations) must independently filter by the authenticated `user_id` before touching a row.
  This is a standing code-review requirement, called out in `CLAUDE.md`.
- The extension never sends a raw `user_id` the server trusts; the server derives it from the
  verified session token on every request.
- No code path anywhere assumes there is exactly one user or hardcodes an identifier for the
  product owner.
- **Server-only RPC boundary (Phase 5A)**: `upsert_application_with_snapshot` and every
  requirement-mapping lifecycle function (`create_pending_requirement_mapping_run`,
  `mark_requirement_mapping_run_failed`, `promote_requirement_mapping_run`, plus internal
  helpers) are granted to `service_role` only — `revoke ... from public, anon, authenticated`
  in migration `0010`. This closed a real confused-deputy gap discovered in the pre-existing
  `upsert_application_from_extension` (which had been grantable to `authenticated`, trusting a
  `p_user_id` parameter rather than deriving it from `auth.uid()`): a signed-in user could
  otherwise call these functions directly via `supabase.rpc(...)` on behalf of any other user
  whose job/snapshot/run id they could learn or guess, since the functions run with the calling
  role's effective RLS-bypass state, not with the identity of whichever `p_user_id` they're
  told to act as. `upsert_application_from_extension` itself received the same grant fix.
- **Structural (not just RPC-code) ownership** for the three new Phase 5A tables: every
  parent-child link (`applications.job_snapshot_id → job_snapshots`,
  `requirement_mapping_runs.job_snapshot_id → job_snapshots`,
  `requirement_evidence_mappings.run_id → requirement_mapping_runs`) is a composite foreign
  key over `(user_id, id)`, not a plain `id` reference — a child row naming a parent owned by a
  different user is rejected by the database itself, not only by application-layer checks.

## 3. Secrets

Never exposed to the client, the extension bundle, logs, or version control:

- Supabase service-role key
- Claude API key
- Google OAuth client secret
- Gmail refresh tokens (see §4 for at-rest handling)

Mechanism: these live only in server-side environment variables consumed by Next.js API
routes / server components, and only within `packages/ai`, `packages/email`, and the
service-role code paths of `packages/database`. `apps/extension` ships with zero secrets —
its only credential is a short-lived, revocable, hashed session token. `.env*` files are
gitignored; a secret-scanning pre-commit hook (or CI check) is part of Phase 1 repository
setup.

## 4. Encryption at rest

- `email_connections.encrypted_refresh_token` is encrypted before it is written, using a key
  that is itself not stored in the same database (Supabase Vault, or an application-level KMS
  key) — so a database dump alone does not yield usable tokens.
- Supabase Storage (résumé files) relies on private, non-public buckets scoped by `user_id`
  path prefix, with Storage RLS policies mirroring the table policies.

## 5. Deletion flows

All five deletion flows in `docs/USER_FLOWS.md` §8 are first-class product features, not
support tickets: single application, résumé, generated content, Gmail disconnect, and full
account deletion (cascading via `on delete cascade` from `auth.users`, per
`docs/DATA_MODEL.md`). Account deletion additionally revokes the Gmail OAuth grant at Google
before the row cascade completes, so deletion doesn't leave a live external token behind.

`job_snapshots`, `requirement_mapping_runs`, and `requirement_evidence_mappings` (Phase 5A)
cascade the same way — `user_id references auth.users(id) on delete cascade` — so a full
account deletion removes them along with everything else. There is no independent, per-row
deletion path for these three tables in Phase 5A: `job_snapshots` and
`requirement_evidence_mappings` block all `update`s at the database level (see
`docs/DATA_MODEL.md`), and deleting a single snapshot or mapping isn't a capability exposed
anywhere in the product yet — the cascade only ever fires as part of full account deletion.

`contacts` (Phase 6A) is the first user-owned table to also expose a genuine **per-row** delete
in the UI (`/network/[id]` "Delete contact"), not only the full-account cascade — deleting a
contact cascades to its own `contact_tags` and `application_contacts` rows but never touches the
applications it was linked to, and deleting an application never deletes a contact linked to it
(verified in `supabase/tests/database/0021_networking_contacts.test.sql`). Contact `notes` are
never logged or included in any AI request (Phase 6A makes zero AI calls) or public surface.

`contact_interactions` (Phase 6B) is user-editable, not immutable-history — a genuine per-row
update and delete, both in the UI. Deleting a contact cascades to its interactions; deleting the
application an interaction referenced only clears that one column (`application_id`), preserving
the interaction as real history rather than silently erasing it; deleting an interaction never
touches the contact or application it referenced (verified in
`supabase/tests/database/0022_contact_interactions.test.sql`). Interaction `subject`/`notes` are
never logged or included in any AI request (Phase 6B also makes zero AI calls) or public surface.

## 6. AI-specific risk: fabrication

Covered in full in `docs/AI_GROUNDING.md`. Summarized here as a security/privacy concern
because a fabricated work-authorization or experience claim submitted on a real job
application is a real-world harm (misrepresentation to an employer), not just a quality bug.
Mitigated by: retrieval restricted to approved facts, the `unsupportedClaims` self-report
gate, and Zod schema validation — both gates must pass before any answer reaches the user.

## 7. Extension permission risk

Covered in full in `docs/EXTENSION_DESIGN.md` §1–2. Summarized here: the extension requests
`activeTab` + `scripting` + `storage` only, no host permissions, no `webRequest`/`tabs`/
`history`. This is a deliberate ceiling — DOM access exists only in the window between a user
click and the resulting analysis/autofill call, not as a standing capability. Any future
permission expansion should be treated as a security-review event, not a routine manifest
edit.

**Phase 2 addition, treated as exactly that security-review event** (full detail in
`docs/EXTENSION_DESIGN.md` §1a): `externally_connectable` and a pinned `key` were added to the
manifest for the auth-token handoff from `/extension-connect`. Risk assessment:

- `externally_connectable` does not grant DOM/browser data access — it only whitelists which
  page origins may open a message channel to the extension's own background worker. The
  whitelist is the single Career OS web origin; no other site can reach this channel.
- The message handler independently validates the payload shape before acting on it
  (`isExternalTokenHandoffMessage` in `apps/extension/src/types/chrome-messages.ts`), so even a
  compromised or misconfigured whitelist entry couldn't inject an arbitrary value into
  `chrome.storage.local` — only a shape-conforming `{ type: 'CAREER_OS_EXTENSION_TOKEN', token,
  expiresAt }` message is accepted.
- The one thing an attacker who fully controlled the whitelisted origin (i.e. Career OS itself
  were compromised) could do is hand the extension an arbitrary bearer token — but that's
  already true of the existing token-mint endpoint's blast radius (`POST
  /api/auth/extension-token`) and isn't a new capability this manifest field introduces.
- `key` is a public value with no confidentiality requirement; it only stabilizes the
  extension's ID across rebuilds and carries no capability of its own.

## 8. Gmail OAuth risk

Covered in full in `docs/EMAIL_INTEGRATION.md` §6. Summarized here: restricted-scope
verification, the unverified-app warning screen, and Limited Use policy compliance are all
real constraints on when Gmail integration can be offered beyond a small test-user list — not
solved by this repo's code alone, and should factor into the Phase 5/6/7 timeline.

## 9. Public surface risk

The public landing page and any future public profile export must not become an accidental
data leak. Controls: route-group separation between public and authenticated pages
(`docs/ARCHITECTURE.md` §5), `visible_on_public_profile` defaulting to `false` on every fact
and on `profiles`, and demo/seed content that is verified to contain no real personal
information (`supabase/seed.sql`). Any future public-profile export endpoint
(`docs/ARCHITECTURE.md` §6) must filter on `visible_on_public_profile = true` at the query
level, not filter in the response layer.

## 10. Dependency and platform risk (lighter-touch, tracked not deeply mitigated yet)

- Standard practices apply once implementation starts: dependency updates, `npm audit` in
  CI, and not committing `.env` files — these are Phase 1 setup items rather than open design
  questions.
- Supabase project is dedicated to Career OS (§ separation from mypham.space below) so a
  compromise of one product's database credentials cannot touch the other's data.

## 11. Separation from mypham.space

- Separate GitHub repository, separate Supabase project, separate hosting/deploy pipeline
  (see `docs/DEPLOYMENT.md`), separate secrets. No shared environment variables, no shared
  service-role key, no shared session/cookie domain beyond the public DNS relationship
  between `mypham.space` and `apply.mypham.space` (which is just a subdomain link, not a
  trust relationship — Career OS does not accept a `mypham.space` session as proof of
  identity).
- The only planned data flow (Phase 8, optional) is a one-directional, explicitly-formatted
  JSON export of already-public-marked profile facts — never a shared table, never scraped
  HTML treated as a source of truth. See `docs/ARCHITECTURE.md` §6.

## 12. Known unresolved risks going into Phase 1

These are flagged now so they're revisited with intent rather than discovered late:

1. **Encryption key management** for `encrypted_refresh_token` — Supabase Vault vs.
   application-level KMS is a Phase 5 decision that affects how key rotation works; not yet
   chosen.
2. **Rate-limit enforcement point** for AI requests — whether `ai_requests_this_period` is
   checked/incremented atomically enough to prevent a race under concurrent requests needs a
   concrete implementation (likely a Postgres function with row locking) in Phase 3.
3. **Extension token refresh UX** — how a revoked/expired `extension_sessions` token
   surfaces to the user mid-flow (silent re-auth prompt vs. hard failure) is a Phase 2 UX
   decision, not yet made.
4. **Gmail verification timeline** — whether to pursue Google's CASA/restricted-scope
   verification at all before any public signup phase, or keep Gmail permanently in a
   test-user-only posture, is a product decision deferred to Phase 7/8 planning.
5. **Backup/export** — no documented process yet for a user to export their own data
   wholesale (distinct from account deletion); worth deciding before public beta so "delete
   my account" isn't the only way a user can get their data out.
