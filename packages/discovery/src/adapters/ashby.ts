import type { JobCatalogWorkplaceType, RawDiscoveredJob } from '@career-os/shared';
import type { AdapterFetchResult, JobSourceAdapter, RejectedJob } from '../types';
import { errorMessage, isRecord, numberField, stringField } from './util';

/**
 * Ashby's public, unauthenticated job-board API (docs/JOB_DISCOVERY.md "Ashby"):
 *   GET https://api.ashbyhq.com/posting-api/job-board/{boardName}?includeCompensation=true
 *   -> { jobs: [...], apiVersion }
 *
 * The dedicated public-reference page for this exact endpoint could not be located (Ashby's
 * `/reference/*` docs describe a different, authenticated API) — every field this adapter reads
 * was instead confirmed against real, live board responses (docs/JOB_DISCOVERY.md "do not guess
 * undocumented behavior" — confirmed via live data, not blind guessing). `source.sourceIdentifier`
 * is the Ashby job-board name. `compensation.summaryComponents` entries with
 * `compensationType: "Salary"` carry `minValue`/`maxValue`/`currencyCode`; absent for boards that
 * haven't opted in to comp transparency, left null when missing.
 */
export const ashbyAdapter: JobSourceAdapter = {
  async fetchJobs(source): Promise<AdapterFetchResult> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.sourceIdentifier)}?includeCompensation=true`;

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

    if (!isRecord(body) || !Array.isArray(body.jobs)) {
      return {
        status: 'FAILURE',
        jobs: [],
        rejected: [],
        error: 'response missing a "jobs" array — incomplete/invalid top-level response',
      };
    }

    const jobs: RawDiscoveredJob[] = [];
    const rejected: RejectedJob[] = [];
    for (const raw of body.jobs) {
      // Unlisted postings are intentionally excluded by the provider from public display — not
      // malformed data, so this is a silent skip, not a rejection.
      if (isRecord(raw) && raw.isListed === false) continue;

      const parsed = parseAshbyJob(raw, source.companyName);
      if (parsed) jobs.push(parsed);
      else rejected.push({ reason: 'malformed Ashby job (missing id/title/applyUrl)', raw });
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
    case 'onsite':
      return 'ONSITE';
    default:
      return null;
  }
}

function parseAshbyJob(raw: unknown, companyName: string): RawDiscoveredJob | null {
  if (!isRecord(raw)) return null;

  const id = stringField(raw.id);
  const title = stringField(raw.title);
  const applyUrl = stringField(raw.applyUrl);
  if (!id || !title || !applyUrl) return null;

  const locationText = stringField(raw.location);
  const employmentType = stringField(raw.employmentType);
  const description =
    stringField(raw.descriptionHtml) ?? stringField(raw.descriptionPlain) ?? null;
  const sourceUrl = stringField(raw.jobUrl);
  const postedAt = stringField(raw.publishedAt);

  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  let salaryCurrency: string | null = null;
  if (isRecord(raw.compensation) && Array.isArray(raw.compensation.summaryComponents)) {
    const salaryComponent = raw.compensation.summaryComponents.find(
      (component): component is Record<string, unknown> =>
        isRecord(component) && component.compensationType === 'Salary',
    );
    if (salaryComponent) {
      salaryMin = numberField(salaryComponent.minValue);
      salaryMax = numberField(salaryComponent.maxValue);
      salaryCurrency = stringField(salaryComponent.currencyCode);
    }
  }

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
