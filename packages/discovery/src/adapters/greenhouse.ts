import { decodeHtmlEntities, type RawDiscoveredJob } from '@career-os/shared';
import type { AdapterFetchResult, JobSourceAdapter, RejectedJob } from '../types';
import { errorMessage, isRecord, stringField } from './util';

/**
 * Greenhouse's public, unauthenticated job-board API (docs/JOB_DISCOVERY.md "Greenhouse"),
 * verified against https://docs.greenhouse.io/job-board.html and live responses:
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 *   -> { jobs: [...], meta: { total } }
 *
 * `source.sourceIdentifier` is the Greenhouse board token. `pay_input_ranges` (behind
 * `?pay_transparency=true`) exists per the docs but its live shape could not be confirmed
 * against a real posting that actually populates it (every board sampled returned an empty
 * array) — salary is deliberately left null rather than guessing that field's structure
 * (CLAUDE.md "never invent a fact"; docs/JOB_DISCOVERY.md "do not guess undocumented behavior").
 */
export const greenhouseAdapter: JobSourceAdapter = {
  async fetchJobs(source): Promise<AdapterFetchResult> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.sourceIdentifier)}/jobs?content=true`;

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
      const parsed = parseGreenhouseJob(raw, source.companyName);
      if (parsed) jobs.push(parsed);
      else rejected.push({ reason: 'malformed Greenhouse job (missing id/title/absolute_url)', raw });
    }

    return { status: 'SUCCESS', jobs, rejected };
  },
};

function parseGreenhouseJob(raw: unknown, companyName: string): RawDiscoveredJob | null {
  if (!isRecord(raw)) return null;

  const id = raw.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;

  const title = stringField(raw.title);
  const applyUrl = stringField(raw.absolute_url);
  if (!title || !applyUrl) return null;

  const locationText =
    isRecord(raw.location) && typeof raw.location.name === 'string' ? stringField(raw.location.name) : null;

  const description = typeof raw.content === 'string' ? decodeHtmlEntities(raw.content) : null;

  return {
    sourceJobId: String(id),
    companyName,
    title,
    locationText,
    workplaceType: null,
    employmentType: null,
    description,
    responsibilities: null,
    qualifications: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    applyUrl,
    sourceUrl: null,
    postedAt: stringField(raw.first_published),
    sourceUpdatedAt: stringField(raw.updated_at),
  };
}
