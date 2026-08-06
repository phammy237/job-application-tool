# CLAUDE.md — Permanent Engineering Rules for Career OS

This file governs how AI-assisted work happens in this repository. It is not a product
description — see `docs/PRODUCT_SPEC.md` for that. These rules take precedence over
convenience or speed in every case listed below.

## Repository identity

- This repo is **Career OS**, deployed at `apply.mypham.space`, fully separate from the
  repository behind `mypham.space`. Never modify, recreate, scrape, or assume access to the
  personal-site repository, its database, or its deployment credentials from here. The only
  sanctioned connection point is the optional, versioned JSON export/import described in
  `docs/ARCHITECTURE.md` §6 — never a live database link, never scraped HTML.

## Multi-tenancy is non-negotiable

- **Never hardcode a user.** No email address, UUID, or "is this the owner" branch anywhere
  in `apps/` or `packages/`. Every feature is built as if a hundred strangers already use it,
  even while only one real user exists.
- **Every user-owned table has `user_id` and RLS.** When adding a table, the migration that
  creates it must also enable RLS and add the four standard policies
  (`docs/DATA_MODEL.md` "RLS policy pattern") in the same PR — never as a follow-up.
- **RLS is the backstop, not the only check.** Any code path using the Supabase
  service-role key (which bypasses RLS) must independently filter by the authenticated
  `user_id` before reading or writing. Frontend filtering alone is never sufficient
  authorization anywhere in this codebase.
- **The extension never sends a trusted `user_id`.** The server always derives `user_id` from
  the verified session/token, never from a client-supplied field.

## Secrets

- Never let `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  or any Gmail refresh token reach client-side code, the extension bundle, logs, or a
  committed file. `packages/ai` and `packages/email` are server-only by construction — do not
  import them from a `"use client"` module or from anything under `apps/extension`.
- Gmail refresh tokens are stored encrypted at rest (`email_connections.
  encrypted_refresh_token`) — never plaintext, never returned in an API response.

## AI grounding — the single most important rule in this repo

- **Never invent a fact.** Claude may only rephrase, rank, and combine facts the user has
  already approved (`user_approved = true and approved_for_applications = true`). If approved
  facts are insufficient to answer something, the correct output is "cannot answer" — not a
  plausible guess. Full pipeline: `docs/AI_GROUNDING.md`.
- Every generated answer must pass **both** the `unsupportedClaims` self-report check and Zod
  schema validation before a user ever sees it. Do not add a code path that surfaces a
  response that failed either check, even temporarily for debugging — gate it behind a
  clearly-labeled dev-only flag if inspection is genuinely needed.
- `reasoningSummary` is user-facing text about which approved facts were used — never raw
  model chain-of-thought. Do not log or store chain-of-thought reasoning anywhere.

## Extension permission discipline

- The extension's permission set is `activeTab`, `scripting`, `storage` — no host
  permissions, no `webRequest`/`tabs`/`history`/`cookies`/`debugger`. Adding any permission
  beyond this set is a security-review event: it requires updating
  `docs/EXTENSION_DESIGN.md` §1–2 and `docs/SECURITY_AND_PRIVACY.md` §7 in the same PR, with
  an explicit justification, not just a manifest edit.
- The content script only runs after an explicit user action (icon click / popup button). Do
  not add any `content_scripts` match-pattern that would run automatically on page load.
- Never add screen capture, keystroke capture, browsing-history access, or background/idle
  tab monitoring. Never let the extension read `AUTHENTICATION`-classified fields
  (passwords, login forms) at all — exclude them from extraction, don't extract-then-ignore.
- The extension never submits a form. The furthest write action is filling
  user-approved field values; the submit click is always the human's.

## Form-field classification is enforcement, not labeling

- Fields classified `DEMOGRAPHIC`, `LEGAL`, or `AUTHENTICATION` never get a generated
  suggestion, ever — not a low-confidence one, not one requiring extra approval. There is
  structurally no suggestion to approve for these classifications. See
  `docs/EXTENSION_DESIGN.md` §6 for the full table.
- Fields classified `EXPERIENCE`, `FREE_RESPONSE`, `WORK_AUTHORIZATION`, `RELOCATION`, and
  `COMPENSATION` always require an explicit per-field user approval click before autofill —
  never pre-checked, never bulk-approved by default.

## Data minimization

- Gmail integration stores only the fixed `email_signals` column set
  (`docs/DATA_MODEL.md`) — never full email bodies by default. Don't add a column or log line
  that captures more than that set without updating `docs/EMAIL_INTEGRATION.md` §3 first.
- Claude calls send only the top-N ranked, already-approved facts relevant to the specific
  field being answered — never the user's full profile, never unapproved facts.

## Public/private boundary

- Public routes (`app/(public)/...`) must never query a user-owned table. If a public page
  needs data, it comes from `feature_flags`, static content, or the filtered public-profile
  export (`visible_on_public_profile = true`, filtered at the query level, not in a
  post-processing step).
- Default every new "is this visible publicly" field to `false`. Nothing becomes public by
  omission.

## Workflow

- **Planning-first stays the default posture.** Don't jump ahead of the current
  `docs/IMPLEMENTATION_PLAN.md` phase without discussing it — each phase is scoped
  intentionally, and later phases assume earlier ones are solid (e.g. don't build Gmail
  classification before RLS is proven correct in Phase 1).
- **Every new table ships with an RLS test** proving cross-user isolation, in the same PR
  that adds the table — not deferred to Phase 6 hardening.
- **Don't add billing.** `user_settings.ai_request_limit` is the only seam reserved for a
  future plan/billing system; do not build payment processing, plan enforcement beyond the
  existing per-user AI limit, or subscription logic unless explicitly asked.
- When a decision in this file conflicts with something faster or simpler, the rule in this
  file wins. If a rule genuinely seems wrong for a specific case, raise it explicitly rather
  than quietly working around it.
