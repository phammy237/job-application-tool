import { describe, expect, it } from 'vitest';
import { extractLocationTokens } from './extract-location-tokens';

describe('extractLocationTokens', () => {
  it('normalizes equivalent New York variants identically (live-observed forms)', () => {
    expect(extractLocationTokens('New York, NY (HQ)')).toEqual(['NEW_YORK_NY']);
    expect(extractLocationTokens('New York, NY')).toEqual(['NEW_YORK_NY']);
    expect(extractLocationTokens('New York, New York')).toEqual(['NEW_YORK_NY']);
  });

  it('normalizes equivalent London variants identically', () => {
    expect(extractLocationTokens('London, United Kingdom')).toEqual(['LONDON_UNITED_KINGDOM']);
    expect(extractLocationTokens('London, UK')).toEqual(['LONDON_UNITED_KINGDOM']);
  });

  it('tokenizes a bare recognized country name', () => {
    expect(extractLocationTokens('Singapore')).toEqual(['SINGAPORE']);
    expect(extractLocationTokens('Ireland')).toEqual(['IRELAND']);
  });

  it('preserves a real multi-location posting using the unambiguous ";" separator', () => {
    expect(extractLocationTokens('New York, NY; San Francisco, CA')).toEqual([
      'NEW_YORK_NY',
      'SAN_FRANCISCO_CA',
    ]);
  });

  it('never guesses on a comma-only multi-city string (ambiguous with "City, ST")', () => {
    expect(extractLocationTokens('Seattle, San Francisco, New York City')).toEqual([]);
  });

  it('returns empty for an unrecognized bare city with no state/country', () => {
    expect(extractLocationTokens('Remote')).toEqual([]);
    expect(extractLocationTokens('North America')).toEqual([]);
  });

  it('returns empty for null input', () => {
    expect(extractLocationTokens(null)).toEqual([]);
  });

  it('deduplicates repeated tokens', () => {
    expect(extractLocationTokens('New York, NY; New York, NY (HQ)')).toEqual(['NEW_YORK_NY']);
  });

  it('handles a US state full name second segment', () => {
    expect(extractLocationTokens('Austin, Texas')).toEqual(['AUSTIN_TX']);
  });
});
