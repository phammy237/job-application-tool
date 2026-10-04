import { emptyEvidenceGraph, type GraphProject } from '@career-os/shared';
import { describe, expect, it } from 'vitest';
import { parsePortfolioSettingsForm } from './settings-schema';
import { countByVisibility } from './visibility-counts';

const project = (id: string, visibility: GraphProject['visibility'], userApproved: boolean): GraphProject => ({
  id,
  name: id,
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
  visibility,
  userApproved,
  approvedForApplications: true,
});

describe('countByVisibility', () => {
  it('counts per level and only exports PUBLIC + approved', () => {
    const graph = {
      ...emptyEvidenceGraph(),
      projects: [
        project('a', 'PUBLIC', true),
        project('b', 'PUBLIC', false),
        project('c', 'PRIVATE', true),
        project('d', 'CAREER_OS_ONLY', true),
      ],
    };
    const row = countByVisibility(graph).find((r) => r.label === 'Projects')!;
    expect(row).toMatchObject({ PUBLIC: 2, PRIVATE: 1, CAREER_OS_ONLY: 1, exported: 1 });
  });

  it('marks experiences and stories as never exported', () => {
    const rows = countByVisibility(emptyEvidenceGraph());
    expect(rows.find((r) => r.label === 'Stories')!.note).toMatch(/never/i);
    expect(rows.find((r) => r.label === 'Experiences')!.exported).toBe(0);
  });
});

describe('parsePortfolioSettingsForm', () => {
  const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

  it('defaults to disabled and trims/normalizes empties to null', () => {
    const r = parsePortfolioSettingsForm(form({ displayName: '  ', headline: ' Hi ' }));
    expect(r.success && r.data).toEqual({ enabled: false, displayName: null, headline: 'Hi' });
  });

  it('reads the checkbox and rejects over-long input', () => {
    expect(parsePortfolioSettingsForm(form({ enabled: 'on' })).success).toBe(true);
    expect(parsePortfolioSettingsForm(form({ displayName: 'x'.repeat(81) })).success).toBe(false);
  });
});
