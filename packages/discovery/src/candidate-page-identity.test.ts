import { describe, expect, it } from 'vitest';
import { extractPageJobIdentity, isGenericPageTitle } from './candidate-page-identity';

const jsonLd = (data: Record<string, unknown>) =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', ...data })}</script>`;

describe('isGenericPageTitle', () => {
  it.each([
    'Careers',
    'Jobs',
    'Search Jobs',
    'Job Search',
    'Current Openings',
    'Careers | Home',
    '',
    '   ',
    'QTS Data Centers',
    'QTS Data Centers Careers',
    'Careers at QTS Data Centers',
    'Jobs - QTS Data Centers',
    'Workday',
  ])('"%s" is generic for QTS Data Centers', (title) => {
    expect(isGenericPageTitle(title, 'QTS Data Centers')).toBe(true);
  });

  it.each([
    'Process Analytics Intern',
    'Careers Intern',
    'Summer 2027 Internship: Process Analytics - Technology Delivery Team',
    'IT Analyst Intern- Minnesota Job Details | Boston Scientific',
    'Data Center Technician',
  ])('"%s" is a real job title for QTS Data Centers', (title) => {
    expect(isGenericPageTitle(title, 'QTS Data Centers')).toBe(false);
  });
});

describe('extractPageJobIdentity', () => {
  const opts = { companyName: 'Acme' };

  it('prefers JSON-LD title, then og:title, then <title>', () => {
    const html = `<html><head><title>Html Title Role</title><meta property="og:title" content="Og Title Role">${jsonLd({ title: 'Json Ld Role' })}</head></html>`;
    expect(extractPageJobIdentity(html, opts)).toMatchObject({ title: 'Json Ld Role', titleSource: 'JSON_LD' });
    expect(extractPageJobIdentity(html.replace(/<script[\s\S]*?<\/script>/, ''), opts)).toMatchObject({
      title: 'Og Title Role',
      titleSource: 'OG_TITLE',
    });
    expect(
      extractPageJobIdentity('<html><head><title>Html Title Role</title></head></html>', opts),
    ).toMatchObject({ title: 'Html Title Role', titleSource: 'HTML_TITLE' });
  });

  it('reads og:title regardless of attribute order and quote style, and decodes entities', () => {
    expect(
      extractPageJobIdentity(`<meta content='R&amp;D Intern' property='og:title'>`, opts).title,
    ).toBe('R&D Intern');
  });

  it('a generic title at one level falls through to the next level', () => {
    const html = `<html><head><title>Data Analyst Intern</title><meta property="og:title" content="Careers"></head></html>`;
    expect(extractPageJobIdentity(html, opts)).toMatchObject({ title: 'Data Analyst Intern', titleSource: 'HTML_TITLE' });
  });

  it('returns no title when every source is generic or empty (Workday shell shape)', () => {
    const shell = `<html><head><title></title><meta name="title" property="og:title"></head></html>`;
    expect(extractPageJobIdentity(shell, opts)).toMatchObject({ title: null, titleSource: null });
  });

  it('extracts the employer only from JobPosting hiringOrganization (string or object); empty name is null', () => {
    const withObject = extractPageJobIdentity(`<head>${jsonLd({ title: 'X Intern', hiringOrganization: { name: 'Acme' } })}</head>`, opts);
    expect(withObject).toMatchObject({ employer: 'Acme', employerSource: 'JSON_LD_HIRING_ORGANIZATION' });
    const withString = extractPageJobIdentity(`<head>${jsonLd({ title: 'X Intern', hiringOrganization: 'Acme' })}</head>`, opts);
    expect(withString.employer).toBe('Acme');
    const empty = extractPageJobIdentity(`<head>${jsonLd({ title: 'X Intern', hiringOrganization: { name: '' } })}</head>`, opts);
    expect(empty).toMatchObject({ employer: null, employerSource: null });
  });

  it('reports the Workday availability flag and null when there is no Workday bootstrap', () => {
    const closed = 'window.workday = window.workday || { postingAvailable: false };';
    const live = 'window.workday = window.workday || { postingAvailable: true };';
    expect(extractPageJobIdentity(`<script>${closed}</script>`, opts).postingAvailable).toBe(false);
    expect(extractPageJobIdentity(`<script>${live}</script>`, opts).postingAvailable).toBe(true);
    expect(extractPageJobIdentity('<html></html>', opts).postingAvailable).toBeNull();
  });

  it('never throws on malformed markup', () => {
    expect(() => extractPageJobIdentity('<script type="application/ld+json">{oops', opts)).not.toThrow();
    expect(extractPageJobIdentity('', opts)).toMatchObject({ title: null, employer: null, postingAvailable: null });
  });
});
