/**
 * Auto Mode (D9 Phase A) tuning constants — every bound the cron orchestrator (`runAutoQueueForUser`)
 * and its cron route observe. Tunable without a code change, same pattern as
 * `packages/email/src/config.ts`'s own bounding constants.
 */

/** The Match-score floor (0-100, D4's existing scoring output) a `/discover` candidate must clear
 * to be auto-queued at all — paired with requiring the HIGH coverage tier (`coverage_bucket = 0`)
 * and a non-CONFLICT eligibility status (see `listOwnAutoQueueCandidateMatchScores`). Reuses the
 * existing D4/D5A scoring outputs verbatim; this is not a new scoring system. */
export const AUTO_QUEUE_MIN_MATCH_SCORE = 70;

/** How many of this user's own above-threshold candidates one orchestrator run even looks at,
 * before the already-tracked exclusion and per-run cap below narrow it further. */
export const MAX_AUTO_QUEUE_CANDIDATES_PER_RUN = 25;

/** How many brand-new applications one orchestrator run may auto-queue for one user — bounds how
 * many new "Needs your review" cards can appear in a single tick, highest match_score first. */
export const MAX_AUTO_QUEUED_PER_USER_PER_RUN = 5;

/** If a user already has at least this many applications sitting at `auto_queue_status =
 * 'PENDING_REVIEW'`, the orchestrator queues nothing further for them this run — a user who never
 * opens their review queue must never get it flooded tick after tick. */
export const MAX_PENDING_AUTO_QUEUE_PER_USER = 20;

/** Bounds one cron invocation's total work, same "leave the rest for the next scheduled tick"
 * reasoning as `packages/email`'s `MAX_USERS_PER_BACKGROUND_SYNC_RUN`. */
export const MAX_USERS_PER_AUTO_QUEUE_RUN = 20;

/** Bounded concurrency across users within one cron invocation — mirrors
 * `packages/email`'s `MAX_CONCURRENT_BACKGROUND_SYNC_USERS`. */
export const MAX_CONCURRENT_AUTO_QUEUE_USERS = 5;
