import { describe, expect, it } from 'vitest';
import { normalizeEmploymentType } from './normalize-employment-type';

describe('normalizeEmploymentType', () => {
  it('normalizes all observed raw FULL_TIME spellings identically', () => {
    expect(normalizeEmploymentType('FullTime')).toBe('FULL_TIME');
    expect(normalizeEmploymentType('Full Time')).toBe('FULL_TIME');
    expect(normalizeEmploymentType('Full-time')).toBe('FULL_TIME');
    expect(normalizeEmploymentType('Fulltime')).toBe('FULL_TIME');
  });

  it('normalizes internship spellings', () => {
    expect(normalizeEmploymentType('Internship')).toBe('INTERNSHIP');
    expect(normalizeEmploymentType('Intern')).toBe('INTERNSHIP');
  });

  it('normalizes contract spellings', () => {
    expect(normalizeEmploymentType('Contract')).toBe('CONTRACT');
    expect(normalizeEmploymentType('Contractor')).toBe('CONTRACT');
  });

  it('normalizes temporary/fixed-term', () => {
    expect(normalizeEmploymentType('Temporary')).toBe('TEMPORARY');
    expect(normalizeEmploymentType('Fixed-Term')).toBe('TEMPORARY');
  });

  it('maps null to UNKNOWN, never a guessed default (Greenhouse is 100% null)', () => {
    expect(normalizeEmploymentType(null)).toBe('UNKNOWN');
  });

  it('maps an unrecognized raw value to UNKNOWN rather than throwing', () => {
    expect(normalizeEmploymentType('Something Weird')).toBe('UNKNOWN');
  });
});
