import { describe, expect, it } from 'vitest';
import { parseResumeDateText } from './parse-resume-date-text';

describe('parseResumeDateText', () => {
  it('parses "Month Year" into ISO with day defaulted to 01', () => {
    expect(parseResumeDateText('May 2025')).toBe('2025-05-01');
    expect(parseResumeDateText('September 2021')).toBe('2021-09-01');
  });

  it('parses "MM/YYYY"', () => {
    expect(parseResumeDateText('05/2025')).toBe('2025-05-01');
    expect(parseResumeDateText('5/2025')).toBe('2025-05-01');
  });

  it('parses "YYYY-MM"', () => {
    expect(parseResumeDateText('2025-05')).toBe('2025-05-01');
  });

  it('passes through an already-ISO date unchanged', () => {
    expect(parseResumeDateText('2025-05-15')).toBe('2025-05-15');
  });

  it('parses a bare year', () => {
    expect(parseResumeDateText('2025')).toBe('2025-01-01');
  });

  it('never invents a date for "Present"/"Current"/empty/malformed input', () => {
    expect(parseResumeDateText('Present')).toBeNull();
    expect(parseResumeDateText('Current')).toBeNull();
    expect(parseResumeDateText('')).toBeNull();
    expect(parseResumeDateText(null)).toBeNull();
    expect(parseResumeDateText(undefined)).toBeNull();
    expect(parseResumeDateText('sometime last year')).toBeNull();
    expect(parseResumeDateText('Summer 2025')).toBeNull(); // not a real month name — never guessed
  });
});
