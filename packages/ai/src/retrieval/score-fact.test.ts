import type { ApprovedFactForGeneration } from '@career-os/database';
import { describe, expect, it } from 'vitest';
import { scoreFact, type ScorableJob } from './score-fact';

const NOW = new Date('2026-08-08T00:00:00.000Z');

const JOB: ScorableJob = {
  title: 'Backend Engineer',
  description: 'Build and scale our payments service using TypeScript and Postgres.',
  responsibilities: ['Own the payments pipeline', 'Design REST APIs'],
  qualifications: ['5+ years backend experience', 'Strong TypeScript skills'],
  preferredQualifications: ['Experience with Postgres at scale'],
  skills: ['TypeScript', 'Postgres', 'AWS'],
};

function fact(overrides: Partial<ApprovedFactForGeneration>): ApprovedFactForGeneration {
  return {
    id: 'fact-1',
    sourceTable: 'experiences',
    category: 'EXPERIENCE',
    text: 'Generic fact with no overlap whatsoever.',
    tags: [],
    recencyDate: null,
    isOngoing: false,
    ...overrides,
  };
}

describe('scoreFact — keyword overlap signal', () => {
  it('scores higher for a fact sharing many job keywords', () => {
    const relevant = fact({
      text: 'Built and scaled a backend payments service using TypeScript and Postgres.',
    });
    const irrelevant = fact({ text: 'Organized a community book club.' });
    expect(scoreFact(JOB, 'EXPERIENCE', relevant, NOW)).toBeGreaterThan(
      scoreFact(JOB, 'EXPERIENCE', irrelevant, NOW),
    );
  });
});

describe('scoreFact — skill/tag match signal', () => {
  it('scores higher when fact tags match job.skills', () => {
    const withTags = fact({ text: 'Some project.', tags: ['typescript', 'postgres', 'aws'] });
    const withoutTags = fact({ text: 'Some project.', tags: [] });
    expect(scoreFact(JOB, 'EXPERIENCE', withTags, NOW)).toBeGreaterThan(
      scoreFact(JOB, 'EXPERIENCE', withoutTags, NOW),
    );
  });
});

describe('scoreFact — category/classification match signal', () => {
  it('scores an EXPERIENCE-sourced fact higher for an EXPERIENCE field than a SKILL-sourced one', () => {
    const experienceFact = fact({ sourceTable: 'experiences', category: 'EXPERIENCE' });
    const skillFact = fact({ sourceTable: 'skills', category: 'SKILL' });
    expect(scoreFact(JOB, 'EXPERIENCE', experienceFact, NOW)).toBeGreaterThan(
      scoreFact(JOB, 'EXPERIENCE', skillFact, NOW),
    );
  });

  it('gives every fact the same neutral category score for a classification with no affinity table entry', () => {
    const experienceFact = fact({ sourceTable: 'experiences', category: 'EXPERIENCE' });
    const skillFact = fact({ sourceTable: 'skills', category: 'SKILL' });
    // FREE_RESPONSE has no CATEGORY_AFFINITY entry — both facts get the flat 0.5, so any
    // score difference must come entirely from the other three signals, which are identical
    // here (same text, same tags, same recency).
    expect(scoreFact(JOB, 'FREE_RESPONSE', experienceFact, NOW)).toBe(
      scoreFact(JOB, 'FREE_RESPONSE', skillFact, NOW),
    );
  });
});

describe('scoreFact — recency signal', () => {
  it('scores an ongoing role at least as high as a role that ended recently', () => {
    const ongoing = fact({ isOngoing: true, recencyDate: '2024-01-01' });
    const recentlyEnded = fact({ isOngoing: false, recencyDate: '2026-06-01' });
    expect(scoreFact(JOB, 'EXPERIENCE', ongoing, NOW)).toBeGreaterThanOrEqual(
      scoreFact(JOB, 'EXPERIENCE', recentlyEnded, NOW),
    );
  });

  it('scores a role from 6 years ago lower than one from 6 months ago', () => {
    const old = fact({ recencyDate: '2020-08-01' });
    const recent = fact({ recencyDate: '2026-02-01' });
    expect(scoreFact(JOB, 'EXPERIENCE', recent, NOW)).toBeGreaterThan(
      scoreFact(JOB, 'EXPERIENCE', old, NOW),
    );
  });

  it('treats a null recency date as neutral, not zero', () => {
    const nullDate = fact({ recencyDate: null, isOngoing: false });
    const veryOld = fact({ recencyDate: '2015-01-01', isOngoing: false });
    expect(scoreFact(JOB, 'EXPERIENCE', nullDate, NOW)).toBeGreaterThan(
      scoreFact(JOB, 'EXPERIENCE', veryOld, NOW),
    );
  });
});

describe('scoreFact — determinism', () => {
  it('returns the exact same score for identical inputs', () => {
    const f = fact({ text: 'Built the payments service.', recencyDate: '2025-01-01' });
    expect(scoreFact(JOB, 'EXPERIENCE', f, NOW)).toBe(scoreFact(JOB, 'EXPERIENCE', f, NOW));
  });

  it('always returns a value within [0, 1]', () => {
    const f = fact({
      text: 'Built and scaled a backend payments service using TypeScript and Postgres.',
      tags: ['typescript', 'postgres', 'aws'],
      isOngoing: true,
    });
    const score = scoreFact(JOB, 'EXPERIENCE', f, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
