import { describe, expect, it } from 'vitest';
import { extractExperienceYears } from './extract-experience-years';

describe('extractExperienceYears', () => {
  it('parses "N+ years"', () => {
    expect(extractExperienceYears('You have 3+ years of experience in product management.')).toEqual({
      min: 3,
      max: null,
    });
  });

  it('parses "at least N years"', () => {
    expect(extractExperienceYears('Candidates need at least 2 years of relevant experience.')).toEqual({
      min: 2,
      max: null,
    });
  });

  it('parses an explicit range "N-M years"', () => {
    expect(extractExperienceYears('2-4 years of experience preferred.')).toEqual({ min: 2, max: 4 });
    expect(extractExperienceYears('2 to 4 years of experience preferred.')).toEqual({ min: 2, max: 4 });
  });

  it('parses "minimum of N years"', () => {
    expect(extractExperienceYears('A minimum of 5 years of experience is required.')).toEqual({
      min: 5,
      max: null,
    });
  });

  it('parses a bare "N years of experience"', () => {
    expect(extractExperienceYears('5 years of experience with SQL.')).toEqual({ min: 5, max: null });
  });

  it('does not confuse a graduation year with experience', () => {
    expect(extractExperienceYears('We are looking for candidates graduating in 2027.')).toBeNull();
  });

  it('does not confuse company/product age with experience', () => {
    expect(extractExperienceYears('Our company has been operating for 10 years.')).toBeNull();
    expect(extractExperienceYears('This product has 5 years of historical data.')).toBeNull();
  });

  it('does not confuse a revenue figure with experience', () => {
    expect(extractExperienceYears('We generate $10 million in annual recurring revenue.')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(extractExperienceYears('A completely unrelated sentence.')).toBeNull();
  });
});
