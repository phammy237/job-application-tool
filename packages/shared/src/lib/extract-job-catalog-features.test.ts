import { describe, expect, it } from 'vitest';
import { extractJobCatalogFeatures } from './extract-job-catalog-features';

describe('extractJobCatalogFeatures', () => {
  it('combines title, employment type, workplace type, and description signals', () => {
    const result = extractJobCatalogFeatures({
      title: 'Senior Product Manager',
      description: '<p>Own the roadmap. 5+ years of experience with SQL and product strategy required.</p>',
      locationText: 'New York, NY',
      employmentType: 'FullTime',
      workplaceType: 'HYBRID',
      contentHash: 'v1:abc',
    });

    expect(result.roleFamily).toBe('PRODUCT_MANAGEMENT');
    // "Senior Product Manager" is a functional-manager title (so it does NOT get MANAGER
    // seniority merely for containing "manager"), but "senior" is still its own explicit signal.
    expect(result.seniority).toBe('SENIOR');
    expect(result.normalizedEmploymentType).toBe('FULL_TIME');
    expect(result.normalizedWorkplaceType).toBe('HYBRID');
    expect(result.locationTokens).toEqual(['NEW_YORK_NY']);
    expect(result.extractedCompetencyCodes).toEqual(expect.arrayContaining(['SQL', 'ROADMAP', 'PRODUCT_STRATEGY']));
    expect(result.requiredYearsMin).toBe(5);
    expect(result.contentHashAtExtraction).toBe('v1:abc');
    expect(result.featureVersion).toBe('d4-features-v2');
  });

  it('detects internship from title when employment_type is null (Greenhouse-shaped input)', () => {
    const result = extractJobCatalogFeatures({
      title: 'Software Engineering Intern',
      description: '<p>Join us for the summer.</p>',
      locationText: null,
      employmentType: null,
      workplaceType: null,
      contentHash: 'v1:x',
    });
    expect(result.isInternship).toBe(true);
    expect(result.normalizedEmploymentType).toBe('UNKNOWN');
  });

  it('produces plain-text description via HTML normalization, never raw HTML', () => {
    const result = extractJobCatalogFeatures({
      title: 'Data Analyst',
      description: '<p>We use &amp; love data.</p>',
      locationText: null,
      employmentType: null,
      workplaceType: null,
      contentHash: 'v1:y',
    });
    expect(result.plainTextDescription).toBe('We use & love data.');
    expect(result.plainTextDescription).not.toContain('<p>');
  });

  it('handles a null description without throwing', () => {
    const result = extractJobCatalogFeatures({
      title: 'Data Analyst',
      description: null,
      locationText: null,
      employmentType: null,
      workplaceType: null,
      contentHash: 'v1:z',
    });
    expect(result.plainTextDescription).toBe('');
    expect(result.extractedCompetencyCodes).toEqual([]);
  });

  it('extracts sponsorship/citizenship/clearance/graduation signals from the description', () => {
    const result = extractJobCatalogFeatures({
      title: 'Software Engineer',
      description:
        '<p>We are unable to sponsor visas. Must be a US citizen. Must possess an active clearance. Open to class of 2027 or 2028 graduates.</p>',
      locationText: null,
      employmentType: null,
      workplaceType: null,
      contentHash: 'v1:w',
    });
    expect(result.sponsorshipSignal).toBe('NOT_AVAILABLE');
    expect(result.citizenshipRequirement).toBe('US_CITIZEN_ONLY');
    expect(result.clearanceRequirement).toBe('ACTIVE_CLEARANCE_REQUIRED');
    expect(result.graduationYearMin).toBe(2027);
    expect(result.graduationYearMax).toBe(2028);
    expect(result.evidence.sponsorship).toBeTruthy();
  });
});
