import { describe, expect, it } from 'vitest';
import {
  buildCompanyResearchQueries,
  MAX_COMPANY_RESEARCH_QUERIES,
} from './build-company-research-queries';

describe('buildCompanyResearchQueries', () => {
  it('produces the five fixed template queries when there is no role topic', () => {
    const queries = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: [],
    });
    expect(queries).toHaveLength(5);
    expect(queries.every((q) => q.startsWith('Acme'))).toBe(true);
  });

  it('adds exactly one role-topic query when a topic is available', () => {
    const queries = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: ['AI-powered developer tools'],
    });
    expect(queries).toHaveLength(6);
    expect(queries.at(-1)).toBe('Acme AI-powered developer tools');
  });

  it('never exceeds the documented query cap, even with multiple topics offered', () => {
    const queries = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: ['topic one', 'topic two', 'topic three'],
    });
    expect(queries.length).toBeLessThanOrEqual(MAX_COMPANY_RESEARCH_QUERIES);
  });

  it('skips blank topic strings and falls back to the fixed templates', () => {
    const queries = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: ['   '],
    });
    expect(queries).toHaveLength(5);
  });

  it('is deterministic — same input always produces the same queries', () => {
    const a = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: ['x'],
    });
    const b = buildCompanyResearchQueries({
      companyName: 'Acme',
      topRequirementTopics: ['x'],
    });
    expect(a).toEqual(b);
  });
});
