import { emptyEvidenceGraph, type GraphProject } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  buildSnapshot,
  buildUnknowns,
  formatDate,
  isNearlyEmpty,
} from './home';

function project(over: Partial<GraphProject> = {}): GraphProject {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'P',
    description: null,
    summary: null,
    role: null,
    startDate: null,
    endDate: null,
    url: null,
    tags: [],
    status: null,
    collaborators: [],
    talkingPoints: [],
    origin: 'MANUAL',
    visibility: 'PRIVATE',
    userApproved: false,
    approvedForApplications: false,
    ...over,
  };
}

describe('buildSnapshot', () => {
  it('is honest about an empty graph', () => {
    const s = buildSnapshot(emptyEvidenceGraph());
    expect(s.total).toBe(0);
    expect(s.sentence).toMatch(/does not know anything/);
    expect(isNearlyEmpty(s)).toBe(true);
  });

  it('separates confirmed from unconfirmed', () => {
    const g = emptyEvidenceGraph();
    g.projects = [project({ userApproved: true }), project({ id: 'x' })];
    const s = buildSnapshot(g);
    expect(s.confirmed).toBe(1);
    expect(s.unconfirmed).toBe(1);
    expect(s.sentence).toContain('2 projects');
    expect(s.sentence).toContain('1 of 2 is confirmed');
  });
});

describe('buildChecklist', () => {
  it('computes done flags from real data', () => {
    const g = emptyEvidenceGraph();
    g.projects = [project({ userApproved: true, approvedForApplications: true })];
    const items = buildChecklist(g, null, []);
    expect(items.map((i) => i.done)).toEqual([false, false, true, false, false, true]);
    expect(items).toHaveLength(6);
  });
});

describe('buildUnknowns', () => {
  it('lists the gaps', () => {
    const u = buildUnknowns(emptyEvidenceGraph(), null);
    expect(u.some((x) => x.includes('GitHub'))).toBe(true);
    expect(u.length).toBe(7);
  });
});

describe('formatDate', () => {
  it('handles null and invalid', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nope')).toBe('—');
    expect(formatDate('2025-03-04T10:00:00Z')).toBe('2025-03-04');
  });
});

describe('buildChecklist step 6', () => {
  it('points at the projects page where approval toggles live', () => {
    const step = buildChecklist(emptyEvidenceGraph(), null, []).find((s) => s.step === 6);
    expect(step?.href).toBe('/my/projects');
  });
});
