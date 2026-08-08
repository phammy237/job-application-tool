import { jobExtractionPayloadSchema, type JobExtractionPayload } from '@career-os/shared';
import type { JobPageAdapter } from './adapter';

interface JsonLdJobPosting {
  title?: string;
  description?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string } | string;
  jobLocation?:
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }[];
  skills?: string | string[];
  qualifications?: string | string[];
  responsibilities?: string | string[];
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * schema.org JobPosting structured data — the most reliable source when present, since it's
 * meant to be machine-read (originally for search engines) rather than inferred from layout.
 */
function findJsonLdJobPosting(document: Document): JsonLdJobPosting | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const type = (candidate as { '@type'?: unknown })?.['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.includes('JobPosting')) {
        return candidate as JsonLdJobPosting;
      }
    }
  }
  return null;
}

function jsonLdLocationToString(jobLocation: JsonLdJobPosting['jobLocation']): string | null {
  if (!jobLocation) return null;
  const first = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = first?.address;
  if (!address) return null;
  return (
    [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter(Boolean)
      .join(', ') || null
  );
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getMetaContent(document: Document, name: string): string | null {
  const el =
    document.querySelector(`meta[property="${name}"]`) ??
    document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute('content')?.trim() || null;
}

const SECTION_KEYWORDS: Record<'responsibilities' | 'qualifications' | 'preferredQualifications' | 'skills', RegExp> = {
  responsibilities: /responsibilit|what you.?ll do|the role|duties/i,
  qualifications: /qualification|requirement|what you.?ll need|who you are/i,
  preferredQualifications: /preferred|nice to have|bonus/i,
  skills: /^skills\b/i,
};

/**
 * Finds heading-like elements (h1-h4, or bold/strong short lines used as pseudo-headings on
 * sites without real heading markup) whose text matches one of SECTION_KEYWORDS, then collects
 * the <li> items (or, absent a list, sibling text) that follow it, stopping at the next
 * heading-like element.
 */
function extractSections(document: Document): Record<keyof typeof SECTION_KEYWORDS, string[]> {
  const result: Record<keyof typeof SECTION_KEYWORDS, string[]> = {
    responsibilities: [],
    qualifications: [],
    preferredQualifications: [],
    skills: [],
  };

  const headingLike = document.querySelectorAll('h1, h2, h3, h4, h5, strong, b');
  for (const heading of headingLike) {
    const text = heading.textContent?.trim() ?? '';
    if (!text || text.length > 80) continue;

    const matchedKey = (Object.keys(SECTION_KEYWORDS) as (keyof typeof SECTION_KEYWORDS)[]).find(
      (key) => SECTION_KEYWORDS[key].test(text),
    );
    if (!matchedKey) continue;

    const items = collectFollowingListItems(heading);
    if (items.length > 0) {
      result[matchedKey].push(...items);
    }
  }

  return result;
}

function collectFollowingListItems(heading: Element): string[] {
  const items: string[] = [];
  // Walk forward through subsequent DOM siblings (and the heading's parent's siblings, one
  // level up, to handle headings wrapped in their own container) looking for the next list.
  let node: Element | null = heading;
  let hops = 0;
  while (node && hops < 6) {
    const list = node.nextElementSibling?.matches('ul, ol')
      ? node.nextElementSibling
      : (node.nextElementSibling?.querySelector('ul, ol') ?? null);
    if (list) {
      for (const li of list.querySelectorAll('li')) {
        const text = li.textContent?.trim();
        if (text) items.push(text);
      }
      break;
    }
    node = node.nextElementSibling;
    hops += 1;
  }
  return items;
}

/**
 * Guaranteed fallback adapter (docs/EXTENSION_DESIGN.md §5) — always matches, must produce a
 * best-effort result on arbitrary job pages using, in priority order: JobPosting JSON-LD,
 * <meta> tags, heading heuristics, and section/list detection for responsibilities and
 * qualifications.
 */
export const GenericHtmlAdapter: JobPageAdapter = {
  name: 'GenericHtmlAdapter',

  matches(): boolean {
    return true;
  },

  extract(document: Document): JobExtractionPayload {
    const jsonLd = findJsonLdJobPosting(document);
    const sections = extractSections(document);

    const title =
      jsonLd?.title?.trim() ||
      getMetaContent(document, 'og:title') ||
      document.querySelector('h1')?.textContent?.trim() ||
      null;

    const company =
      (typeof jsonLd?.hiringOrganization === 'object'
        ? jsonLd.hiringOrganization?.name
        : jsonLd?.hiringOrganization) ||
      getMetaContent(document, 'og:site_name') ||
      null;

    const location = jsonLdLocationToString(jsonLd?.jobLocation) ?? null;

    const employmentTypeRaw = Array.isArray(jsonLd?.employmentType)
      ? jsonLd.employmentType[0]
      : jsonLd?.employmentType;
    const employmentType = employmentTypeRaw ?? null;

    const description =
      (jsonLd?.description ? stripHtml(jsonLd.description) : null) ||
      getMetaContent(document, 'og:description') ||
      null;

    const payload = {
      company: company?.trim() || null,
      title: title?.trim() || null,
      location,
      employmentType,
      description,
      responsibilities: dedupe([
        ...toStringArray(jsonLd?.responsibilities),
        ...sections.responsibilities,
      ]),
      qualifications: dedupe([
        ...toStringArray(jsonLd?.qualifications),
        ...sections.qualifications,
      ]),
      preferredQualifications: dedupe(sections.preferredQualifications),
      skills: dedupe([...toStringArray(jsonLd?.skills), ...sections.skills]),
      sourceUrl: document.location?.href || null,
      platformType: 'GENERIC' as const,
      rawExtraction: jsonLd ? { jsonLd } : null,
    };

    return jobExtractionPayloadSchema.parse(payload);
  },
};

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
