/**
 * Server-only Gmail integration — OAuth, manual sync, classification, and minimal-retention
 * signal storage described in docs/EMAIL_INTEGRATION.md. Implemented in Phase 5
 * (docs/IMPLEMENTATION_PLAN.md). Intentionally empty until then.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — Gmail OAuth secrets and refresh tokens live only in code
 * paths this package is reached from.
 */
export {};
