# Email Integration

Gmail sync is optional, off by default (`gmail_integration_enabled` feature flag, plus a
per-user toggle in `user_settings`), and **attended-only** in v1 — every sync run happens
inside a real request made while the signed-in user actually has the app open, never while
they're away. Two things trigger it:

- **Manual.** The user clicks **Sync Gmail** in `/settings`.
- **Throttled auto-check on page load.** `/settings` also fires the same sync automatically
  when the page loads or reloads, if the connection's last sync was more than five minutes
  ago (`AUTO_SYNC_THROTTLE_MS` in `apps/web/app/(app)/settings/gmail-section.tsx`).

Neither is background/unattended sync. The distinction this doc cares about is **attended vs.
unattended**, not **click vs. no-click**: there is still no cron job, no webhook, no push
notification, no IMAP idle connection, and no polling that runs while the user doesn't have
the page open. See `docs/IMPLEMENTATION_PLAN.md`'s Phase 5 auto-sync note for why the
auto-check was added on top of the originally-specified manual-only design.

## 1. Flow

1. **Server-side OAuth.** User clicks "Connect Gmail" in `/settings`. Authorization happens
   through Google's server-side OAuth flow (`packages/email`); the extension is not involved
   and never sees the Gmail token. On success, an `email_connections` row is created with the
   refresh token encrypted at rest (§5).
2. **Sync runs — manual click or throttled auto-check, always attended.** Either the user's
   **Sync Gmail** click or the page-load auto-check (see above) hits the same
   `POST /api/gmail/sync` route — there is no separate code path for the two. Nothing else
   triggers a sync: no scheduled/cron job, no webhook, no IMAP idle connection, independently
   of a real page load initiated by the signed-in user.
3. **Search.** Server searches the mailbox (Gmail API `messages.list` with a query scoped to
   likely recruiting senders/subjects) for candidate messages — retrieving only what's needed
   for classification (headers + snippet), not full raw MIME bodies by default.
4. **Deterministic classification first.** Keyword and sentence-context rules run against
   subject/sender/snippet to classify into `APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW,
ACTION_REQUIRED, OFFER, REJECTED, OTHER`. This handles the large majority of
   recognizable ATS-generated emails (predictable phrasing, known sender domains) without
   any model call.
5. **Claude fallback for ambiguous cases only.** Only messages the deterministic rules can't
   confidently classify are sent to Claude — and only the minimal already-retrieved
   sender/subject/snippet, not the full email, following the same data-minimization principle
   as `docs/AI_GROUNDING.md` §6.
6. **Match to an application.** Each classified message is matched against the user's
   `applications` (by company name, sender domain, and job title overlap).
7. **Return classification + confidence + evidence.** Every result carries a short,
   human-readable evidence string (e.g. "subject contains 'interview availability'"), not
   the underlying reasoning trace.
8. **Confidence threshold.** Matches with confidence ≥ 0.85 are proposed directly (still
   shown to the user as a pending timeline update, not silently written); anything below 0.85
   requires explicit user confirmation before it touches `application_events`.
9. **Dedup.** `email_signals` has a unique constraint on `(email_connection_id,
provider_message_id)` (see `docs/DATA_MODEL.md`), so re-running sync never reprocesses or
   duplicates a message already seen.
10. **Disconnect + delete.** User can disconnect Gmail and delete all stored signals at any
    time; disconnecting revokes the OAuth grant server-side (not just deletes the local row)
    and deletes the `email_connections` row, cascading to `email_signals`.

## 2. Classification categories

`APPLICATION_RECEIVED, ASSESSMENT, INTERVIEW, ACTION_REQUIRED, OFFER, REJECTED, OTHER`

These map directly onto a subset of the `applications.status` values in
`docs/DATA_MODEL.md`; `OTHER` covers anything recruiting-adjacent but not
timeline-relevant (e.g. a newsletter from a job board), and is never proposed as a status
change.

## 3. Data minimization — what is stored vs. discarded

Stored in `email_signals` (see `docs/DATA_MODEL.md` for exact columns):

- Provider message ID (for dedup)
- Sender + sender domain
- Subject
- Received date
- Matched application ID
- Classification + confidence
- Short evidence string
- Processing timestamp

**Never stored by default:** the full email body. The classification pipeline reads the
snippet/body transiently in server memory during processing and discards it after producing
the classification + evidence — it does not persist to any table or log. If a future version
needs to store more (e.g. for user-visible "why did you classify this way" beyond the short
evidence string), that requires an explicit opt-in and a documented retention change, not a
silent expansion of what's captured.

## 4. Required Gmail scopes

Minimum viable scope is `gmail.readonly` (or more narrowly, `gmail.metadata` if the
deterministic rules can operate on headers/snippets alone without full read access — to be
confirmed during Phase 5 implementation). Career OS does not request `gmail.modify` or
`gmail.send` — it never sends, labels, or deletes anything in the user's mailbox.

## 5. Token security

- `email_connections.encrypted_refresh_token` is encrypted at rest using a server-side key
  (e.g. via Supabase Vault or an application-level envelope-encryption key stored outside the
  database) — never stored as plaintext, and never returned by any API response.
- The Gmail refresh token is used exclusively inside `packages/email`, server-side; it is
  never sent to the client, the extension, or logged.
- Disconnecting revokes the token at Google (`https://oauth2.googleapis.com/revoke` or
  equivalent) in addition to deleting the local row, so a leaked-but-revoked token is inert.

## 6. Gmail OAuth verification concerns (see also `docs/SECURITY_AND_PRIVACY.md`)

Requesting Gmail read scopes triggers Google's OAuth app verification process once the app
is used by more than a handful of test users. Concretely:

- **Restricted scope review.** `gmail.readonly` is a "restricted" scope. Google requires a
  security assessment (including, for some scope combinations, a third-party CASA
  assessment) before the app can be used by the general public. This is a real cost/timeline
  item, not just a checkbox — budget for it before Phase 7 public opt-in, not before Phase 5
  private use.
- **Unverified-app screen.** Until verified, Google shows an "unverified app" warning to any
  user connecting Gmail. This is acceptable for the product owner and a small, explicitly
  added test-user list (Google allows up to 100 test users on an unverified OAuth consent
  screen in "Testing" publishing status) but is a hard blocker for open public signups.
- **Privacy policy and scope justification.** Verification requires a published privacy
  policy (covering exactly what's read and stored — this document plus
  `docs/SECURITY_AND_PRIVACY.md` are the source for that copy) and a demo video showing the
  actual OAuth consent and usage flow.
- **Limited use policy.** Gmail API data is subject to Google's API Services User Data
  Policy, including the Limited Use requirements — classification-only use, no ads, no
  reselling data, no use beyond the disclosed feature. The data-minimization approach in §3
  is designed specifically to keep the app's actual behavior trivially compliant with this
  policy, not just documented as compliant.
- **Practical sequencing implication:** keep Gmail integration scoped to test users
  (`docs/IMPLEMENTATION_PLAN.md` Phase 5–6) until verification is either complete or
  consciously deferred; do not flip `public_signups_enabled` on while `gmail_integration_
enabled` would expose the unverified-app screen to strangers.
