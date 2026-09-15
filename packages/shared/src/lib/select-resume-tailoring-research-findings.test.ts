import { describe, expect, it } from 'vitest';
import type { CompanyResearchFinding } from '../schemas/company-research';
import { selectResumeTailoringResearchFindings } from './select-resume-tailoring-research-findings';

function finding(overrides: Partial<CompanyResearchFinding> & { id: string }): CompanyResearchFinding {
  return {
    category: 'OTHER',
    claim: 'A company fact',
    roleRelevance: null,
    requirementIds: [],
    sources: [
      {
        id: 'src-1',
        url: 'https://example.com/a',
        canonicalUrl: null,
        title: 'A source',
        publisher: null,
        sourceType: 'OTHER',
        publishedAt: null,
        retrievedAt: '2026-01-01T00:00:00.000Z',
        evidenceExcerpt: null,
        contentHash: null,
      },
    ],
    ...overrides,
  };
}

describe('selectResumeTailoringResearchFindings', () => {
  it('returns an empty array for an empty snapshot', () => {
    expect(selectResumeTailoringResearchFindings([], new Set(), 10)).toEqual([]);
  });

  it('never mutates its input array', () => {
    const findings = [finding({ id: 'a' }), finding({ id: 'b' })];
    const frozen = JSON.parse(JSON.stringify(findings));
    selectResumeTailoringResearchFindings(findings, new Set(), 1);
    expect(findings).toEqual(frozen);
  });

  it('caps the result at maxFindings', () => {
    const findings = Array.from({ length: 20 }, (_, i) => finding({ id: `f-${i}` }));
    const result = selectResumeTailoringResearchFindings(findings, new Set(), 5);
    expect(result).toHaveLength(5);
  });

  it('ranks a finding that overlaps this request\'s own requirement ids above one that does not', () => {
    const overlapping = finding({ id: 'overlap', requirementIds: ['req-1'] });
    const nonOverlapping = finding({ id: 'no-overlap', requirementIds: ['req-999'] });
    const result = selectResumeTailoringResearchFindings(
      [nonOverlapping, overlapping],
      new Set(['req-1']),
      10,
    );
    expect(result.map((f) => f.id)).toEqual(['overlap', 'no-overlap']);
  });

  it('ranks a finding with a recorded roleRelevance above one without, all else equal', () => {
    const withRelevance = finding({ id: 'with-relevance', roleRelevance: 'Matters for this role' });
    const withoutRelevance = finding({ id: 'without-relevance', roleRelevance: null });
    const result = selectResumeTailoringResearchFindings(
      [withoutRelevance, withRelevance],
      new Set(),
      10,
    );
    expect(result.map((f) => f.id)).toEqual(['with-relevance', 'without-relevance']);
  });

  it('gives a soft category boost, never a hard exclusion — a BUSINESS finding can still be selected', () => {
    const boosted = finding({ id: 'boosted', category: 'TECHNOLOGY' });
    const notBoosted = finding({ id: 'not-boosted', category: 'BUSINESS' });
    const result = selectResumeTailoringResearchFindings([notBoosted, boosted], new Set(), 10);
    // Both are selected — the category boost only affects ORDER, never inclusion (§23).
    expect(result.map((f) => f.id).sort()).toEqual(['boosted', 'not-boosted']);
    expect(result[0]!.id).toBe('boosted');
  });

  it('breaks ties by original order, deterministically', () => {
    const findings = [finding({ id: 'first' }), finding({ id: 'second' }), finding({ id: 'third' })];
    const result = selectResumeTailoringResearchFindings(findings, new Set(), 10);
    expect(result.map((f) => f.id)).toEqual(['first', 'second', 'third']);
  });

  it('a CULTURE/nontechnical finding with strong requirement overlap can still outrank a TECHNOLOGY finding with none', () => {
    const nontechnical = finding({ id: 'culture', category: 'CULTURE', requirementIds: ['req-1'] });
    const technical = finding({ id: 'tech', category: 'TECHNOLOGY', requirementIds: [] });
    const result = selectResumeTailoringResearchFindings(
      [technical, nontechnical],
      new Set(['req-1']),
      10,
    );
    expect(result[0]!.id).toBe('culture');
  });
});
