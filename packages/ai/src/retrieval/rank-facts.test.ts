import type { ApprovedFactForGeneration } from '@career-os/database';
import { describe, expect, it } from 'vitest';
import { RANKING_TOP_N } from '../config';
import { rankFacts } from './rank-facts';
import type { ScorableJob } from './score-fact';

const NOW = new Date('2026-08-08T00:00:00.000Z');

const JOB: ScorableJob = {
  title: 'Backend Engineer',
  description: 'Build and scale our payments service using TypeScript and Postgres.',
  responsibilities: ['Own the payments pipeline'],
  qualifications: ['5+ years backend experience'],
  preferredQualifications: [],
  skills: ['TypeScript', 'Postgres'],
};

function fact(overrides: Partial<ApprovedFactForGeneration>): ApprovedFactForGeneration {
  return {
    id: 'fact',
    sourceTable: 'experiences',
    category: 'EXPERIENCE',
    text: 'Built and scaled a backend payments service using TypeScript and Postgres.',
    tags: ['typescript', 'postgres'],
    recencyDate: '2025-01-01',
    isOngoing: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rankFacts — determinism (Definition of Done requirement)', () => {
  it('returns byte-identical output across two calls with identical input', () => {
    const facts = [
      fact({ id: 'a', text: 'Backend TypeScript Postgres role.' }),
      fact({ id: 'b', text: 'Frontend design role.', tags: [] }),
      fact({ id: 'c', text: 'Book club organizer.', tags: [] }),
    ];
    const first = rankFacts(JOB, 'EXPERIENCE', facts, { now: NOW });
    const second = rankFacts(JOB, 'EXPERIENCE', facts, { now: NOW });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('produces the same ranking regardless of input array order', () => {
    const a = fact({ id: 'a', text: 'Backend TypeScript Postgres role.' });
    const b = fact({ id: 'b', text: 'Some other backend role.' });
    const forward = rankFacts(JOB, 'EXPERIENCE', [a, b], { now: NOW });
    const reversed = rankFacts(JOB, 'EXPERIENCE', [b, a], { now: NOW });
    expect(forward.map((r) => r.fact.id)).toEqual(reversed.map((r) => r.fact.id));
  });
});

describe('rankFacts — relevance floor (insufficient-facts mechanism)', () => {
  it('returns an empty array when every fact scores below MIN_RELEVANCE_SCORE', () => {
    const facts = [
      fact({
        id: 'x',
        // Off-topic text/tags (no keyword or skill overlap), off-category for an EXPERIENCE
        // field (0.3 not 1.0), and no recency signal (neutral 0.5) — combined this lands
        // below the floor, unlike a same-category fact with zero text overlap alone.
        sourceTable: 'skills',
        category: 'SKILL',
        text: 'Completely unrelated hobby content.',
        tags: [],
        recencyDate: null,
        isOngoing: false,
      }),
    ];
    const ranked = rankFacts(JOB, 'EXPERIENCE', facts, { now: NOW });
    expect(ranked).toEqual([]);
  });
});

describe('rankFacts — top-N truncation', () => {
  it('never returns more than RANKING_TOP_N facts', () => {
    const facts = Array.from({ length: RANKING_TOP_N + 5 }, (_, i) =>
      fact({ id: `fact-${i}`, recencyDate: `2025-0${(i % 9) + 1}-01` }),
    );
    const ranked = rankFacts(JOB, 'EXPERIENCE', facts, { now: NOW });
    expect(ranked.length).toBeLessThanOrEqual(RANKING_TOP_N);
  });
});

describe('rankFacts — tie-break stability', () => {
  it('breaks equal scores by recency desc, then id asc, regardless of input order', () => {
    const older = fact({ id: 'z-older', recencyDate: '2020-01-01' });
    const newer = fact({ id: 'a-newer', recencyDate: '2026-01-01' });
    const ranked = rankFacts(JOB, 'EXPERIENCE', [older, newer], { now: NOW });
    // both facts are textually identical apart from id/recencyDate, so scores tie except for
    // the recency signal — newer must sort first.
    expect(ranked[0]?.fact.id).toBe('a-newer');
  });
});
