import { describe, expect, it } from 'vitest';
import { buildCrossSourceDedupeIndex, findCrossSourceDuplicate } from './cross-source-dedupe';

const GREENHOUSE_ROW = {
  jobCatalogId: 'gh-1',
  sourceId: 'source-greenhouse',
  companyName: 'Datadog',
  title: 'Product Management Intern',
  locationText: 'New York, NY, United States',
  canonicalApplyUrl: 'https://boards.greenhouse.io/datadog/jobs/1234',
  postedAt: '2026-09-15T00:00:00.000Z',
};

const LEVER_ROW = {
  jobCatalogId: 'lever-1',
  sourceId: 'source-lever',
  companyName: 'Palantir',
  title: 'Forward Deployed Engineer Intern',
  locationText: 'Palo Alto, CA, United States',
  canonicalApplyUrl: 'https://jobs.lever.co/palantir/5678',
  postedAt: '2026-09-14T00:00:00.000Z',
};

describe('findCrossSourceDuplicate', () => {
  it('20. a Jobright candidate with the same canonical apply URL as an existing Greenhouse row dedupes', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern (via Jobright)',
      locationText: 'NYC',
      canonicalApplyUrl: 'https://boards.greenhouse.io/datadog/jobs/1234',
      postedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('gh-1');
  });

  it('21. a Jobright candidate with the same canonical apply URL as an existing Lever row dedupes', () => {
    const index = buildCrossSourceDedupeIndex([LEVER_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Palantir',
      title: 'FDE Intern',
      locationText: 'Palo Alto',
      canonicalApplyUrl: 'https://jobs.lever.co/palantir/5678',
      postedAt: null,
    });
    expect(match?.jobCatalogId).toBe('lever-1');
  });

  it('falls back to normalized company+title+location when the URL differs (Jobright uses its own tracking URL)', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/abc123',
      postedAt: '2026-09-15T12:00:00.000Z',
    });
    expect(match?.jobCatalogId).toBe('gh-1');
  });

  it('22. the same title in a different city never false-merges', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'San Francisco, CA, United States',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/def456',
      postedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });

  it('23. two genuinely distinct requisitions (same company/title/location, far-apart posted dates) remain distinct', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/ghi789',
      postedAt: '2026-01-01T00:00:00.000Z', // months apart from GREENHOUSE_ROW's Sep 15 posting
    });
    expect(match).toBeNull();
  });

  it('never dedupes by title alone — a different company with the identical title is distinct', () => {
    const index = buildCrossSourceDedupeIndex([GREENHOUSE_ROW]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'A Totally Different Company',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/jkl012',
      postedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });

  it('an unknown posted date on either side never blocks an otherwise-matching company+title+location', () => {
    const index = buildCrossSourceDedupeIndex([{ ...GREENHOUSE_ROW, postedAt: null }]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/mno345',
      postedAt: null,
    });
    expect(match?.jobCatalogId).toBe('gh-1');
  });

  it('no candidates at all in the index means every new job is genuinely new', () => {
    const index = buildCrossSourceDedupeIndex([]);
    const match = findCrossSourceDuplicate(index, {
      companyName: 'Notion',
      title: 'Software Engineer Intern',
      locationText: 'San Francisco, CA',
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/pqr678',
      postedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(match).toBeNull();
  });
});
