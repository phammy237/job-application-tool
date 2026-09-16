import { describe, expect, it } from 'vitest';
import { parseDiscoveryFeedQuery } from './discovery-feed-query';

describe('parseDiscoveryFeedQuery', () => {
  it('parses a fully empty query into all-null filters and page 1', () => {
    expect(parseDiscoveryFeedQuery({})).toEqual({
      search: null,
      roleFamilies: null,
      locationToken: null,
      workplaceTypes: null,
      employmentTypes: null,
      eligibilityStatuses: null,
      minMatch: null,
      minCoverage: null,
      freshnessDays: null,
      page: 1,
    });
  });

  it('trims and bounds a search string', () => {
    expect(parseDiscoveryFeedQuery({ q: '  engineer  ' }).search).toBe('engineer');
    expect(parseDiscoveryFeedQuery({ q: 'x'.repeat(500) }).search).toHaveLength(200);
    expect(parseDiscoveryFeedQuery({ q: '   ' }).search).toBeNull();
  });

  it('normalizes a single repeated-key value into an array', () => {
    expect(parseDiscoveryFeedQuery({ role: 'SOFTWARE_ENGINEERING' }).roleFamilies).toEqual([
      'SOFTWARE_ENGINEERING',
    ]);
  });

  it('accepts multiple values for a checkbox-style filter', () => {
    expect(
      parseDiscoveryFeedQuery({ workplace: ['REMOTE', 'HYBRID'] }).workplaceTypes,
    ).toEqual(['REMOTE', 'HYBRID']);
  });

  it('silently drops an unrecognized enum value rather than crashing', () => {
    expect(parseDiscoveryFeedQuery({ role: 'NOT_A_REAL_FAMILY' }).roleFamilies).toBeNull();
    expect(
      parseDiscoveryFeedQuery({ workplace: ['REMOTE', 'NOT_REAL'] }).workplaceTypes,
    ).toEqual(['REMOTE']);
  });

  it('excludes UNKNOWN from role/workplace/employment filter options (not a positive filter target)', () => {
    expect(parseDiscoveryFeedQuery({ role: 'UNKNOWN' }).roleFamilies).toBeNull();
    expect(parseDiscoveryFeedQuery({ workplace: 'UNKNOWN' }).workplaceTypes).toBeNull();
    expect(parseDiscoveryFeedQuery({ employment: 'UNKNOWN' }).employmentTypes).toBeNull();
  });

  it('accepts UNKNOWN as a valid eligibility filter target', () => {
    expect(parseDiscoveryFeedQuery({ eligibility: 'UNKNOWN' }).eligibilityStatuses).toEqual([
      'UNKNOWN',
    ]);
  });

  it('clamps minMatch/minCoverage to [0, 100]', () => {
    expect(parseDiscoveryFeedQuery({ minMatch: '150' }).minMatch).toBe(100);
    expect(parseDiscoveryFeedQuery({ minCoverage: '-10' }).minCoverage).toBe(0);
  });

  it('ignores a non-numeric minMatch/minCoverage rather than crashing', () => {
    expect(parseDiscoveryFeedQuery({ minMatch: 'not-a-number' }).minMatch).toBeNull();
  });

  it('clamps freshness to a sane positive range', () => {
    expect(parseDiscoveryFeedQuery({ freshness: '9999' }).freshnessDays).toBe(365);
    expect(parseDiscoveryFeedQuery({ freshness: '-5' }).freshnessDays).toBeNull();
    expect(parseDiscoveryFeedQuery({ freshness: '0' }).freshnessDays).toBeNull();
  });

  it('defaults page to 1 for missing/invalid/negative values, never crashes', () => {
    expect(parseDiscoveryFeedQuery({}).page).toBe(1);
    expect(parseDiscoveryFeedQuery({ page: '-3' }).page).toBe(1);
    expect(parseDiscoveryFeedQuery({ page: 'abc' }).page).toBe(1);
    expect(parseDiscoveryFeedQuery({ page: '5' }).page).toBe(5);
  });

  it('never throws on a completely malformed/unexpected input shape', () => {
    expect(() => parseDiscoveryFeedQuery(null)).not.toThrow();
    expect(() => parseDiscoveryFeedQuery(undefined)).not.toThrow();
    expect(() => parseDiscoveryFeedQuery('not an object')).not.toThrow();
    expect(() => parseDiscoveryFeedQuery({ q: { nested: 'object' } })).not.toThrow();
    expect(() => parseDiscoveryFeedQuery({ role: { nested: 'object' } })).not.toThrow();
  });

  it('trims and bounds the location token', () => {
    expect(parseDiscoveryFeedQuery({ location: '  NEW_YORK_NY  ' }).locationToken).toBe(
      'NEW_YORK_NY',
    );
  });
});
