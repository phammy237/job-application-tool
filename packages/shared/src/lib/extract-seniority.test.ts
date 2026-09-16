import { describe, expect, it } from 'vitest';
import { extractSeniority } from './extract-seniority';

describe('extractSeniority', () => {
  it('classifies explicit signals', () => {
    expect(extractSeniority('Software Engineering Intern')).toBe('INTERN');
    expect(extractSeniority('Summer Internship')).toBe('INTERN');
    expect(extractSeniority('New Grad Software Engineer')).toBe('NEW_GRAD');
    expect(extractSeniority('Early Career Analyst')).toBe('NEW_GRAD');
    expect(extractSeniority('Senior Software Engineer')).toBe('SENIOR');
    expect(extractSeniority('Staff Engineer')).toBe('STAFF');
    expect(extractSeniority('Principal Engineer')).toBe('PRINCIPAL');
    expect(extractSeniority('Director of Engineering')).toBe('DIRECTOR_PLUS');
    expect(extractSeniority('VP of Sales')).toBe('DIRECTOR_PLUS');
    expect(extractSeniority('Head of Product')).toBe('DIRECTOR_PLUS');
    expect(extractSeniority('Chief of Staff')).toBe('DIRECTOR_PLUS');
  });

  it('handles the "Sr." abbreviation', () => {
    expect(extractSeniority('Sr. Software Engineer')).toBe('SENIOR');
    expect(extractSeniority('Sr Software Engineer')).toBe('SENIOR');
  });

  it('does not classify a functional "X Manager" title as MANAGER seniority', () => {
    expect(extractSeniority('Product Manager')).toBe('UNKNOWN');
    expect(extractSeniority('Technical Program Manager')).toBe('UNKNOWN');
    expect(extractSeniority('Program Manager')).toBe('UNKNOWN');
    expect(extractSeniority('Account Manager')).toBe('UNKNOWN');
  });

  it('classifies a genuine people-management title as MANAGER', () => {
    expect(extractSeniority('Engineering Manager')).toBe('MANAGER');
    expect(extractSeniority('Manager, Technical Account Management')).toBe('MANAGER');
  });

  it('never guesses ENTRY or MID from title text alone (no signal defined)', () => {
    expect(extractSeniority('Software Engineer')).toBe('UNKNOWN');
    expect(extractSeniority('Associate')).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for a plain, unmodified title', () => {
    expect(extractSeniority('Data Analyst')).toBe('UNKNOWN');
  });

  it('director-level beats a coincidental "manager" match', () => {
    expect(extractSeniority('Director, Engineering Manager')).toBe('DIRECTOR_PLUS');
  });
});
