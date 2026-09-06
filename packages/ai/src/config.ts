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

/**
 * Phase 5A requirement-mapping pipeline (packages/ai/src/generate-requirement-mapping.ts) —
 * separate caps from the single-field pipeline above since it analyzes a whole posting rather
 * than one field, and its output is an array rather than one answer. The snapshot content sent
 * here is already sanitized/capped per JOB_SNAPSHOT_CAPS (packages/shared) before it ever reaches
 * this pipeline; this cap bounds what's placed in the *prompt* specifically (never larger than
 * what's stored, per docs/IMPLEMENTATION_PLAN.md's round-4 addendum §8).
 */
export const SNAPSHOT_DESCRIPTION_CHAR_CAP = 20_000;
export const REQUIREMENT_MAPPING_MAX_OUTPUT_TOKENS = 8192;

/** Bumped whenever the requirement-mapping system/user prompt changes materially — persisted on
 * every run (requirement_mapping_runs.prompt_version) and every ai_usage_events row so past
 * generations stay attributable to the prompt that actually produced them. */
export const REQUIREMENT_MAPPING_PROMPT_VERSION = 'requirement-evidence-v1';

/**
 * Phase 5 email-classification fallback (packages/ai/src/generate-email-classification.ts) —
 * only called for messages packages/email's deterministic rules can't confidently resolve. A
 * short, single-object structured-JSON response, so a small output-token budget is enough.
 * EMAIL_SNIPPET_CHAR_CAP bounds worst-case injected content volume placed in the prompt, same
 * pattern as JOB_DESCRIPTION_CHAR_CAP — email content is a stronger prompt-injection vector than
 * a job posting (a sender fully controls text landing directly in the user's inbox).
 */
export const EMAIL_CLASSIFICATION_MAX_OUTPUT_TOKENS = 512;
export const EMAIL_CLASSIFICATION_PROMPT_VERSION = 'email-classification-v1';
export const EMAIL_SNIPPET_CHAR_CAP = 1000;
