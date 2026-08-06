/**
 * Server-only Claude integration — deterministic retrieval, prompting, and the
 * unsupportedClaims rejection gate described in docs/AI_GROUNDING.md. Implemented in
 * Phase 3 (docs/IMPLEMENTATION_PLAN.md). Intentionally empty until then: this package exists
 * now only so it's a real workspace member with a valid dependency graph.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — the Claude API key lives only in code paths this
 * package is reached from.
 */
export {};
