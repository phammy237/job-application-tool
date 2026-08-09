import { describe, expect, it } from 'vitest';
import { extractKeywords } from './tokenize';

describe('extractKeywords', () => {
  it('lowercases and dedupes', () => {
    expect(extractKeywords('Backend Backend BACKEND')).toEqual(new Set(['backend']));
  });

  it('strips punctuation but keeps internal hyphens', () => {
    expect(extractKeywords('front-end, back-end!')).toEqual(new Set(['front-end', 'back-end']));
  });

  it('drops stopwords', () => {
    expect(extractKeywords('the quick and the brief')).toEqual(new Set(['quick', 'brief']));
  });

  it('drops tokens under 2 characters', () => {
    expect(extractKeywords('a b go i')).toEqual(new Set(['go']));
  });

  it('returns an empty set for empty input', () => {
    expect(extractKeywords('')).toEqual(new Set());
  });
});
