import { createEmptyStructuredResume, emptyEvidenceGraph } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  groundResumeBullets,
  groundResumeBulletsToMap,
  hasGroundingWarning,
  listResumeBullets,
} from './bullet-grounding';
import { testGraph } from './test-graph';

function resumeWith(texts: string[]) {
  const r = createEmptyStructuredResume({
    fullName: 'Ada',
    email: null,
    phone: null,
    location: null,
    links: {},
  });
  r.projects = [
    {
      id: 'p1',
      name: 'Campus Planner',
      role: null,
      url: null,
      dateRange: { start: null, end: null, isPresent: false },
      bullets: texts.map((text, i) => ({
        id: `b${i}`,
        text,
        provenance: { type: 'MANUAL' },
      })),
    },
  ] as never;
  return r;
}

describe('bullet grounding', () => {
  it('lists bullets across sections', () => {
    expect(listResumeBullets(resumeWith(['a', 'b'])).map((b) => b.id)).toEqual([
      'b0',
      'b1',
    ]);
  });

  it('grounds a supported bullet with evidence and no warnings', () => {
    const [g] = groundResumeBullets(
      testGraph(),
      resumeWith(['Built a scheduling app in React used by 500 students']),
    );
    expect(g!.supportLevel).not.toBe('NONE');
    expect(g!.evidence.length).toBeGreaterThan(0);
    expect(g!.unsupportedNumbers).toEqual([]);
  });

  it('flags numbers and technologies the evidence does not back', () => {
    const [g] = groundResumeBullets(
      testGraph(),
      resumeWith([
        'Built a scheduling app in React and Kubernetes used by 9000 students',
      ]),
    );
    expect(g!.unsupportedNumbers.length).toBeGreaterThan(0);
    expect(g!.unsupportedTechnologies).toContain('Kubernetes');
    expect(hasGroundingWarning(g!)).toBe(true);
  });

  it('an empty graph yields NONE and a warning', () => {
    const map = groundResumeBulletsToMap(
      emptyEvidenceGraph(),
      resumeWith(['Led a team']),
    );
    expect(map['b0']!.supportLevel).toBe('NONE');
    expect(hasGroundingWarning(map['b0']!)).toBe(true);
  });

  it('skips blank bullets', () => {
    expect(groundResumeBullets(testGraph(), resumeWith(['   ']))).toEqual([]);
  });
});
