import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './canonicalize-url';

describe('canonicalizeUrl', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl(undefined)).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
  });

  it('returns null for an unparseable URL rather than throwing', () => {
    expect(canonicalizeUrl('not a url')).toBeNull();
  });

  it('strips the query string', () => {
    expect(canonicalizeUrl('https://boards.example.com/job/123?utm_source=linkedin')).toBe(
      'https://boards.example.com/job/123',
    );
  });

  it('strips the fragment', () => {
    expect(canonicalizeUrl('https://boards.example.com/job/123#apply')).toBe(
      'https://boards.example.com/job/123',
    );
  });

  it('strips both query string and fragment together', () => {
    expect(canonicalizeUrl('https://boards.example.com/job/123?ref=abc#section')).toBe(
      'https://boards.example.com/job/123',
    );
  });

  it('removes exactly one trailing slash', () => {
    expect(canonicalizeUrl('https://boards.example.com/job/123/')).toBe(
      'https://boards.example.com/job/123',
    );
  });

  it('never collapses a bare root path to empty', () => {
    expect(canonicalizeUrl('https://boards.example.com/')).toBe('https://boards.example.com/');
  });

  it('lowercases the host but not the path', () => {
    expect(canonicalizeUrl('https://Boards.Example.com/Job/ABC123')).toBe(
      'https://boards.example.com/Job/ABC123',
    );
  });

  it('drops the default port for the scheme', () => {
    expect(canonicalizeUrl('https://boards.example.com:443/job/123')).toBe(
      'https://boards.example.com/job/123',
    );
    expect(canonicalizeUrl('http://boards.example.com:80/job/123')).toBe(
      'http://boards.example.com/job/123',
    );
  });

  it('keeps a non-default port', () => {
    expect(canonicalizeUrl('https://boards.example.com:8443/job/123')).toBe(
      'https://boards.example.com:8443/job/123',
    );
  });

  it('two URLs that differ only by tracking query params canonicalize identically', () => {
    const a = canonicalizeUrl('https://boards.example.com/job/123?utm_source=linkedin&ref=x');
    const b = canonicalizeUrl('https://boards.example.com/job/123?utm_source=twitter');
    expect(a).toBe(b);
  });

  it('two genuinely different job paths canonicalize differently', () => {
    const a = canonicalizeUrl('https://boards.example.com/job/123');
    const b = canonicalizeUrl('https://boards.example.com/job/456');
    expect(a).not.toBe(b);
  });
});
