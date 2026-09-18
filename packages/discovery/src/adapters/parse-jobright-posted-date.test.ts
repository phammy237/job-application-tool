import { describe, expect, it } from 'vitest';
import { parseJobrightPostedDate } from './parse-jobright-posted-date';

describe('parseJobrightPostedDate', () => {
  it('parses a normal date within the current year', () => {
    const result = parseJobrightPostedDate('Sep 17', new Date('2026-09-18T00:00:00.000Z'));
    expect(result).toBe('2026-09-17T00:00:00.000Z');
  });

  it('resolves a Dec/Jan boundary to the previous year rather than 362 days in the future', () => {
    const result = parseJobrightPostedDate('Dec 30', new Date('2026-01-02T00:00:00.000Z'));
    expect(result).toBe('2025-12-30T00:00:00.000Z');
  });

  it('handles a repo season/year mismatch by picking the nearest sensible year, not the furthest-past one', () => {
    const result = parseJobrightPostedDate('Jan 5', new Date('2026-09-18T00:00:00.000Z'));
    expect(result).toBe('2026-01-05T00:00:00.000Z');
  });

  it('returns null for a malformed date string', () => {
    expect(parseJobrightPostedDate('Someday', new Date('2026-09-18T00:00:00.000Z'))).toBeNull();
    expect(parseJobrightPostedDate('', new Date('2026-09-18T00:00:00.000Z'))).toBeNull();
    expect(parseJobrightPostedDate(null, new Date('2026-09-18T00:00:00.000Z'))).toBeNull();
    expect(parseJobrightPostedDate('Feb 30', new Date('2026-09-18T00:00:00.000Z'))).toBeNull();
  });
});
