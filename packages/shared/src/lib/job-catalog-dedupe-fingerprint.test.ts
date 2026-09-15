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
});
