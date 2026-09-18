import type { JobCatalogWorkplaceType, RawDiscoveredJob } from '@career-os/shared';
import type { AdapterFetchResult, JobSourceAdapter, RejectedJob } from '../types';
import { parseJobrightPostedDate } from './parse-jobright-posted-date';
import { errorMessage } from './util';

/**
 * Jobright's public GitHub internship repositories (D7, docs/JOB_DISCOVERY.md "Jobright GitHub
 * source"): each repo's README holds a rolling ~7-day window of postings as a Markdown table
 * bracketed by `TABLE_START`/`TABLE_END` HTML comments. `source.sourceIdentifier` is the
 * `owner/repo` string (see `../jobright-registry.ts`).
 *
 * Fetched via the GitHub Contents API's raw-README endpoint (`raw.githubusercontent.com` is
 * unreachable from some network environments; `api.github.com` is not), which — unlike every
 * other adapter's unauthenticated ATS API — genuinely benefits from a `User-Agent`, a bounded
 * timeout/retry, and conditional requests: GitHub rate-limits unauthenticated callers to 60
 * requests/hour/IP. This is the one deliberate deviation from the other three adapters' bare
 * `fetch(url)` precedent, kept local to this file rather than promoted to a shared HTTP client
 * since no other adapter needs it yet.
 */

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'career-os-job-discovery/1.0 (+https://apply.mypham.space)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2; // one initial attempt + one bounded retry, on 5xx/network error only

const TABLE_START_MARKER = 'TABLE_START';
const TABLE_END_MARKER = 'TABLE_END';

const JOBRIGHT_JOB_ID_PATTERN = /\/jobs\/info\/([a-f0-9]{24})/i;
const BOLD_LINK_PATTERN = /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/;
const PLAIN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/;
const CONTINUATION_MARKER = '↳';

interface GithubReadmeFetchResult {
  status: 'OK' | 'NOT_MODIFIED' | 'ERROR';
  body?: string;
  etag?: string | null;
  error?: string;
}

async function fetchGithubReadme(
  repo: string,
  etag: string | null,
): Promise<GithubReadmeFetchResult> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/readme`;
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github.raw+json',
  };
  if (etag) headers['If-None-Match'] = etag;

  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

      if (response.status === 304) {
        return { status: 'NOT_MODIFIED', etag };
      }
      if (response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        continue; // bounded retry — a transient GitHub 5xx, not a real failure yet
      }
      if (!response.ok) {
        return { status: 'ERROR', error: `HTTP ${response.status}` };
      }

      const body = await response.text();
      return { status: 'OK', body, etag: response.headers.get('etag') };
    } catch (error) {
      lastError = `network error: ${errorMessage(error)}`;
    }
  }
  return { status: 'ERROR', error: `${lastError} (after ${MAX_ATTEMPTS} attempts)` };
}

/** Extracts Jobright's stable 24-hex-char job id from a detail-page URL, ignoring any
 * `?utm_campaign=...` tracking query. Returns null for anything that doesn't match — the caller
 * falls back to a conservative deterministic key rather than ever using a raw URL-with-UTM. */
export function extractJobrightJobId(url: string): string | null {
  const match = JOBRIGHT_JOB_ID_PATTERN.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

function extractMarkdownLink(cell: string): { text: string; url: string } | null {
  const bold = BOLD_LINK_PATTERN.exec(cell);
  if (bold) return { text: bold[1]!.trim(), url: bold[2]!.trim() };
  const plain = PLAIN_LINK_PATTERN.exec(cell);
  if (plain) return { text: plain[1]!.trim(), url: plain[2]!.trim() };
  return null;
}

function mapWorkModel(cell: string): JobCatalogWorkplaceType | null {
  const normalized = cell.trim().toLowerCase().replace(/[\s-]+/g, '');
  switch (normalized) {
    case 'onsite':
      return 'ONSITE';
    case 'hybrid':
      return 'HYBRID';
    case 'remote':
      return 'REMOTE';
    default:
      return null;
  }
}

function splitTableRow(line: string): string[] {
  const withoutEdges = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isHeaderRow(cells: string[]): boolean {
  return (cells[0] ?? '').trim().toLowerCase() === 'company';
}

export interface ParsedJobrightReadme {
  /** false when the TABLE_START/TABLE_END markers themselves are missing — a structural
   * "source unhealthy" signal, never conflated with "the table legitimately had 0 rows". */
  tableFound: boolean;
  jobs: RawDiscoveredJob[];
  rejected: RejectedJob[];
}

/**
 * Parses one Jobright README's Markdown table into `RawDiscoveredJob`s (D7 §5). Pure/synchronous
 * — no I/O. `referenceDate` is threaded through purely for deterministic posted-date year
 * inference (`parseJobrightPostedDate`) and defaults to "now" in production.
 */
export function parseJobrightReadme(
  markdown: string,
  referenceDate: Date = new Date(),
): ParsedJobrightReadme {
  const startIndex = markdown.indexOf(TABLE_START_MARKER);
  const endIndex = markdown.indexOf(TABLE_END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { tableFound: false, jobs: [], rejected: [] };
  }

  const tableSection = markdown.slice(startIndex, endIndex);
  const lines = tableSection.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'));

  const jobs: RawDiscoveredJob[] = [];
  const rejected: RejectedJob[] = [];
  let previousCompanyName: string | null = null;

  for (const line of lines) {
    const cells = splitTableRow(line);
    if (cells.length !== 5) {
      rejected.push({ reason: `expected 5 columns, found ${cells.length}`, raw: line });
      continue;
    }
    if (isHeaderRow(cells) || isSeparatorRow(cells)) continue;

    const [companyCell, titleCell, locationCell, workModelCell, dateCell] = cells as [
      string, string, string, string, string,
    ];

    let companyName: string;
    if (companyCell === CONTINUATION_MARKER) {
      if (!previousCompanyName) {
        rejected.push({ reason: 'continuation row (↳) with no prior company to inherit', raw: line });
        continue;
      }
      companyName = previousCompanyName;
    } else {
      const companyLink = extractMarkdownLink(companyCell);
      const candidateName = companyLink ? companyLink.text : companyCell.trim();
      if (!candidateName) {
        rejected.push({ reason: 'missing company name', raw: line });
        continue;
      }
      companyName = candidateName;
      previousCompanyName = companyName;
    }

    const titleLink = extractMarkdownLink(titleCell);
    if (!titleLink || !titleLink.text) {
      rejected.push({ reason: 'missing/malformed title link', raw: line });
      continue;
    }

    const jobUrl = titleLink.url;
    const sourceJobId =
      extractJobrightJobId(jobUrl) ??
      `fallback:${companyName.toLowerCase()}:${titleLink.text.toLowerCase()}:${locationCell.toLowerCase()}`;

    jobs.push({
      sourceJobId,
      companyName,
      title: titleLink.text,
      locationText: locationCell ? locationCell : null,
      workplaceType: mapWorkModel(workModelCell),
      // Every row in these 5 repos is, by the repo's own scope, an internship listing — the
      // README table has no per-row employment-type column to read one from. This is a factual
      // statement about the source's guaranteed scope, not an invented per-row claim.
      employmentType: 'Internship',
      description: null,
      responsibilities: null,
      qualifications: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      applyUrl: jobUrl,
      sourceUrl: jobUrl,
      postedAt: parseJobrightPostedDate(dateCell, referenceDate),
      sourceUpdatedAt: null,
    });
  }

  return { tableFound: true, jobs, rejected };
}

export const jobrightGithubAdapter: JobSourceAdapter = {
  async fetchJobs(source): Promise<AdapterFetchResult> {
    const fetchResult = await fetchGithubReadme(source.sourceIdentifier, source.etag ?? null);

    if (fetchResult.status === 'ERROR') {
      return {
        status: 'FAILURE',
        jobs: [],
        rejected: [],
        error: fetchResult.error ?? 'unknown Jobright GitHub fetch error',
      };
    }
    if (fetchResult.status === 'NOT_MODIFIED') {
      return { status: 'NOT_MODIFIED', etag: fetchResult.etag ?? null };
    }

    const parsed = parseJobrightReadme(fetchResult.body ?? '');
    if (!parsed.tableFound) {
      return {
        status: 'FAILURE',
        jobs: [],
        rejected: [],
        error:
          'TABLE_START/TABLE_END markers not found in README — source appears unhealthy (format may have changed upstream)',
      };
    }

    return { status: 'SUCCESS', jobs: parsed.jobs, rejected: parsed.rejected, etag: fetchResult.etag ?? null };
  },
};
