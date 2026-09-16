import { describe, expect, it } from 'vitest';
import { containsPhrase, firstMatchingPhrase } from './phrase-matcher';

describe('containsPhrase', () => {
  it('matches a whole word', () => {
    expect(containsPhrase('We use Python daily', 'python')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsPhrase('We use PYTHON daily', 'python')).toBe(true);
  });

  it('does not match a substring inside an unrelated word', () => {
    expect(containsPhrase('We use Cython daily', 'python')).toBe(false);
  });

  it('does not false-positive on short tokens inside unrelated words', () => {
    expect(containsPhrase('The chair was red', 'R')).toBe(false);
    expect(containsPhrase('This is a chain of custody', 'AI')).toBe(false);
  });

  it('matches a standalone short token', () => {
    expect(containsPhrase('Experience with AI systems', 'AI')).toBe(true);
  });

  it('matches a phrase ending in a non-alphanumeric character followed by a space', () => {
    expect(containsPhrase('C++ Engineer', 'c++')).toBe(true);
    expect(containsPhrase('Must know C# well', 'c#')).toBe(true);
  });

  it('matches a phrase ending in a non-alphanumeric character at end of string', () => {
    expect(containsPhrase('Experience with C++', 'c++')).toBe(true);
  });

  it('matches multi-word phrases', () => {
    expect(containsPhrase('Strong product strategy background', 'product strategy')).toBe(true);
  });
});

describe('firstMatchingPhrase', () => {
  it('returns the first matching phrase in list order', () => {
    expect(firstMatchingPhrase('Senior Product Manager', ['director', 'manager'])).toBe('manager');
  });

  it('returns null when nothing matches', () => {
    expect(firstMatchingPhrase('Data Analyst', ['director', 'manager'])).toBeNull();
  });
});
