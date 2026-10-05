/**
 * Server-only Gmail integration — OAuth, sync (manual click or throttled auto-check on page
 * load), classification, and minimal-retention signal storage described in
 * docs/EMAIL_INTEGRATION.md.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — Gmail OAuth secrets and refresh tokens live only in code
 * paths this package is reached from.
 */
export { buildAuthUrl, exchangeCodeForTokens, revokeToken } from './oauth';
export type { ExchangedTokens } from './oauth';
export { MAX_CONCURRENT_BACKGROUND_SYNC_USERS, MAX_USERS_PER_BACKGROUND_SYNC_RUN } from './config';
export { runGmailSync } from './sync';
export type { RunGmailSyncOptions, RunGmailSyncResult } from './sync';
export {
  extractApplicationIdentity,
  extractCompanyName,
  extractJobTitle,
  UNDETECTED_TITLE_PLACEHOLDER,
} from './extract-application-identity';
export type { ExtractedApplicationIdentity } from './extract-application-identity';
