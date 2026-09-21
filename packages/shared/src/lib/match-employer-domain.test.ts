import { describe, expect, it } from 'vitest';
import { matchesEmployerDomain } from './match-employer-domain';

describe('matchesEmployerDomain', () => {
  it('matches a single-word company name against its own root domain', () => {
    expect(matchesEmployerDomain('Cisco', 'https://careers.cisco.com/jobs/1234')).toBe(true);
  });

  it('matches a short ticker-style company name (RTX) against its own root domain', () => {
    expect(matchesEmployerDomain('RTX', 'https://careers.rtx.com/job/1234')).toBe(true);
  });

  it('matches Manulife against its own root domain', () => {
    expect(matchesEmployerDomain('Manulife', 'https://careers.manulife.com/us/en/job/1234')).toBe(true);
  });

  it('matches via the first-word rule when the legal name has extra words/suffixes', () => {
    expect(matchesEmployerDomain('Cisco Systems, Inc.', 'https://jobs.cisco.com/job/1234')).toBe(true);
  });

  it('matches via the concatenated-slug rule for a genuine two-word brand domain', () => {
    expect(matchesEmployerDomain('Support Finity', 'https://careers.supportfinity.com/job/1')).toBe(true);
  });

  it('does NOT match a short/generic company name against an unrelated longer domain that merely shares a prefix', () => {
    // The exact false-positive risk this function must resist: "Support" must never match
    // "supportfinity.com" (a real third-party mirror domain observed live) — equality, not
    // containment.
    expect(matchesEmployerDomain('Support', 'https://supportfinity.com/job/1')).toBe(false);
  });

  it('does not match an aggregator/mirror domain unrelated to the company name', () => {
    expect(matchesEmployerDomain('Cisco', 'https://bebee.com/job/some-cisco-repost')).toBe(false);
    expect(matchesEmployerDomain('Cisco', 'https://www.prosple.com/graduate-employers/cisco/jobs/1')).toBe(false);
  });

  it('does not match a university career-services mirror unrelated to the company name', () => {
    expect(matchesEmployerDomain('Cisco', 'https://careerservices.stjohns.edu/jobs/1')).toBe(false);
  });

  it('does not match a professional-body job board reposting an unrelated employer', () => {
    expect(matchesEmployerDomain('Cisco', 'https://jobs.accaglobal.com/job/1')).toBe(false);
  });

  it('rejects a too-short root label even if it happens to equal a short company slug, below the minimum length guard', () => {
    expect(matchesEmployerDomain('Co', 'https://careers.co.example/job/1')).toBe(false);
  });

  it('returns false for a malformed URL rather than throwing', () => {
    expect(matchesEmployerDomain('Cisco', 'not a url')).toBe(false);
  });
});
