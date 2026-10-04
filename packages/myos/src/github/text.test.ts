import { describe, expect, it } from 'vitest';
import { cleanText, sanitizeText, truncateCodePoints } from './text';

describe('text helpers', () => {
  it('strips NUL and lone surrogates but keeps valid pairs', () => {
    expect(sanitizeText('a\u0000b\ud800c\udc00d\u{1F600}')).toBe('abcd\u{1F600}');
  });
  it('slices by code points without splitting pairs', () => {
    const s = '\u{1F600}'.repeat(5);
    expect(truncateCodePoints(s, 3)).toBe('\u{1F600}'.repeat(3));
    expect(truncateCodePoints('abc', 10)).toBe('abc');
    expect(truncateCodePoints('abc', 0)).toBe('');
  });
  it('cleanText passes null through', () => {
    expect(cleanText(null, 5)).toBeNull();
    expect(cleanText('ab\u0000cdef', 4)).toBe('abcd');
  });
});
