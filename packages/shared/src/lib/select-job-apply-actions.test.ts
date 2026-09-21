import { describe, expect, it } from 'vitest';
import {
  buildOfficialPostingSearchUrl,
  selectCanonicalHandoffUrl,
  selectJobApplyActions,
} from './select-job-apply-actions';

const BASE = {
  companyName: 'Acme Corp',
  title: 'Software Engineer Intern',
  sourceUrl: 'https://jobright.ai/jobs/info/abc123',
  applyUrl: 'https://jobright.ai/jobs/info/abc123',
};

describe('selectJobApplyActions', () => {
  it('24. a resolved job (canonicalApplyUrl on an accepted ATS host) shows the employer/apply action as primary', () => {
    const actions = selectJobApplyActions({
      ...BASE,
      canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/1234',
    });
    expect(actions.primary).toEqual({
      label: 'Apply on employer site',
      url: 'https://boards.greenhouse.io/acme/jobs/1234',
    });
    expect(actions.fallbackSearchUrl).toBeNull();
  });

  it('25. an unresolved job (canonicalApplyUrl still Jobright, or null) shows Find official posting as the only actionable path', () => {
    const unresolvedStillJobright = selectJobApplyActions({
      ...BASE,
      canonicalApplyUrl: 'https://jobright.ai/jobs/info/abc123',
    });
    expect(unresolvedStillJobright.primary).toBeNull();
    expect(unresolvedStillJobright.fallbackSearchUrl).toContain('Acme%20Corp');
    expect(unresolvedStillJobright.fallbackSearchUrl).toContain('careers');

    const neverResolved = selectJobApplyActions({ ...BASE, canonicalApplyUrl: null });
    expect(neverResolved.primary).toBeNull();
    expect(neverResolved.fallbackSearchUrl).not.toBeNull();
  });

  it('26. View source remains available (the Jobright discovery provenance), whether or not the job is resolved', () => {
    const resolved = selectJobApplyActions({
      ...BASE,
      canonicalApplyUrl: 'https://jobs.lever.co/acme/xyz',
    });
    const unresolved = selectJobApplyActions({ ...BASE, canonicalApplyUrl: null });
    expect(resolved.sourceUrl).toBe('https://jobright.ai/jobs/info/abc123');
    expect(unresolved.sourceUrl).toBe('https://jobright.ai/jobs/info/abc123');
  });

  it('27. an ATS-native job (never touched by resolution) shows the exact same employer/apply action — no regression', () => {
    const atsNative = selectJobApplyActions({
      companyName: 'Acme Corp',
      title: 'Backend Engineer',
      sourceUrl: null,
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/5678',
      canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/5678',
    });
    expect(atsNative.primary).toEqual({
      label: 'Apply on employer site',
      url: 'https://boards.greenhouse.io/acme/jobs/5678',
    });
    expect(atsNative.fallbackSearchUrl).toBeNull();
    expect(atsNative.sourceUrl).toBe('https://boards.greenhouse.io/acme/jobs/5678'); // falls back to applyUrl
  });

  it('never shows a fallback search AND a primary action at the same time', () => {
    const resolved = selectJobApplyActions({
      ...BASE,
      canonicalApplyUrl: 'https://boards.greenhouse.io/acme/jobs/1234',
    });
    expect(resolved.primary).not.toBeNull();
    expect(resolved.fallbackSearchUrl).toBeNull();
  });
});

describe('selectCanonicalHandoffUrl', () => {
  it('returns null for a rejected-aggregator host (e.g. an unresolved Jobright detail URL)', () => {
    expect(selectCanonicalHandoffUrl('https://jobright.ai/jobs/info/abc123')).toBeNull();
  });

  it('returns null when there is no canonicalApplyUrl at all', () => {
    expect(selectCanonicalHandoffUrl(null)).toBeNull();
  });

  it('passes through an accepted ATS host, same as selectJobApplyActions', () => {
    expect(selectCanonicalHandoffUrl('https://boards.greenhouse.io/acme/jobs/1234')).toBe(
      'https://boards.greenhouse.io/acme/jobs/1234',
    );
  });

  it('unlike selectJobApplyActions, passes through an unlisted-but-not-rejected host (a legitimate employer domain not on the ACCEPTED_ATS allowlist, classified UNKNOWN)', () => {
    const unlistedEmployerUrl = 'https://careers.some-smaller-employer.example/jobs/42';
    expect(selectCanonicalHandoffUrl(unlistedEmployerUrl)).toBe(unlistedEmployerUrl);

    // Confirms this really is a deliberate divergence, not an oversight: the same UNKNOWN-host
    // URL does NOT qualify as selectJobApplyActions' primary action (no EMPLOYER_DOMAIN hint is
    // ever passed anywhere in this codebase today, so this URL classifies UNKNOWN, not
    // EMPLOYER_DOMAIN) — the Discover UI falls back to search instead.
    const actions = selectJobApplyActions({
      companyName: 'Some Smaller Employer',
      title: 'Engineer',
      sourceUrl: null,
      applyUrl: unlistedEmployerUrl,
      canonicalApplyUrl: unlistedEmployerUrl,
    });
    expect(actions.primary).toBeNull();
    expect(actions.fallbackSearchUrl).not.toBeNull();
  });
});

describe('buildOfficialPostingSearchUrl', () => {
  it('builds a Google search URL containing only the company, exact title, and "careers"', () => {
    const url = buildOfficialPostingSearchUrl('Databricks', 'Product Management Intern (Summer 2027)');
    expect(url).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    const decoded = decodeURIComponent(url.split('q=')[1]!);
    expect(decoded).toBe('"Databricks" "Product Management Intern (Summer 2027)" careers');
  });
});
