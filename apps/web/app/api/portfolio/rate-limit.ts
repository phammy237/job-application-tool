/**
 * BEST-EFFORT, in-memory fixed-window rate limiter for the portfolio API.
 *
 * Limitations (by design, documented in docs/myos/PORTFOLIO_API.md): state lives in one server
 * instance's memory, so on serverless/multi-instance deployments each instance counts separately
 * and a cold start resets counters. It slows down naive abuse and key-guessing; it is not a
 * substitute for an edge/WAF rate limit. Keys passed in are hashed by the caller; this module
 * never stores raw credentials.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 5000;
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
}

export function checkRateLimit(
  id: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    // Still full of live buckets: drop the oldest entries so memory stays bounded.
    if (buckets.size >= MAX_BUCKETS) {
      const excess = buckets.size - MAX_BUCKETS + 1;
      let i = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++i >= excess) break;
      }
    }
  }
  const existing = buckets.get(id);
  if (!existing || existing.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
