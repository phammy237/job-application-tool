import {
  canonicalizeUrl,
  classifyJobPostingHost,
  computeJobCatalogContentHash,
  computeJobCatalogDedupeFingerprint,
  normalizeJobTitle,
  normalizeLocationText,
  parseLocation,
  type NormalizedDiscoveredJob,
  type RawDiscoveredJob,
} from '@career-os/shared';

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The one normalization step every adapter's output passes through before reaching the database
 * write layer (docs/JOB_DISCOVERY.md "Normalization" + "Content hash") — deterministic, no AI.
 * A malformed/unparseable date string degrades to null rather than being guessed or thrown.
 */
export async function normalizeDiscoveredJob(
  raw: RawDiscoveredJob,
): Promise<NormalizedDiscoveredJob> {
  const locationText = raw.locationText;
  const normalizedLocation = locationText ? normalizeLocationText(locationText) : null;
  const parsedLocation = locationText
    ? parseLocation(locationText)
    : { city: null, stateRegion: null, country: null };

  // Bug fix (post-D7.1): a raw applyUrl is only ever a real apply destination when its own host
  // isn't a known aggregator/discovery site -- true for every ATS adapter's applyUrl, but never
  // true for JOBRIGHT_GITHUB, whose applyUrl is always Jobright's own detail page
  // (jobright.ai/jobs/info/<id>). Deciding this by host classification, not by source type,
  // reuses the exact same REJECTED_AGGREGATOR list selectJobApplyActions and the official-posting
  // validator already key off (classify-job-posting-host.ts's own doc comment), so this can never
  // disagree with either of them about what counts as a real apply destination. canonical_apply_url
  // instead stays null (matching migration 0039's invariant: "NULL until HIGH-confidence employer
  // resolution") until official-posting-resolution.ts fills it in.
  const canonicalizedApplyUrl = canonicalizeUrl(raw.applyUrl);
  const canonicalApplyUrl =
    canonicalizedApplyUrl && classifyJobPostingHost(canonicalizedApplyUrl) === 'REJECTED_AGGREGATOR'
      ? null
      : canonicalizedApplyUrl;
  const normalizedTitle = normalizeJobTitle(raw.title);

  const workplaceType = raw.workplaceType ?? null;
  const employmentType = raw.employmentType ?? null;
  const description = raw.description ?? null;
  const responsibilities = raw.responsibilities ?? null;
  const qualifications = raw.qualifications ?? null;
  const salaryMin = raw.salaryMin ?? null;
  const salaryMax = raw.salaryMax ?? null;
  const salaryCurrency = raw.salaryCurrency ?? null;

  const contentHash = await computeJobCatalogContentHash({
    companyName: raw.companyName,
    title: raw.title,
    locationText,
    workplaceType,
    employmentType,
    description,
    responsibilities,
    qualifications,
    salaryMin,
    salaryMax,
    salaryCurrency,
    applyUrl: raw.applyUrl,
  });

  const dedupeFingerprint = computeJobCatalogDedupeFingerprint({
    companyName: raw.companyName,
    title: raw.title,
    locationText,
    canonicalApplyUrl,
  });

  return {
    sourceJobId: raw.sourceJobId,
    companyName: raw.companyName,
    title: raw.title,
    normalizedTitle,
    locationText,
    normalizedLocation,
    city: parsedLocation.city,
    stateRegion: parsedLocation.stateRegion,
    country: parsedLocation.country,
    workplaceType,
    employmentType,
    description,
    responsibilities,
    qualifications,
    salaryMin,
    salaryMax,
    salaryCurrency,
    applyUrl: raw.applyUrl,
    sourceUrl: raw.sourceUrl ?? null,
    canonicalApplyUrl,
    dedupeFingerprint,
    postedAt: toIsoOrNull(raw.postedAt),
    sourceUpdatedAt: toIsoOrNull(raw.sourceUpdatedAt),
    contentHash,
  };
}
