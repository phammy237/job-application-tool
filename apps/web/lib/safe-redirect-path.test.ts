import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect-path';

describe('safeRedirectPath', () => {
  it('keeps plain same-origin paths, including query strings', () => {
    expect(safeRedirectPath('/applications/123')).toBe('/applications/123');
    expect(safeRedirectPath('/discover?page=2')).toBe('/discover?page=2');
  });

  it.each([
    ['@evil.com'],
    ['.evil.com'],
    ['//evil.com'],
    ['/\\evil.com'],
    ['/\t/evil.com'],
    ['https://evil.com'],
    [''],
  ])('falls back for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/dashboard');
  });

  it('keeps a path with a query string and hash', () => {
    expect(safeRedirectPath('/my/projects?q=api&status=ACTIVE')).toBe('/my/projects?q=api&status=ACTIVE');
  });

  it('falls back for non-strings and honors a custom fallback', () => {
    expect(safeRedirectPath(null)).toBe('/dashboard');
    expect(safeRedirectPath(undefined, '/settings')).toBe('/settings');
  });
});
