import { describe, expect, it } from 'vitest';
import type { Education } from '../schemas/education';
import type { Experience } from '../schemas/experience';
import type { Profile } from '../schemas/profile';
import type { Project } from '../schemas/project';
import type { Skill } from '../schemas/skill';
import { buildStructuredResumeFromProfile } from './resume-content-from-profile';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const PROFILE: Profile = {
  userId: USER_ID,
  fullName: 'Ada Lovelace',
  headline: null,
  email: 'ada@example.com',
  phone: '555-1234',
  location: 'London, UK',
  workAuthorization: null,
  relocationPreference: null,
  links: { linkedin: null, portfolio: null, github: null, website: null },
  publicSlug: null,
  visibleOnPublicProfile: false,
  onboardingCompletedAt: null,
};

function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: 'exp-1',
    userId: USER_ID,
    sourceFactId: null,
    company: 'Acme',
    title: 'Engineer',
    location: 'Remote',
    employmentType: null,
    startDate: '2024-06-01',
    endDate: null,
    description: null,
    tags: [],
    displayOrder: 0,
    userApproved: true,
    approvedForApplications: true,
    visibleOnPublicProfile: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function education(overrides: Partial<Education> = {}): Education {
  return {
    id: 'edu-1',
    userId: USER_ID,
    sourceFactId: null,
    school: 'MIT',
    degree: 'B.S.',
    fieldOfStudy: 'Computer Science',
    startDate: '2020-09-01',
    graduationDate: '2024-05-01',
    gpa: '3.9',
    honors: [],
    userApproved: true,
    approvedForApplications: true,
    visibleOnPublicProfile: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    userId: USER_ID,
    sourceFactId: null,
    name: 'Career OS',
    description: null,
    role: 'Creator',
    startDate: null,
    endDate: null,
    url: null,
    tags: [],
    userApproved: true,
    approvedForApplications: true,
    visibleOnPublicProfile: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    userId: USER_ID,
    sourceFactId: null,
    name: 'Python',
    category: 'Languages',
    proficiency: null,
    userApproved: true,
    approvedForApplications: true,
    visibleOnPublicProfile: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildStructuredResumeFromProfile', () => {
  it('builds a header from the profile', () => {
    const resume = buildStructuredResumeFromProfile(PROFILE, [], [], [], []);
    expect(resume.header).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555-1234',
      location: 'London, UK',
      links: PROFILE.links,
    });
  });

  it('falls back to email, then a generic placeholder, when fullName is unset — never fabricates a real name', () => {
    const noName = buildStructuredResumeFromProfile(
      { ...PROFILE, fullName: null },
      [],
      [],
      [],
      [],
    );
    expect(noName.header.fullName).toBe('ada@example.com');

    const noNameOrEmail = buildStructuredResumeFromProfile(
      { ...PROFILE, fullName: null, email: null },
      [],
      [],
      [],
      [],
    );
    expect(noNameOrEmail.header.fullName).toBe('Your Name');
  });

  it('produces a valid header even with no profile at all', () => {
    const resume = buildStructuredResumeFromProfile(null, [], [], [], []);
    expect(resume.header.fullName).toBe('Your Name');
  });

  it('only includes approved experiences, education, projects, and skills', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [
        experience({ id: 'approved' }),
        experience({ id: 'unapproved', userApproved: false }),
      ],
      [
        education({ id: 'approved' }),
        education({ id: 'unapproved', approvedForApplications: false }),
      ],
      [project({ id: 'approved' }), project({ id: 'unapproved', userApproved: false })],
      [
        skill({ id: 'approved' }),
        skill({ id: 'unapproved', approvedForApplications: false }),
      ],
    );
    expect(resume.experience).toHaveLength(1);
    expect(resume.education).toHaveLength(1);
    expect(resume.projects).toHaveLength(1);
    expect(resume.skills.flatMap((g) => g.items)).toEqual(['Python']);
  });

  it('never populates leadership — no structured source table exists', () => {
    const resume = buildStructuredResumeFromProfile(PROFILE, [], [], [], []);
    expect(resume.leadership).toEqual([]);
  });

  it('maps experience dates, inferring isPresent from a null endDate', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ startDate: '2024-06-01', endDate: null })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.dateRange).toEqual({
      start: { year: 2024, month: 6 },
      end: null,
      isPresent: true,
    });
  });

  it('maps a completed experience range without isPresent', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ startDate: '2023-01-01', endDate: '2024-01-01' })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.dateRange).toEqual({
      start: { year: 2023, month: 1 },
      end: { year: 2024, month: 1 },
      isPresent: false,
    });
  });

  it('splits a multi-line description into separate bullets, preserving order', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ description: 'Built the pipeline.\nReduced latency by 30%.' })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.bullets.map((b) => b.text)).toEqual([
      'Built the pipeline.',
      'Reduced latency by 30%.',
    ]);
  });

  it('carries sourceFactId through as CANDIDATE_FACTS provenance on the mapped bullet', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ description: 'Did the thing.', sourceFactId: 'fact-1' })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.bullets[0]?.provenance).toEqual({
      type: 'CANDIDATE_FACTS',
      sourceFactIds: ['fact-1'],
    });
  });

  it('marks a manually-created experience (no sourceFactId) as MANUAL provenance', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ description: 'Did the thing.', sourceFactId: null })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.bullets[0]?.provenance).toEqual({ type: 'MANUAL' });
  });

  it('produces no bullets for a blank description', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ description: '   \n  ' })],
      [],
      [],
      [],
    );
    expect(resume.experience[0]?.bullets).toEqual([]);
  });

  it('groups skills by their existing category, and ungrouped skills fall back to "Skills"', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [],
      [],
      [],
      [
        skill({ id: 's1', name: 'Python', category: 'Languages' }),
        skill({ id: 's2', name: 'TypeScript', category: 'Languages' }),
        skill({ id: 's3', name: 'Leadership', category: null }),
      ],
    );
    const languages = resume.skills.find((g) => g.label === 'Languages');
    const generic = resume.skills.find((g) => g.label === 'Skills');
    expect(languages?.items).toEqual(['Python', 'TypeScript']);
    expect(generic?.items).toEqual(['Leadership']);
  });

  it('maps education gpa/honors/degree/fieldOfStudy faithfully', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [],
      [education({ gpa: '3.9', honors: ["Dean's List"] })],
      [],
      [],
    );
    expect(resume.education[0]).toMatchObject({
      institution: 'MIT',
      degree: 'B.S.',
      fieldOfStudy: 'Computer Science',
      gpa: '3.9',
      honors: ["Dean's List"],
    });
  });

  it('generates a fresh, distinct id for every mapped entry', () => {
    const resume = buildStructuredResumeFromProfile(
      PROFILE,
      [experience({ id: 'a' }), experience({ id: 'b' })],
      [],
      [],
      [],
    );
    const ids = resume.experience.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
  });
});
