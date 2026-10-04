import { describe, expect, it } from 'vitest';
import { httpUrlSchema, myosEvidenceInputSchema } from '../../schemas/myos';
import { safeHttpHref } from './safe-href';

describe('safeHttpHref', () => {
  it('allows http(s) only', () => {
    expect(safeHttpHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHttpHref(' http://example.com ')).toBe('http://example.com/');
    expect(safeHttpHref('javascript:alert(1)')).toBeNull();
    expect(safeHttpHref('data:text/html,<script>')).toBeNull();
    expect(safeHttpHref('vbscript:x')).toBeNull();
    expect(safeHttpHref('not a url')).toBeNull();
    expect(safeHttpHref('')).toBeNull();
    expect(safeHttpHref(null)).toBeNull();
    expect(safeHttpHref(undefined)).toBeNull();
  });
});

describe('httpUrlSchema', () => {
  it('rejects non-http(s) schemes that z.string().url() accepts', () => {
    expect(httpUrlSchema.safeParse('https://github.com/a/b').success).toBe(true);
    expect(httpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrlSchema.safeParse('ftp://x.com/a').success).toBe(false);
  });
  it('is enforced on evidence input sourceUrl', () => {
    const base = { sourceType: 'LINK', title: 't', verificationState: 'USER_PROVIDED' } as const;
    expect(myosEvidenceInputSchema.safeParse({ ...base, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(myosEvidenceInputSchema.safeParse({ ...base, sourceUrl: 'https://example.com' }).success).toBe(true);
  });
});
