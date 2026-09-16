import { describe, expect, it } from 'vitest';
import { extractClearanceRequirement } from './extract-clearance-requirement';

describe('extractClearanceRequirement', () => {
  it('detects an explicit active-clearance requirement', () => {
    const result = extractClearanceRequirement('Candidates must possess an active Top Secret clearance.');
    expect(result.requirement).toBe('ACTIVE_CLEARANCE_REQUIRED');
    expect(result.evidence).toBeTruthy();
  });

  it('detects an explicit eligibility-to-obtain requirement, distinct from active', () => {
    const result = extractClearanceRequirement('Candidates must be able to obtain a security clearance.');
    expect(result.requirement).toBe('CLEARANCE_ELIGIBILITY_REQUIRED');
  });

  it('prefers ACTIVE_CLEARANCE_REQUIRED when both phrasings could plausibly apply', () => {
    const result = extractClearanceRequirement(
      'Must possess an active security clearance. Ability to obtain a security clearance is a plus.',
    );
    expect(result.requirement).toBe('ACTIVE_CLEARANCE_REQUIRED');
  });

  it('classifies "active clearance or an ability to obtain" as eligibility-required, not active-required (live-observed Palantir phrasing)', () => {
    const result = extractClearanceRequirement(
      'Active clearance or an ability to obtain an active clearance in the country the job is advertised.',
    );
    expect(result.requirement).toBe('CLEARANCE_ELIGIBILITY_REQUIRED');
    expect(result.evidence).toBeTruthy();
  });

  it('returns UNKNOWN when no clearance wording is present', () => {
    const result = extractClearanceRequirement('We build great products for our customers.');
    expect(result.requirement).toBe('UNKNOWN');
    expect(result.evidence).toBeNull();
  });
});
