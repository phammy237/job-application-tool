import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import * as database from '@career-os/database';
import { extractFeaturesForStaleJobs } from './extract-features';

const FAKE_SUPABASE = {} as CareerOsSupabaseClient;

describe('extractFeaturesForStaleJobs', () => {
  it('extracts features for every stale candidate and persists them in one batch', async () => {
    const listSpy = vi
      .spyOn(database, 'listJobCatalogRowsNeedingFeatureRecompute')
      .mockResolvedValue([
        {
          jobCatalogId: 'j1',
          title: 'Senior Software Engineer',
          description: '<p>Build things.</p>',
          locationText: 'New York, NY',
          employmentType: 'FullTime',
          workplaceType: 'REMOTE',
          contentHash: 'v1:h1',
        },
        {
          jobCatalogId: 'j2',
          title: 'Product Manager Intern',
          description: null,
          locationText: null,
          employmentType: null,
          workplaceType: null,
          contentHash: 'v1:h2',
        },
      ]);
    const upsertSpy = vi.spyOn(database, 'upsertJobCatalogFeaturesBatch').mockResolvedValue(undefined);

    const summary = await extractFeaturesForStaleJobs(FAKE_SUPABASE);

    expect(summary).toEqual({ candidatesFound: 2, extracted: 2 });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [, entries] = upsertSpy.mock.calls[0]!;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.jobCatalogId).toBe('j1');
    expect(entries[0]?.features.roleFamily).toBe('SOFTWARE_ENGINEERING');
    expect(entries[1]?.features.isInternship).toBe(true);

    listSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it('is a no-op when nothing is stale', async () => {
    const listSpy = vi.spyOn(database, 'listJobCatalogRowsNeedingFeatureRecompute').mockResolvedValue([]);
    const upsertSpy = vi.spyOn(database, 'upsertJobCatalogFeaturesBatch').mockResolvedValue(undefined);

    const summary = await extractFeaturesForStaleJobs(FAKE_SUPABASE);

    expect(summary).toEqual({ candidatesFound: 0, extracted: 0 });
    expect(upsertSpy).toHaveBeenCalledWith(FAKE_SUPABASE, [], expect.any(Date));

    listSpy.mockRestore();
    upsertSpy.mockRestore();
  });
});
