import { describe, expect, it } from 'vitest';
import { normalizeCompanyNameForDedupe } from './normalize-company-name';

describe('normalizeCompanyNameForDedupe', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeCompanyNameForDedupe('  Acme   Corp ')).toBe('acme corp');
  });

  it('strips trailing sentence punctuation only', () => {
    expect(normalizeCompanyNameForDedupe('Acme Corp.')).toBe('acme corp');
  });

  it('does not strip legal suffixes (conservative, avoids false merges)', () => {
    expect(normalizeCompanyNameForDedupe('Acme Inc')).toBe('acme inc');
    expect(normalizeCompanyNameForDedupe('Acme LLC')).toBe('acme llc');
    expect(normalizeCompanyNameForDedupe('Acme Inc')).not.toBe(normalizeCompanyNameForDedupe('Acme LLC'));
  });
});
