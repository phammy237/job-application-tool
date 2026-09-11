/**
 * `gmail.readonly`, not the narrower `gmail.metadata` — see docs/IMPLEMENTATION_PLAN.md's
 * Phase 5 design decision. `gmail.metadata` doesn't reliably guarantee the `snippet` field this
 * pipeline depends on for both search and classification evidence; the implementation still only
 * ever requests `format=metadata` on individual message fetches (never full raw MIME), so the
 * broader scope doesn't change what's actually retrieved or stored.
 */
export const GOOGLE_OAUTH_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';

/** Every sync run — a manual click or the throttled auto-check on page load — is a synchronous
 * request/response with no background jobs (spec explicitly excludes unattended polling) — this
 * bounds worst-case request duration. A user needing more just clicks Sync Gmail again (or
 * reloads the page); the dedup constraint + last_synced_at make repeated syncs cheap and safe. */
export const MAX_MESSAGES_PER_SYNC = 25;

/**
 * Deliberately keyword/sender-scoped rather than "all mail" — narrows both what's fetched (data
 * minimization, docs/EMAIL_INTEGRATION.md §3) and what needs classifying. Tunable without a code
 * change, same pattern as packages/ai/src/config.ts's retrieval constants.
 */
export const GMAIL_SEARCH_QUERY =
  'newer_than:180d (subject:(application OR applying OR interview OR "next steps" OR assessment ' +
  'OR "coding challenge" OR offer OR "not moving forward" OR "other candidates" OR rejected) ' +
  'OR from:(careers OR recruiting OR talent OR noreply OR no-reply OR jobs OR hiring))';
