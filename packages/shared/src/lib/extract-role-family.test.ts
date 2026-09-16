import { describe, expect, it } from 'vitest';
import { extractRoleFamily } from './extract-role-family';

describe('extractRoleFamily', () => {
  it('classifies plain role titles', () => {
    expect(extractRoleFamily('Product Manager')).toBe('PRODUCT_MANAGEMENT');
    expect(extractRoleFamily('Senior Software Engineer')).toBe('SOFTWARE_ENGINEERING');
    expect(extractRoleFamily('Data Scientist')).toBe('DATA_SCIENCE');
    expect(extractRoleFamily('Data Analyst')).toBe('DATA_ANALYTICS');
    expect(extractRoleFamily('Business Analyst')).toBe('BUSINESS_ANALYTICS');
    expect(extractRoleFamily('Management Consultant')).toBe('CONSULTING');
  });

  it('checks Technical Program Manager before generic Product Manager', () => {
    expect(extractRoleFamily('Technical Program Manager')).toBe('TECHNICAL_PROGRAM_MANAGEMENT');
    expect(extractRoleFamily('Senior TPM')).toBe('TECHNICAL_PROGRAM_MANAGEMENT');
  });

  it('classifies real live-observed titles correctly', () => {
    expect(extractRoleFamily('Forward Deployed Software Engineer')).toBe('SOFTWARE_ENGINEERING');
    expect(extractRoleFamily('Software Engineer, Product Security Data Platforms')).toBe(
      'SOFTWARE_ENGINEERING',
    );
  });

  it('returns UNKNOWN for a genuinely ambiguous, company-specific title (never a company hack)', () => {
    expect(extractRoleFamily('Deployment Strategist')).toBe('UNKNOWN');
    expect(extractRoleFamily('Talent Strategist')).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for an unrecognized title rather than forcing a category', () => {
    expect(extractRoleFamily('Tax Lead')).toBe('UNKNOWN');
    expect(extractRoleFamily('Sales')).toBe('UNKNOWN');
  });

  it('is case-insensitive', () => {
    expect(extractRoleFamily('PRODUCT MANAGER')).toBe('PRODUCT_MANAGEMENT');
  });

  it('does not false-positive on unrelated substrings', () => {
    // "PM" is not matched at all in V1 (too ambiguous as a bare abbreviation); "product manager"
    // requires the full phrase.
    expect(extractRoleFamily('Program Coordinator')).toBe('UNKNOWN');
  });
});
