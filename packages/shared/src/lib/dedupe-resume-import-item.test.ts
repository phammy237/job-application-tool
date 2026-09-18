import { describe, expect, it } from 'vitest';
import {
  isDuplicateEducation,
  isDuplicateExperience,
  isDuplicateProject,
  isDuplicateSkill,
} from './dedupe-resume-import-item';

describe('isDuplicateExperience', () => {
  it('matches only on exact company + title + description, never fuzzy', () => {
    const existing = [{ company: 'Acme', title: 'Engineer', description: 'Built things' }];
    expect(isDuplicateExperience(existing, { company: 'Acme', title: 'Engineer', description: 'Built things' })).toBe(true);
    expect(isDuplicateExperience(existing, { company: 'Acme', title: 'Engineer', description: 'Built other things' })).toBe(false);
    expect(isDuplicateExperience(existing, { company: 'ACME', title: 'Engineer', description: 'Built things' })).toBe(false);
  });

  it('an empty existing list never reports a duplicate', () => {
    expect(isDuplicateExperience([], { company: 'Acme', title: 'Engineer', description: null })).toBe(false);
  });
});

describe('isDuplicateEducation', () => {
  it('matches only on exact school + degree + fieldOfStudy', () => {
    const existing = [{ school: 'State U', degree: 'BS', fieldOfStudy: 'CS' }];
    expect(isDuplicateEducation(existing, { school: 'State U', degree: 'BS', fieldOfStudy: 'CS' })).toBe(true);
    expect(isDuplicateEducation(existing, { school: 'State U', degree: 'MS', fieldOfStudy: 'CS' })).toBe(false);
  });
});

describe('isDuplicateProject', () => {
  it('matches only on exact name + description', () => {
    const existing = [{ name: 'Career OS', description: 'A tool' }];
    expect(isDuplicateProject(existing, { name: 'Career OS', description: 'A tool' })).toBe(true);
    expect(isDuplicateProject(existing, { name: 'Career OS', description: 'A different tool' })).toBe(false);
  });
});

describe('isDuplicateSkill', () => {
  it('matches case-insensitively on name only', () => {
    const existing = [{ name: 'TypeScript' }];
    expect(isDuplicateSkill(existing, { name: 'typescript' })).toBe(true);
    expect(isDuplicateSkill(existing, { name: 'Python' })).toBe(false);
  });
});
