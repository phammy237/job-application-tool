import {
  getJobCatalogEntryById,
  listJobrightEnrichmentCandidates,
  updateJobCatalogEnrichment,
  type CareerOsSupabaseClient,
  type JobrightEnrichmentCandidate,
} from '@career-os/database';
import { computeJobCatalogContentHash, normalizeLocationText } from '@career-os/shared';
import { errorMessage, isRecord, numberField, stringField } from './adapters/util';

/**
 * D7 §9-10 — bounded, optional enrichment of Jobright-sourced `job_catalog` rows from the public
 * Jobright detail page's `application/ld+json` `JobPosting` block (confirmed reliable via live
 * data during D7 planning — a clean structured-data block, not fragile HTML scraping). A
 * completely separate stage from README ingestion (`adapters/jobright-github.ts`): README
 * ingestion must keep working even if this stage is disabled or every fetch in it fails.
 *
 * Never reads/writes `sourceId`/`sourceJobId`/`status`/lifecycle fields — those remain owned
 * entirely by the README sync path. Never extracts a "sponsorship" signal from Jobright's own
 * aggregate commentary: the detail page's `description` embeds Jobright-authored "Company
 * Overview"/"Company H1B Sponsorship" boilerplate (with company-level historical sponsorship
 * counts — confirmed present in real data), which is truncated out before the description is ever
 * stored or reaches the shared sponsorship extractor (docs/JOB_DISCOVERY.md "Sponsorship
 * signal" — D4 eligibility logic must never be fed a company-level aggregate as if it were this
 * posting's own language).
 */

const DETAIL_FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'career-os-job-discovery/1.0 (+https://apply.mypham.space)';
const JSON_LD_SCRIPT_PATTERN = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

// Jobright's own boilerplate section headings embedded inside the JSON-LD `description` HTML —
// everything from the first of these onward is Jobright's aggregate commentary about the
// employer, never the employer's own posting language, and must never reach a user or an
// extractor as if it were.
const BOILERPLATE_HEADINGS = ['Company Overview', 'Company H1B Sponsorship'];

function toIsoOrNull(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Locates the `JobPosting` JSON-LD block among (possibly several) `<script type="application/
 * ld+json">` tags on the page and parses it. Returns null for anything malformed/missing — never
 * guesses at a partial structure. */
export function extractJobPostingJsonLd(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed) && parsed['@type'] === 'JobPosting') return parsed;
    } catch {
      continue; // one malformed script block never fails the whole page
    }
  }
  return null;
}

/** Truncates at the first Jobright-authored boilerplate heading — see this file's module doc. */
export function stripJobrightBoilerplate(description: string): string {
  let cutIndex = -1;
  for (const heading of BOILERPLATE_HEADINGS) {
    const index = description.indexOf(heading);
    if (index === -1) continue;
    // Cut from the start of the heading's own enclosing tag (e.g. `<h2>`), not mid-tag — the
    // nearest preceding `<` is that tag's opening bracket in every observed real page.
    const tagStart = description.lastIndexOf('<', index);
    const effectiveIndex = tagStart === -1 ? index : tagStart;
    if (cutIndex === -1 || effectiveIndex < cutIndex) cutIndex = effectiveIndex;
  }
  return cutIndex === -1 ? description : description.slice(0, cutIndex).trim();
}

interface JsonLdLocation {
  locationText: string | null;
  city: string | null;
  stateRegion: string | null;
  country: string | null;
}

function extractJsonLdLocation(jsonLd: Record<string, unknown>): JsonLdLocation {
  const empty: JsonLdLocation = { locationText: null, city: null, stateRegion: null, country: null };
  const jobLocation = jsonLd.jobLocation;
  const address = isRecord(jobLocation) ? jobLocation.address : null;
  if (!isRecord(address)) return empty;

  const city = stringField(address.addressLocality);
  const stateRegion = stringField(address.addressRegion);
  const country = stringField(address.addressCountry);
  const parts = [city, stateRegion, country].filter((part): part is string => Boolean(part));
  return { locationText: parts.length > 0 ? parts.join(', ') : null, city, stateRegion, country };
}

export interface JobrightEnrichmentResult {
  jobCatalogId: string;
  outcome: 'ENRICHED' | 'SKIPPED' | 'FAILED';
  reason?: string;
}

/**
 * Enriches exactly one `job_catalog` row. Failure (network, non-2xx, missing JSON-LD block) never
 * throws — it leaves the README-seeded row completely untouched and reports `FAILED`, so one
 * broken detail page never blocks the rest of a bounded enrichment run.
 */
export async function enrichJobrightJob(
  supabase: CareerOsSupabaseClient,
  candidate: JobrightEnrichmentCandidate,
  now: Date = new Date(),
): Promise<JobrightEnrichmentResult> {
  let response: Response;
  try {
    response = await fetch(candidate.applyUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DETAIL_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'FAILED', reason: `network error: ${errorMessage(error)}` };
  }
  if (!response.ok) {
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'FAILED', reason: `HTTP ${response.status}` };
  }

  const html = await response.text();
  const jsonLd = extractJobPostingJsonLd(html);
  if (!jsonLd) {
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'FAILED', reason: 'no JobPosting JSON-LD block found' };
  }

  const existing = await getJobCatalogEntryById(supabase, candidate.jobCatalogId);
  if (!existing) {
    return { jobCatalogId: candidate.jobCatalogId, outcome: 'SKIPPED', reason: 'job_catalog row no longer exists' };
  }

  const rawDescription = stringField(jsonLd.description);
  const description = rawDescription ? stripJobrightBoilerplate(rawDescription) : existing.description;
  const employmentType = stringField(jsonLd.employmentType) ?? existing.employmentType;
  const jsonLdPostedAt = stringField(jsonLd.datePosted);
  const postedAt = jsonLdPostedAt ? (toIsoOrNull(jsonLdPostedAt) ?? existing.postedAt) : existing.postedAt;

  const jsonLdLocation = extractJsonLdLocation(jsonLd);
  const locationText = jsonLdLocation.locationText ?? existing.locationText;
  const city = jsonLdLocation.city ?? existing.city;
  const stateRegion = jsonLdLocation.stateRegion ?? existing.stateRegion;
  const country = jsonLdLocation.country ?? existing.country;
  const normalizedLocation = jsonLdLocation.locationText
    ? normalizeLocationText(jsonLdLocation.locationText)
    : existing.normalizedLocation;

  let salaryMin = existing.salaryMin;
  let salaryMax = existing.salaryMax;
  let salaryCurrency = existing.salaryCurrency;
  if (isRecord(jsonLd.baseSalary)) {
    if (isRecord(jsonLd.baseSalary.value)) {
      salaryMin = numberField(jsonLd.baseSalary.value.minValue) ?? salaryMin;
      salaryMax = numberField(jsonLd.baseSalary.value.maxValue) ?? salaryMax;
    }
    salaryCurrency = stringField(jsonLd.baseSalary.currency) ?? salaryCurrency;
  }

  const contentHash = await computeJobCatalogContentHash({
    companyName: existing.companyName,
    title: existing.title,
    locationText,
    workplaceType: existing.workplaceType,
    employmentType,
    description,
    responsibilities: existing.responsibilities,
    qualifications: existing.qualifications,
    salaryMin,
    salaryMax,
    salaryCurrency,
    applyUrl: existing.applyUrl,
  });

  await updateJobCatalogEnrichment(
    supabase,
    candidate.jobCatalogId,
    {
      description,
      employmentType,
      locationText,
      normalizedLocation,
      city,
      stateRegion,
      country,
      salaryMin,
      salaryMax,
      salaryCurrency,
      postedAt,
      contentHash,
    },
    now,
  );

  return { jobCatalogId: candidate.jobCatalogId, outcome: 'ENRICHED' };
}

export interface RunJobrightEnrichmentSummary {
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: JobrightEnrichmentResult[];
}

const DEFAULT_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const DEFAULT_MAX_PER_RUN = 30;

/**
 * The bounded batch entry point (D7 §20-21's "enrichment stage" in the scheduled sync sequence,
 * and `scripts/discovery/enrich-jobright.ts`'s sole caller). One candidate's failure is isolated
 * from the rest — mirrors `runDiscoverySync`'s own per-source isolation.
 */
export async function runJobrightEnrichment(
  supabase: CareerOsSupabaseClient,
  jobrightSourceIds: string[],
  options: { staleAfterMs?: number; maxPerRun?: number; now?: Date } = {},
): Promise<RunJobrightEnrichmentSummary> {
  const now = options.now ?? new Date();
  const candidates = await listJobrightEnrichmentCandidates(supabase, jobrightSourceIds, {
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    maxCount: options.maxPerRun ?? DEFAULT_MAX_PER_RUN,
    now,
  });

  const results: JobrightEnrichmentResult[] = [];
  for (const candidate of candidates) {
    let result: JobrightEnrichmentResult;
    try {
      result = await enrichJobrightJob(supabase, candidate, now);
    } catch (error) {
      result = { jobCatalogId: candidate.jobCatalogId, outcome: 'FAILED', reason: `unexpected error: ${errorMessage(error)}` };
    }
    results.push(result);
  }

  return {
    attempted: results.length,
    succeeded: results.filter((r) => r.outcome === 'ENRICHED').length,
    skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
    failed: results.filter((r) => r.outcome === 'FAILED').length,
    results,
  };
}
