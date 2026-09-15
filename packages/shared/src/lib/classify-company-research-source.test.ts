import { describe, expect, it } from 'vitest';
import {
  classifyCompanyResearchSourceType,
  determinePrimaryCompanyDomain,
  extractRegistrableDomain,
} from './classify-company-research-source';

describe('extractRegistrableDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(extractRegistrableDomain('https://WWW.Example.com/path')).toBe('example.com');
  });
  it('returns null for an unparseable URL', () => {
    expect(extractRegistrableDomain('not a url')).toBeNull();
  });
});

describe('determinePrimaryCompanyDomain', () => {
  it('picks the most frequently-occurring non-excluded domain', () => {
    const urls = [
      'https://acme.com/about',
      'https://acme.com/products',
      'https://acme.com/newsroom',
      'https://reuters.com/article-about-acme',
    ];
    expect(determinePrimaryCompanyDomain(urls)).toBe('acme.com');
  });

  it('returns null when nothing repeats — never guesses from a single occurrence', () => {
    const urls = [
      'https://acme.com/about',
      'https://reuters.com/x',
      'https://techcrunch.com/y',
    ];
    expect(determinePrimaryCompanyDomain(urls)).toBeNull();
  });

  it('excludes job-board and reputable-news domains from consideration', () => {
    const urls = [
      'https://boards.greenhouse.io/acme/jobs/1',
      'https://boards.greenhouse.io/acme/jobs/2',
      'https://boards.greenhouse.io/acme/jobs/3',
      'https://acme.com/about',
      'https://acme.com/products',
    ];
    expect(determinePrimaryCompanyDomain(urls)).toBe('acme.com');
  });
});

describe('classifyCompanyResearchSourceType', () => {
  const PRIMARY = 'acme.com';

  it('classifies a job-board URL as OTHER regardless of domain match', () => {
    expect(
      classifyCompanyResearchSourceType(
        'https://boards.greenhouse.io/acme/jobs/1',
        PRIMARY,
      ),
    ).toBe('OTHER');
    expect(
      classifyCompanyResearchSourceType('https://www.linkedin.com/jobs/view/1', PRIMARY),
    ).toBe('OTHER');
  });

  it('classifies an allowlisted reputable-news domain as REPUTABLE_NEWS', () => {
    expect(
      classifyCompanyResearchSourceType(
        'https://www.reuters.com/technology/acme-x',
        PRIMARY,
      ),
    ).toBe('REPUTABLE_NEWS');
  });

  it('classifies an investor-relations URL regardless of primary-domain match', () => {
    expect(
      classifyCompanyResearchSourceType('https://ir.acme.com/press-releases', null),
    ).toBe('INVESTOR_RELATIONS');
    expect(
      classifyCompanyResearchSourceType('https://acme.com/investor-relations', null),
    ).toBe('INVESTOR_RELATIONS');
  });

  it('classifies engineering/newsroom/careers/blog paths only when the domain matches the known primary domain', () => {
    expect(
      classifyCompanyResearchSourceType('https://engineering.acme.com/post-1', PRIMARY),
    ).toBe('ENGINEERING_BLOG');
    expect(
      classifyCompanyResearchSourceType(
        'https://acme.com/newsroom/announcement',
        PRIMARY,
      ),
    ).toBe('OFFICIAL_NEWSROOM');
    expect(
      classifyCompanyResearchSourceType(
        'https://acme.com/careers/product-manager',
        PRIMARY,
      ),
    ).toBe('CAREERS');
    expect(
      classifyCompanyResearchSourceType('https://acme.com/blog/post-1', PRIMARY),
    ).toBe('PRODUCT_BLOG');
  });

  it('falls back to OFFICIAL_WEBSITE for the primary domain with no other signal', () => {
    expect(classifyCompanyResearchSourceType('https://acme.com/about', PRIMARY)).toBe(
      'OFFICIAL_WEBSITE',
    );
  });

  it('classifies an unrelated, non-allowlisted domain as OTHER — never guesses', () => {
    expect(
      classifyCompanyResearchSourceType('https://some-random-blog.example/post', PRIMARY),
    ).toBe('OTHER');
  });

  it('never treats a careers-shaped path on an unrelated domain as CAREERS', () => {
    // A different company's careers page (or a random site with "/careers" in the path) must not
    // be classified as this company's own careers page just because the path shape matches.
    expect(
      classifyCompanyResearchSourceType('https://other-company.example/careers', PRIMARY),
    ).toBe('OTHER');
  });

  it('returns OTHER for an unparseable URL rather than throwing', () => {
    expect(classifyCompanyResearchSourceType('not a url', PRIMARY)).toBe('OTHER');
  });
});
