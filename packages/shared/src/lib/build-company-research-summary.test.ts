import { describe, expect, it } from 'vitest';
import type {
  CompanyResearchFinding,
  CompanyResearchFindingCategory,
} from '../schemas/company-research';
import { buildCompanyResearchSummary } from './build-company-research-summary';

const SOURCE = {
  id: '11111111-1111-1111-1111-111111111111',
  url: 'https://acme.com/news',
  canonicalUrl: null,
  title: 'Acme News',
  publisher: 'Acme',
  sourceType: 'OFFICIAL_NEWSROOM' as const,
  publishedAt: null,
  retrievedAt: '2026-09-15T00:00:00.000Z',
  evidenceExcerpt: null,
  contentHash: null,
};

function finding(
  category: CompanyResearchFindingCategory,
  claim: string,
): CompanyResearchFinding {
  return {
    id: crypto.randomUUID(),
    category,
    claim,
    roleRelevance: null,
    requirementIds: [],
    sources: [SOURCE],
  };
}

describe('buildCompanyResearchSummary', () => {
  it('returns an empty string for no findings', () => {
    expect(buildCompanyResearchSummary([])).toBe('');
  });

  it('picks one finding per category in priority order, never inventing text', () => {
    const findings = [
      finding('CULTURE', 'Culture claim.'),
      finding('PRODUCT', 'Product claim.'),
      finding('STRATEGY', 'Strategy claim.'),
    ];
    const summary = buildCompanyResearchSummary(findings);
    expect(summary).toBe('Product claim. Strategy claim. Culture claim.');
  });

  it('caps the number of findings folded into the summary', () => {
    const findings = [
      finding('PRODUCT', 'Product claim.'),
      finding('STRATEGY', 'Strategy claim.'),
      finding('RECENT_DEVELOPMENT', 'Recent claim.'),
      finding('TECHNOLOGY', 'Tech claim.'),
    ];
    const summary = buildCompanyResearchSummary(findings);
    expect(summary.split('. ').length).toBeLessThanOrEqual(3);
  });

  it('only ever uses text taken verbatim from a finding claim', () => {
    const findings = [finding('PRODUCT', 'A very specific claim nobody else wrote.')];
    const summary = buildCompanyResearchSummary(findings);
    expect(summary).toContain('A very specific claim nobody else wrote.');
  });

  it('takes the first finding within a category when multiple share one', () => {
    const findings = [
      finding('PRODUCT', 'First product claim.'),
      finding('PRODUCT', 'Second product claim.'),
    ];
    expect(buildCompanyResearchSummary(findings)).toBe('First product claim.');
  });
});
