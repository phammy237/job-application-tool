import type { JobCatalogWorkplaceType, RawDiscoveredJob } from '@career-os/shared';
import type { AdapterFetchResult, JobSourceAdapter, RejectedJob } from '../types';
import { errorMessage, isRecord, numberField, stringField } from './util';

/**
 * Lever's public, unauthenticated postings API (docs/JOB_DISCOVERY.md "Lever"), verified against
 * https://github.com/lever/postings-api and live responses:
 *   GET https://api.lever.co/v0/postings/{site}?mode=json
 *   -> a bare JSON array of postings (no envelope object).
 *
 * `source.sourceIdentifier` is the Lever site/company slug. `workplaceType` values per the docs
 * are `unspecified | on-site | remote | hybrid`; `salaryRange` (`{min, max, currency, interval}`)
 * is optional and, per the docs, present only when the poster opted in to compensation
 * transparency — absent for most boards sampled live, left null when missing (never guessed).
 * Lever posting objects carry no company-name field of their own, so `companyName` always comes
 * from the configured `job_sources` row, not the provider payload.
 */
export const leverAdapter: JobSourceAdapter = {
  async fetchJobs(source): Promise<AdapterFetchResult> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(source.sourceIdentifier)}?mode=json`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      return { status: 'FAILURE', jobs: [], rejected: [], error: `network error: ${errorMessage(error)}` };
    }

    if (!response.ok) {
      return { status: 'FAILURE', jobs: [], rejected: [], error: `HTTP ${response.status}` };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return { status: 'FAILURE', jobs: [], rejected: [], error: `invalid JSON body: ${errorMessage(error)}` };
    }

    if (!Array.isArray(body)) {
      return {
        status: 'FAILURE',
        jobs: [],
        rejected: [],
        error: 'response is not a JSON array — incomplete/invalid top-level response',
      };
    }

    const jobs: RawDiscoveredJob[] = [];
    const rejected: RejectedJob[] = [];
    for (const raw of body) {
      const parsed = parseLeverJob(raw, source.companyName);
      if (parsed) jobs.push(parsed);
      else rejected.push({ reason: 'malformed Lever posting (missing id/text/applyUrl)', raw });
    }

    return { status: 'SUCCESS', jobs, rejected };
  },
};

function mapWorkplaceType(value: unknown): JobCatalogWorkplaceType | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'remote':
      return 'REMOTE';
    case 'hybrid':
      return 'HYBRID';
    case 'on-site':
      return 'ONSITE';
    default:
      return null;
  }
}

function parseLeverJob(raw: unknown, companyName: string): RawDiscoveredJob | null {
  if (!isRecord(raw)) return null;

  const id = stringField(raw.id);
  const title = stringField(raw.text);
  const applyUrl = stringField(raw.applyUrl);
  if (!id || !title || !applyUrl) return null;

  const categories = isRecord(raw.categories) ? raw.categories : {};
  const locationText = stringField(categories.location);
  const employmentType = stringField(categories.commitment);
  const description = typeof raw.description === 'string' ? raw.description : null;
  const sourceUrl = stringField(raw.hostedUrl);

  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  let salaryCurrency: string | null = null;
  if (isRecord(raw.salaryRange)) {
    salaryMin = numberField(raw.salaryRange.min);
    salaryMax = numberField(raw.salaryRange.max);
    salaryCurrency = stringField(raw.salaryRange.currency);
  }

  const postedAt =
    typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : null;

  return {
    sourceJobId: id,
    companyName,
    title,
    locationText,
    workplaceType: mapWorkplaceType(raw.workplaceType),
    employmentType,
    description,
    responsibilities: null,
    qualifications: null,
    salaryMin,
    salaryMax,
    salaryCurrency,
    applyUrl,
    sourceUrl,
    postedAt,
    sourceUpdatedAt: null,
  };
}
