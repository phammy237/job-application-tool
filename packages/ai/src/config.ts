/**
 * Single source of truth for the model id — swapping models is a one-line change here,
 * never a per-call-site edit. claude-sonnet-5, per the user's locked-in Phase 3 decision
 * (cost/latency over claude-opus-5 for this short, structured-JSON, single-turn call).
 */
export const MODEL_ID = 'claude-sonnet-5';

/** Non-streaming call, short structured JSON output — well under the ~16k threshold that
 * would require streaming to avoid HTTP timeouts. */
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * Re-exported from packages/shared (not defined here) starting Phase 4, so the extension's
 * popup — banned from importing this package, see apps/extension/.eslintrc.json — can enforce
 * the identical structural refusal client-side instead of only relying on this package's
 * generate-suggestion.ts to say no. Checked first there too, before any DB read or Claude call
 * — this remains the server-side enforcement point regardless of what the client does.
 */
export { NEVER_SUGGEST_CLASSIFICATIONS } from '@career-os/shared';

/** Retrieval/ranking tuning — deliberately in one place so retuning is a config change,
 * not a code change. See packages/ai/src/retrieval/score-fact.ts and rank-facts.ts. */
export const RANKING_TOP_N = 8;
export const MIN_RELEVANCE_SCORE = 0.15;

/** Truncation caps applied after retrieval/ranking (never drops a selected fact, only trims
 * its text) — bounds worst-case prompt size and, per docs/AI_GROUNDING.md §2, worst-case
 * injected content volume. */
export const JOB_DESCRIPTION_CHAR_CAP = 4000;
export const FACT_TEXT_CHAR_CAP = 500;
