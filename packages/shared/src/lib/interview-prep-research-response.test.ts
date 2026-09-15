import { describe, expect, it } from 'vitest';
import {
  computeInterviewPrepResearchSummary,
  resolveInterviewPrepItemsCompanyRelevance,
  type ResearchFindingContext,
} from './interview-prep-research-response';

const FINDING_1: ResearchFindingContext = {
  claim: 'Acme is expanding its Snowflake-based analytics platform.',
  roleRelevance: 'Directly relevant to a data-platform role.',
  category: 'TECHNOLOGY',
};

describe('resolveInterviewPrepItemsCompanyRelevance', () => {
  it('resolves a valid researchFindingIds entry into companyRelevance', () => {
    const items = [{ theme: 'x', researchFindingIds: ['finding-1'] }];
    const resolved = resolveInterviewPrepItemsCompanyRelevance(
      items,
      new Map([['finding-1', FINDING_1]]),
    );
    expect(resolved).toEqual([{ theme: 'x', companyRelevance: [{ id: 'finding-1', ...FINDING_1 }] }]);
  });

  it('drops (never fabricates) an id with no resolvable context', () => {
    const items = [{ theme: 'x', researchFindingIds: ['unresolvable'] }];
    const resolved = resolveInterviewPrepItemsCompanyRelevance(items, new Map());
    expect(resolved).toEqual([{ theme: 'x', companyRelevance: [] }]);
  });

  it('returns an empty companyRelevance array for an item with no research citations', () => {
    const items = [{ theme: 'x', researchFindingIds: [] }];
    const resolved = resolveInterviewPrepItemsCompanyRelevance(items, new Map());
    expect(resolved).toEqual([{ theme: 'x', companyRelevance: [] }]);
  });

  it('strips researchFindingIds from the resolved item — never leaks raw ids downstream', () => {
    const items = [{ theme: 'x', researchFindingIds: ['finding-1'] }];
    const resolved = resolveInterviewPrepItemsCompanyRelevance(
      items,
      new Map([['finding-1', FINDING_1]]),
    );
    expect(resolved[0]).not.toHaveProperty('researchFindingIds');
  });
});

describe('computeInterviewPrepResearchSummary', () => {
  it('returns zero counts when nothing cites research', () => {
    expect(computeInterviewPrepResearchSummary([[], [], []])).toEqual({
      researchFindingsReferenced: 0,
      itemsInfluencedByResearch: 0,
    });
  });

  it('counts distinct findings referenced across sections', () => {
    const result = computeInterviewPrepResearchSummary([
      ['f-1', 'f-2'],
      [],
      ['f-2'],
    ]);
    expect(result.researchFindingsReferenced).toBe(2);
    expect(result.itemsInfluencedByResearch).toBe(2);
  });

  it('counts every item with a non-empty researchFindingIds, even citing the same finding', () => {
    const result = computeInterviewPrepResearchSummary([['f-1'], ['f-1'], ['f-1']]);
    expect(result.researchFindingsReferenced).toBe(1);
    expect(result.itemsInfluencedByResearch).toBe(3);
  });
});
