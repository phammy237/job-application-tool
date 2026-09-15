import { describe, expect, it } from 'vitest';
import type { CompanyResearchSourceType } from '../schemas/company-research';
import { selectCompanyResearchSources } from './select-company-research-sources';

describe('selectCompanyResearchSources', () => {
  it('dedupes URLs that differ only by tracking params/fragment/trailing slash', () => {
    const result = selectCompanyResearchSources([
      { url: 'https://acme.com/news?utm_source=x', sourceType: 'OFFICIAL_NEWSROOM' },
      { url: 'https://acme.com/news', sourceType: 'OFFICIAL_NEWSROOM' },
      { url: 'https://acme.com/news/', sourceType: 'OFFICIAL_NEWSROOM' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('does not collapse two genuinely different pages', () => {
    const result = selectCompanyResearchSources([
      { url: 'https://acme.com/news/1', sourceType: 'OFFICIAL_NEWSROOM' },
      { url: 'https://acme.com/news/2', sourceType: 'OFFICIAL_NEWSROOM' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('ranks by source-type priority, never by input order alone', () => {
    const result = selectCompanyResearchSources([
      { url: 'https://a.example/1', sourceType: 'OTHER' },
      { url: 'https://b.example/2', sourceType: 'OFFICIAL_WEBSITE' },
      { url: 'https://c.example/3', sourceType: 'REPUTABLE_NEWS' },
    ]);
    expect(result.map((r) => r.sourceType)).toEqual([
      'OFFICIAL_WEBSITE',
      'REPUTABLE_NEWS',
      'OTHER',
    ]);
  });

  it('preserves original relative order within the same priority tier (stable sort)', () => {
    const result = selectCompanyResearchSources([
      { url: 'https://a.example/1', sourceType: 'REPUTABLE_NEWS' },
      { url: 'https://b.example/2', sourceType: 'REPUTABLE_NEWS' },
    ]);
    expect(result.map((r) => r.url)).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ]);
  });

  it('bounds the total number of selected sources', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      url: `https://site${i}.example/page`,
      sourceType: 'OTHER' as const,
    }));
    const result = selectCompanyResearchSources(candidates, { maxSources: 12 });
    expect(result).toHaveLength(12);
  });

  it('caps how many sources come from the same domain — prefers diversity over ten copies of one press release', () => {
    const candidates: { url: string; sourceType: CompanyResearchSourceType }[] =
      Array.from({ length: 10 }, (_, i) => ({
        url: `https://syndicate.example/press-release-${i}`,
        sourceType: 'REPUTABLE_NEWS',
      }));
    candidates.push({ url: 'https://acme.com/press', sourceType: 'OFFICIAL_NEWSROOM' });
    const result = selectCompanyResearchSources(candidates, {
      maxSources: 12,
      maxPerDomain: 3,
    });
    const syndicateCount = result.filter((r) =>
      r.url.includes('syndicate.example'),
    ).length;
    expect(syndicateCount).toBeLessThanOrEqual(3);
    expect(result.some((r) => r.url === 'https://acme.com/press')).toBe(true);
  });

  it('returns an empty array for an empty input', () => {
    expect(selectCompanyResearchSources([])).toEqual([]);
  });
});
