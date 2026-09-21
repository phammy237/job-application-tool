import { decodeHtmlEntities, normalizeCompanyNameForDedupe } from '@career-os/shared';
import { isRecord, stringField } from './adapters/util';
import { extractJobPostingJsonLd } from './jobright-enrichment';
import { readWorkdayPostingAvailability } from './workday-posting-signals';

/**
 * The single extractor for "which job is this fetched page?" — used by both the REVIEW→HIGH
 * content verification and the final HIGH confirmation. Only deterministic, standardized page
 * metadata is read (JobPosting JSON-LD, the `og:title` meta tag, the HTML `<title>`); there is no
 * DOM/CSS-selector scraping and no per-ATS parsing beyond the Workday availability flag isolated
 * in `workday-posting-signals.ts`.
 */

export type PageTitleSource = 'JSON_LD' | 'OG_TITLE' | 'HTML_TITLE';
export type PageEmployerSource = 'JSON_LD_HIRING_ORGANIZATION';

export interface PageJobIdentity {
  title: string | null;
  employer: string | null;
  titleSource: PageTitleSource | null;
  employerSource: PageEmployerSource | null;
  /** false = the page explicitly reports the posting closed; null = no signal either way. */
  postingAvailable: boolean | null;
}

// Words that carry no job identity on their own. A title made only of these (plus the company's
// own name) is a site/section title, not a job title.
const GENERIC_TITLE_WORDS = new Set([
  'careers', 'career', 'jobs', 'job', 'search', 'results', 'result', 'details', 'detail', 'home',
  'page', 'openings', 'opening', 'opportunities', 'opportunity', 'positions', 'position', 'open',
  'current', 'all', 'welcome', 'to', 'at', 'the', 'and', 'of', 'official', 'site', 'portal',
  'workday', 'find', 'your', 'next', 'join', 'us', 'our', 'team', 'apply', 'now', 'view',
]);

function titleWords(value: string): string[] {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True for site/section titles ("Careers", "Search Jobs", "Acme Careers", "Careers at Acme") and
 * for an empty title (a Workday shell's `<title></title>`). Never a real job title: a job title
 * always carries at least one word that is neither generic nor part of the company's name. */
export function isGenericPageTitle(title: string, companyName: string): boolean {
  const words = titleWords(title);
  if (words.length === 0) return true;
  const companyWords = new Set(titleWords(normalizeCompanyNameForDedupe(companyName)));
  return words.every((word) => GENERIC_TITLE_WORDS.has(word) || companyWords.has(word));
}

function metaContent(html: string, attribute: 'property' | 'name', key: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const text = tag[0];
    const keyMatch = new RegExp(`\\b${attribute}\\s*=\\s*["']${key}["']`, 'i').test(text);
    if (!keyMatch) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(text);
    const value = content?.[1] ?? content?.[2];
    if (value && value.trim()) return decodeHtmlEntities(value).trim();
  }
  return null;
}

function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const value = match?.[1] ? decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
  return value || null;
}

function jsonLdEmployer(jsonLd: Record<string, unknown>): string | null {
  const raw = jsonLd.hiringOrganization;
  if (typeof raw === 'string') return stringField(raw);
  if (isRecord(raw)) return stringField(raw.name);
  return null;
}

/** Strongest deterministic identity the page exposes. Title priority: JobPosting JSON-LD, then
 * og:title, then HTML `<title>`; a generic title at one level falls through to the next. Employer
 * comes only from JobPosting `hiringOrganization` (Workday leaves it empty, which reads as null). */
export function extractPageJobIdentity(html: string, options: { companyName: string }): PageJobIdentity {
  const jsonLd = extractJobPostingJsonLd(html);

  const candidates: { title: string | null; source: PageTitleSource }[] = [
    { title: jsonLd ? stringField(jsonLd.title) : null, source: 'JSON_LD' },
    { title: metaContent(html, 'property', 'og:title'), source: 'OG_TITLE' },
    { title: htmlTitle(html), source: 'HTML_TITLE' },
  ];
  let title: string | null = null;
  let titleSource: PageTitleSource | null = null;
  for (const candidate of candidates) {
    if (candidate.title && !isGenericPageTitle(candidate.title, options.companyName)) {
      title = decodeHtmlEntities(candidate.title).trim();
      titleSource = candidate.source;
      break;
    }
  }

  const employer = jsonLd ? jsonLdEmployer(jsonLd) : null;
  return {
    title,
    employer,
    titleSource,
    employerSource: employer ? 'JSON_LD_HIRING_ORGANIZATION' : null,
    postingAvailable: readWorkdayPostingAvailability(html),
  };
}
