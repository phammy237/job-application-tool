import { describe, expect, it } from 'vitest';
import {
  computeJobCatalogContentHash,
  type JobCatalogHashableContent,
} from './job-catalog-content-hash';

const base: JobCatalogHashableContent = {
  companyName: 'Acme Corp',
  title: 'Backend Engineer',
  locationText: 'San Francisco, CA',
  workplaceType: 'HYBRID',
  employmentType: 'Full-time',
  description: 'Build things.',
  responsibilities: null,
  qualifications: null,
  salaryMin: 120000,
  salaryMax: 160000,
  salaryCurrency: 'USD',
  applyUrl: 'https://example.com/apply',
};

describe('computeJobCatalogContentHash', () => {
  it('is prefixed "v1:"', async () => {
    expect(await computeJobCatalogContentHash(base)).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical logical content', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({ ...base });
    expect(a).toBe(b);
  });

  it('is insensitive to inconsequential whitespace differences', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({
      ...base,
      title: '  Backend   Engineer  ',
      description: '  Build   things.  ',
    });
    expect(a).toBe(b);
  });

  it('changes when title changes', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({ ...base, title: 'Frontend Engineer' });
    expect(a).not.toBe(b);
  });

  it('changes when description changes', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({ ...base, description: 'Build other things.' });
    expect(a).not.toBe(b);
  });

  it('changes when salary changes', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({ ...base, salaryMax: 170000 });
    expect(a).not.toBe(b);
  });

  it('changes when apply URL changes', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({
      ...base,
      applyUrl: 'https://example.com/apply2',
    });
    expect(a).not.toBe(b);
  });

  it('is case-sensitive', async () => {
    const a = await computeJobCatalogContentHash(base);
    const b = await computeJobCatalogContentHash({ ...base, title: 'BACKEND ENGINEER' });
    expect(a).not.toBe(b);
  });

  it('distinguishes null from empty content', async () => {
    const a = await computeJobCatalogContentHash({ ...base, responsibilities: null });
    const b = await computeJobCatalogContentHash({ ...base, responsibilities: '' });
    expect(a).not.toBe(b);
  });
});
