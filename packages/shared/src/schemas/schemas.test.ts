import { describe, expect, it } from 'vitest';
import {
  applicationInputSchema,
  applicationStatusSchema,
  candidateFactInputSchema,
  candidateFactSchema,
  experienceSchema,
  profileUpdateSchema,
} from '../index';

describe('candidateFactSchema', () => {
  it('accepts a fully-populated approved fact', () => {
    const result = candidateFactSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      category: 'EXPERIENCE',
      title: 'Backend Engineer @ Acme',
      normalizedValue: 'Built the payments service handling 2M requests/day.',
      sourceText: 'Built payments service...',
      sourceResumeId: null,
      userApproved: true,
      approvedForApplications: true,
      visibleOnPublicProfile: false,
      tags: ['backend', 'payments'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const result = candidateFactSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      category: 'NOT_A_REAL_CATEGORY',
      title: 'x',
      normalizedValue: 'x',
      sourceText: null,
      sourceResumeId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('input schema defaults approval flags to false — nothing is approved by default', () => {
    const parsed = candidateFactInputSchema.parse({
      category: 'SKILL',
      title: 'TypeScript',
      normalizedValue: 'TypeScript',
    });
    expect(parsed.userApproved).toBe(false);
    expect(parsed.approvedForApplications).toBe(false);
    expect(parsed.visibleOnPublicProfile).toBe(false);
  });
});

describe('experienceSchema', () => {
  it('defaults tags and displayOrder', () => {
    const parsed = experienceSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      sourceFactId: null,
      company: 'Acme',
      title: 'Engineer',
      location: null,
      employmentType: null,
      startDate: null,
      endDate: null,
      description: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.tags).toEqual([]);
    expect(parsed.displayOrder).toBe(0);
  });
});

describe('applicationStatusSchema', () => {
  it('covers every status from docs/PRODUCT_SPEC.md §7', () => {
    const expected = [
      'SAVED',
      'IN_PROGRESS',
      'APPLIED',
      'APPLICATION_RECEIVED',
      'ASSESSMENT',
      'INTERVIEW',
      'ACTION_REQUIRED',
      'OFFER',
      'REJECTED',
      'WITHDRAWN',
      'UNKNOWN',
    ];
    expect(applicationStatusSchema.options).toEqual(expected);
  });

  it('rejects a status outside the enum', () => {
    expect(applicationStatusSchema.safeParse('GHOSTED').success).toBe(false);
  });
});

describe('applicationInputSchema', () => {
  it('requires company and title', () => {
    const result = applicationInputSchema.safeParse({ company: '', title: '' });
    expect(result.success).toBe(false);
  });

  it('defaults status to SAVED', () => {
    const parsed = applicationInputSchema.parse({ company: 'Acme', title: 'Engineer' });
    expect(parsed.status).toBe('SAVED');
  });
});

describe('profileUpdateSchema', () => {
  it('never includes userId — server always derives it from the session', () => {
    expect('userId' in profileUpdateSchema.shape).toBe(false);
  });
});
