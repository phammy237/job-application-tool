import { describe, expect, it } from 'vitest';
import { extractCitizenshipRequirement } from './extract-citizenship-requirement';

describe('extractCitizenshipRequirement', () => {
  it('detects explicit "US citizens only" language', () => {
    const result = extractCitizenshipRequirement('This role requires US citizens only due to federal contracts.');
    expect(result.requirement).toBe('US_CITIZEN_ONLY');
    expect(result.evidence).toBeTruthy();
  });

  it('detects "must be a US citizen"', () => {
    expect(extractCitizenshipRequirement('Applicants must be a US citizen.').requirement).toBe(
      'US_CITIZEN_ONLY',
    );
  });

  it('returns UNKNOWN when no citizenship wording is present', () => {
    const result = extractCitizenshipRequirement('We are looking for a talented software engineer.');
    expect(result.requirement).toBe('UNKNOWN');
    expect(result.evidence).toBeNull();
  });
});
