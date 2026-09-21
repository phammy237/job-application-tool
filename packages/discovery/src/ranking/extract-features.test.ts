import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import * as database from '@career-os/database';
import * as shared from '@career-os/shared';
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

    expect(summary).toEqual({ candidatesFound: 2, extracted: 2, failed: 0, failures: [] });
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

    expect(summary).toEqual({ candidatesFound: 0, extracted: 0, failed: 0, failures: [] });
    expect(upsertSpy).toHaveBeenCalledWith(FAKE_SUPABASE, [], expect.any(Date));

    listSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it('isolates one candidate whose extraction throws — the rest are still extracted and persisted, never the whole batch aborted', async () => {
    const listSpy = vi
      .spyOn(database, 'listJobCatalogRowsNeedingFeatureRecompute')
      .mockResolvedValue([
        {
          jobCatalogId: 'good-1',
          title: 'Senior Software Engineer',
          description: '<p>Build things.</p>',
          locationText: 'New York, NY',
          employmentType: 'FullTime',
          workplaceType: 'REMOTE',
          contentHash: 'v1:good1',
        },
        {
          jobCatalogId: 'bad-1',
          title: 'Broken Candidate',
          description: null,
          locationText: null,
          employmentType: null,
          workplaceType: null,
          contentHash: 'v1:bad1',
        },
        {
          jobCatalogId: 'good-2',
          title: 'Product Manager Intern',
          description: null,
          locationText: null,
          employmentType: null,
          workplaceType: null,
          contentHash: 'v1:good2',
        },
      ]);
    const upsertSpy = vi.spyOn(database, 'upsertJobCatalogFeaturesBatch').mockResolvedValue(undefined);
    const extractSpy = vi
      .spyOn(shared, 'extractJobCatalogFeatures')
      .mockImplementation((input) => {
        if (input.contentHash === 'v1:bad1') throw new Error('unexpected extraction failure');
        return {
          plainTextDescription: '',
          roleFamily: 'UNKNOWN',
          seniority: 'UNKNOWN',
          isInternship: false,
          isNewGrad: false,
          normalizedEmploymentType: 'UNKNOWN',
          normalizedWorkplaceType: 'UNKNOWN',
          locationTokens: [],
          extractedCompetencyCodes: [],
          requiredYearsMin: null,
          requiredYearsMax: null,
          graduationYearMin: null,
          graduationYearMax: null,
          sponsorshipSignal: 'UNKNOWN',
          citizenshipRequirement: 'UNKNOWN',
          clearanceRequirement: 'UNKNOWN',
          workAuthorizationRequirement: 'UNKNOWN',
          evidence: {},
          contentHashAtExtraction: input.contentHash,
          featureVersion: 'test-version',
        };
      });

    const summary = await extractFeaturesForStaleJobs(FAKE_SUPABASE);

    expect(summary.candidatesFound).toBe(3);
    expect(summary.extracted).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([{ jobCatalogId: 'bad-1', reason: 'unexpected extraction failure' }]);

    const [, entries] = upsertSpy.mock.calls[0]!;
    expect(entries.map((entry) => entry.jobCatalogId)).toEqual(['good-1', 'good-2']);

    listSpy.mockRestore();
    upsertSpy.mockRestore();
    extractSpy.mockRestore();
  });
});
