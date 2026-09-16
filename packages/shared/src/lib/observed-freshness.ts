/**
 * Deterministic freshness buckets derived ONLY from Career OS's own observation of a
 * `job_catalog` row (docs/JOB_DISCOVERY.md "Observed freshness") — `first_seen_at`, never the
 * provider-reported `posted_at`. Live data proved `posted_at` is unsafe for this purpose: some
 * Palantir/Lever postings self-report a "posted" date from 2009-2014 while being actively open
 * today (an evergreen rolling requisition), so treating provider-reported dates as freshness
 * would rank a job open right now as ancient. "NEW"/"RECENT"/"ESTABLISHED" here means "Career OS
 * observed this recently" — never "the employer posted this recently."
 *
 * Freshness is deliberately a relatively small ranking factor by default (see the scoring
 * profile's default weight) and is always evaluable — `first_seen_at` is NOT NULL on every
 * `job_catalog` row by construction, so this criterion never contributes to a lowered Coverage.
 */
export type FreshnessBucket = 'NEW' | 'RECENT' | 'MODERATE' | 'ESTABLISHED';

export interface FreshnessResult {
  bucket: FreshnessBucket;
  fit: number;
  daysSinceFirstSeen: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;

export function computeObservedFreshness(firstSeenAt: string, now: Date): FreshnessResult {
  const daysSinceFirstSeen = Math.max(
    0,
    Math.floor((now.getTime() - new Date(firstSeenAt).getTime()) / MILLISECONDS_PER_DAY),
  );

  if (daysSinceFirstSeen <= 2) return { bucket: 'NEW', fit: 1.0, daysSinceFirstSeen };
  if (daysSinceFirstSeen <= 7) return { bucket: 'RECENT', fit: 0.8, daysSinceFirstSeen };
  if (daysSinceFirstSeen <= 30) return { bucket: 'MODERATE', fit: 0.5, daysSinceFirstSeen };
  return { bucket: 'ESTABLISHED', fit: 0.3, daysSinceFirstSeen };
}
