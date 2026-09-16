/**
 * The D5A default `/discover` feed ordering rule (docs/JOB_DISCOVERY.md "Default discovery
 * order"). The D4 live audit found that sorting purely by `match_score` surfaces noisy results —
 * a job where almost every criterion is UNKNOWN except a lucky `OBSERVED_FRESHNESS: 1.0` can hit
 * `match_score: 100` with `coverage` as low as ~4%. The fix is not a composite score (Match ×
 * Coverage is explicitly never computed anywhere in this product) — it's a two-level sort:
 * Coverage tier first, Match within the tier second.
 *
 * Bucket thresholds (60% / 30%) are chosen from the D4 live audit's own coverage distribution
 * (`docs/JOB_DISCOVERY.md` §31: p25 ≈ 23.9%, p50 ≈ 43.5%, p75 ≈ 60.9%) — HIGH starts at the
 * measured 75th percentile (comfortably informative), LOW ends at the measured 25th percentile
 * (comfortably uninformative), leaving a MODERATE middle band. This exact bucketing is mirrored
 * as a generated, indexed SQL column (`user_job_match_scores.coverage_bucket`, migration 0031) —
 * this file is the single source of truth for the rule; the SQL comment there points back here.
 *
 * This function is deliberately pure/synchronous so it can be unit-tested in isolation, and reused
 * as documentation-by-code for exactly what the SQL `ORDER BY` clause means — the actual feed
 * query (`list_own_discovery_feed`) does the real sorting in Postgres, never in the browser.
 */
export type CoverageBucket = 'HIGH' | 'MODERATE' | 'LOW';

export const COVERAGE_BUCKET_THRESHOLDS = {
  HIGH_MIN: 60,
  MODERATE_MIN: 30,
} as const;

export function getCoverageBucket(coverage: number): CoverageBucket {
  if (coverage >= COVERAGE_BUCKET_THRESHOLDS.HIGH_MIN) return 'HIGH';
  if (coverage >= COVERAGE_BUCKET_THRESHOLDS.MODERATE_MIN) return 'MODERATE';
  return 'LOW';
}

const BUCKET_RANK: Record<CoverageBucket, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };

export interface DiscoveryOrderItem {
  jobCatalogId: string;
  matchScore: number;
  coverage: number;
}

/**
 * A stable comparator implementing the exact rule the SQL `ORDER BY` clause applies:
 * coverage bucket ascending (best first), then match score descending, then `jobCatalogId`
 * ascending as a deterministic tiebreaker (never provider identity, never insertion order).
 */
export function compareForDefaultDiscoveryOrder(
  a: DiscoveryOrderItem,
  b: DiscoveryOrderItem,
): number {
  const bucketDiff = BUCKET_RANK[getCoverageBucket(a.coverage)] - BUCKET_RANK[getCoverageBucket(b.coverage)];
  if (bucketDiff !== 0) return bucketDiff;

  const matchDiff = b.matchScore - a.matchScore;
  if (matchDiff !== 0) return matchDiff;

  return a.jobCatalogId < b.jobCatalogId ? -1 : a.jobCatalogId > b.jobCatalogId ? 1 : 0;
}

/** True when a result's Match is based on little enough evidence that the UI should surface a
 * "limited job data" notice — the same LOW-bucket threshold the default order itself uses, so the
 * visual warning and the ranking behavior are always consistent with each other. */
export function isLowCoverage(coverage: number): boolean {
  return getCoverageBucket(coverage) === 'LOW';
}
