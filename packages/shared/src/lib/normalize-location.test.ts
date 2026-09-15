import { describe, expect, it } from 'vitest';
import { normalizeLocationText, parseLocation } from './normalize-location';

describe('normalizeLocationText', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeLocationText('  San   Francisco, CA ')).toBe('san francisco, ca');
  });
});

describe('parseLocation', () => {
  it('parses "City, ST" as a US state', () => {
    expect(parseLocation('San Francisco, CA')).toEqual({
      city: 'San Francisco',
      stateRegion: 'CA',
      country: 'United States',
    });
  });

  it('parses "City, Country" for a known country name', () => {
    expect(parseLocation('London, United Kingdom')).toEqual({
      city: 'London',
      stateRegion: null,
      country: 'United Kingdom',
    });
  });

  it('never guesses on a multi-location string', () => {
    expect(parseLocation('Seattle, San Francisco, New York City')).toEqual({
      city: null,
      stateRegion: null,
      country: null,
    });
  });

  it('never guesses on a bare city with no state/country', () => {
    expect(parseLocation('Remote')).toEqual({ city: null, stateRegion: null, country: null });
  });

  it('never guesses on an unrecognized trailing segment', () => {
    expect(parseLocation('Springfield, Somewhere')).toEqual({
      city: null,
      stateRegion: null,
      country: null,
    });
  });

  it('never guesses on a slash-separated location', () => {
    expect(parseLocation('New York / Remote')).toEqual({
      city: null,
      stateRegion: null,
      country: null,
    });
  });

  it('handles empty input', () => {
    expect(parseLocation('')).toEqual({ city: null, stateRegion: null, country: null });
  });
});
