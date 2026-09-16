import { describe, expect, it } from 'vitest';
import { extractWorkAuthorizationRequirement } from './extract-work-authorization-requirement';

describe('extractWorkAuthorizationRequirement', () => {
  it('detects a plain authorization requirement with no sponsorship language', () => {
    const result = extractWorkAuthorizationRequirement(
      'Candidates must be authorized to work in the United States.',
    );
    expect(result.requirement).toBe('AUTHORIZATION_REQUIRED');
    expect(result.evidence).toBeTruthy();
  });

  it('does not fire on a sentence that also mentions sponsorship (that belongs to the sponsorship check)', () => {
    const result = extractWorkAuthorizationRequirement(
      'Candidates must be authorized to work without sponsorship.',
    );
    expect(result.requirement).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when nothing is mentioned', () => {
    const result = extractWorkAuthorizationRequirement('We are building great products.');
    expect(result.requirement).toBe('UNKNOWN');
    expect(result.evidence).toBeNull();
  });
});
