import { describe, expect, it } from 'vitest';
import { normalizeWorkplaceType } from './normalize-workplace-type';

describe('normalizeWorkplaceType', () => {
  it('prefers the structured value when present', () => {
    expect(normalizeWorkplaceType('REMOTE', 'Onsite office in NYC')).toBe('REMOTE');
    expect(normalizeWorkplaceType('ONSITE', null)).toBe('ONSITE');
  });

  it('falls back to a conservative location-text phrase scan when structured is null', () => {
    expect(normalizeWorkplaceType(null, 'Remote U.S.')).toBe('REMOTE');
    expect(normalizeWorkplaceType(null, 'Hybrid - New York, NY')).toBe('HYBRID');
  });

  it('never infers ONSITE from the absence of a phrase', () => {
    expect(normalizeWorkplaceType(null, 'New York, NY')).toBe('UNKNOWN');
    expect(normalizeWorkplaceType(null, null)).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when there is no structured value and no location text', () => {
    expect(normalizeWorkplaceType(null, null)).toBe('UNKNOWN');
  });
});
