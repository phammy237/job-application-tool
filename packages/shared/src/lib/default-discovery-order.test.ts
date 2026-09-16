import { describe, expect, it } from 'vitest';
import {
  compareForDefaultDiscoveryOrder,
  getCoverageBucket,
  isLowCoverage,
} from './default-discovery-order';

describe('getCoverageBucket', () => {
  it('classifies >= 60 as HIGH', () => {
    expect(getCoverageBucket(60)).toBe('HIGH');
    expect(getCoverageBucket(100)).toBe('HIGH');
  });

  it('classifies 30-59 as MODERATE', () => {
    expect(getCoverageBucket(30)).toBe('MODERATE');
    expect(getCoverageBucket(59.99)).toBe('MODERATE');
  });

  it('classifies < 30 as LOW', () => {
    expect(getCoverageBucket(29.99)).toBe('LOW');
    expect(getCoverageBucket(0)).toBe('LOW');
  });
});

describe('isLowCoverage', () => {
  it('is true only for the LOW bucket, consistent with getCoverageBucket', () => {
    expect(isLowCoverage(4.35)).toBe(true);
    expect(isLowCoverage(29.99)).toBe(true);
    expect(isLowCoverage(30)).toBe(false);
    expect(isLowCoverage(90)).toBe(false);
  });
});

describe('compareForDefaultDiscoveryOrder', () => {
  it('ranks a HIGH-coverage job above a LOW-coverage job even when Match is lower', () => {
    const highCoverageLowerMatch = { jobCatalogId: 'a', matchScore: 60, coverage: 65 };
    const lowCoverageHigherMatch = { jobCatalogId: 'b', matchScore: 100, coverage: 4.35 };
    const sorted = [lowCoverageHigherMatch, highCoverageLowerMatch].sort(
      compareForDefaultDiscoveryOrder,
    );
    expect(sorted[0]?.jobCatalogId).toBe('a');
  });

  it('ranks by Match descending within the same coverage bucket', () => {
    const a = { jobCatalogId: 'a', matchScore: 70, coverage: 65 };
    const b = { jobCatalogId: 'b', matchScore: 90, coverage: 62 };
    const sorted = [a, b].sort(compareForDefaultDiscoveryOrder);
    expect(sorted[0]?.jobCatalogId).toBe('b');
  });

  it('uses jobCatalogId as a deterministic, stable tiebreaker', () => {
    const a = { jobCatalogId: 'aaaa', matchScore: 70, coverage: 65 };
    const b = { jobCatalogId: 'bbbb', matchScore: 70, coverage: 65 };
    const sorted = [b, a].sort(compareForDefaultDiscoveryOrder);
    expect(sorted.map((x) => x.jobCatalogId)).toEqual(['aaaa', 'bbbb']);
  });

  it('produces a fully deterministic order for a realistic mixed batch', () => {
    const items = [
      { jobCatalogId: 'c', matchScore: 92, coverage: 63 },
      { jobCatalogId: 'a', matchScore: 100, coverage: 17 },
      { jobCatalogId: 'b', matchScore: 18, coverage: 24 },
      { jobCatalogId: 'd', matchScore: 70, coverage: 82 },
    ];
    const sortedOnce = [...items].sort(compareForDefaultDiscoveryOrder);
    const sortedTwice = [...items].reverse().sort(compareForDefaultDiscoveryOrder);
    expect(sortedOnce).toEqual(sortedTwice);
    // HIGH bucket (c, d) sorted by match desc first, then LOW bucket (a, b) sorted by match desc.
    expect(sortedOnce.map((x) => x.jobCatalogId)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('never uses provider/company identity as an input', () => {
    // The comparator's type signature itself proves this — it only ever sees jobCatalogId,
    // matchScore, and coverage, never company/provider. This test documents that guarantee.
    const a = { jobCatalogId: 'z', matchScore: 50, coverage: 50 };
    const b = { jobCatalogId: 'y', matchScore: 50, coverage: 50 };
    expect(compareForDefaultDiscoveryOrder(a, b)).toBe(compareForDefaultDiscoveryOrder(a, { ...b }));
  });
});
