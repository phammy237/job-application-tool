import { describe, expect, it } from 'vitest';
import { computeJobCatalogDedupeFingerprint } from './job-catalog-dedupe-fingerprint';

describe('computeJobCatalogDedupeFingerprint', () => {
  it('is deterministic for identical input', () => {
    const input = {
      companyName: 'Acme Corp',
      title: 'Backend Engineer',
      locationText: 'San Francisco, CA',
      canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
    };
    expect(computeJobCatalogDedupeFingerprint(input)).toBe(
      computeJobCatalogDedupeFingerprint({ ...input }),
    );
  });

  it('is insensitive to whitespace/case differences in inputs', () => {
    const a = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme Corp',
      title: 'Backend Engineer',
      locationText: 'San Francisco, CA',
      canonicalApplyUrl: null,
    });
    const b = computeJobCatalogDedupeFingerprint({
      companyName: '  ACME   CORP ',
      title: 'backend   engineer',
      locationText: 'san francisco, ca',
      canonicalApplyUrl: null,
    });
    expect(a).toBe(b);
  });

  it('differs when the title differs', () => {
    const a = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme',
      title: 'Backend Engineer',
      locationText: null,
      canonicalApplyUrl: null,
    });
    const b = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme',
      title: 'Frontend Engineer',
      locationText: null,
      canonicalApplyUrl: null,
    });
    expect(a).not.toBe(b);
  });

  it('differs when the company differs', () => {
    const a = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme',
      title: 'Backend Engineer',
      locationText: null,
      canonicalApplyUrl: null,
    });
    const b = computeJobCatalogDedupeFingerprint({
      companyName: 'Other Co',
      title: 'Backend Engineer',
      locationText: null,
      canonicalApplyUrl: null,
    });
    expect(a).not.toBe(b);
  });

  it('does not collide when a literal "|" in one field lands exactly where a "|"-joined fingerprint would place the delimiter — the bug this guards against', () => {
    // Under the old `parts.join('|')` delimiter, these two genuinely different (company, title)
    // pairs produced the byte-identical fingerprint "acme|co|x||": "Acme" + "|" + "Co|X" and
    // "Acme|Co" + "|" + "X" both concatenate to the same string once joined with "|".
    const a = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme',
      title: 'Co|X',
      locationText: null,
      canonicalApplyUrl: null,
    });
    const b = computeJobCatalogDedupeFingerprint({
      companyName: 'Acme|Co',
      title: 'X',
      locationText: null,
      canonicalApplyUrl: null,
    });
    expect(a).not.toBe(b);
  });
});
