import { describe, expect, it } from 'vitest';
import { extractGraduationWindow } from './extract-graduation-window';

describe('extractGraduationWindow', () => {
  it('parses an explicit range with connector words', () => {
    expect(
      extractGraduationWindow('We are hiring candidates graduating between December 2027 and June 2028.'),
    ).toEqual({ min: 2027, max: 2028 });
  });

  it('parses "class of X or Y"', () => {
    expect(extractGraduationWindow('Open to class of 2027 or 2028 graduates.')).toEqual({
      min: 2027,
      max: 2028,
    });
  });

  it('parses "X-Y graduates"', () => {
    expect(extractGraduationWindow('2027-2028 graduates are encouraged to apply.')).toEqual({
      min: 2027,
      max: 2028,
    });
  });

  it('parses a single graduation year', () => {
    expect(extractGraduationWindow('Must be graduating in 2027.')).toEqual({ min: 2027, max: 2027 });
  });

  it('handles years given out of numeric order', () => {
    expect(extractGraduationWindow('Class of 2028 or 2027 graduates.')).toEqual({ min: 2027, max: 2028 });
  });

  it('returns null when no graduation language is present', () => {
    expect(extractGraduationWindow('Founded in 2015, we shipped our product in 2019.')).toBeNull();
  });

  it('returns null for an implausible year outside the sane range', () => {
    expect(extractGraduationWindow('Graduating class of 1990.')).toBeNull();
  });

  it('returns null when three or more years appear in the graduation sentence (too ambiguous)', () => {
    expect(
      extractGraduationWindow('Graduating in 2026, 2027, or 2028 are all welcome to apply.'),
    ).toBeNull();
  });
});
