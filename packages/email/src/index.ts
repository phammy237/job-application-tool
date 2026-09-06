/**
 * Server-only Gmail integration — OAuth, manual sync, classification, and minimal-retention
 * signal storage described in docs/EMAIL_INTEGRATION.md.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — Gmail OAuth secrets and refresh tokens live only in code
 * paths this package is reached from.
 */
export { buildAuthUrl, exchangeCodeForTokens, revokeToken } from './oauth';
export type { ExchangedTokens } from './oauth';
export { runGmailSync } from './sync';
export type { RunGmailSyncResult } from './sync';
