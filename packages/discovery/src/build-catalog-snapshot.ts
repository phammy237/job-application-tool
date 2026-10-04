import {
  computeJobSnapshotFingerprint,
  discoveryHandoffEventMetadataSchema,
  sanitizeJobSnapshotInput,
  selectCanonicalHandoffUrl,
  type DiscoveryHandoffEventMetadata,
  type JobCatalogEntry,
  type JobCatalogFeatures,
  type JobSnapshotSanitizableInput,
  type JobSource,
  type SanitizedJobSnapshotContent,
  type UserJobMatchScore,
} from '@career-os/shared';

export interface BuildCatalogJobHandoffPayloadInput {
  job: JobCatalogEntry;
  features: JobCatalogFeatures | null;
  jobSource: JobSource | null;
  /** Null when the job hasn't been scored for this caller yet — never fabricated (see
   * `eventMetadata` below). */
  matchScore: UserJobMatchScore | null;
}

export interface CatalogJobHandoffPayload {
  snapshot: SanitizedJobSnapshotContent;
  snapshotContentFingerprint: string;
  snapshotContentTruncated: boolean;
  snapshotTruncatedFields: string[];
  canonicalUrl: string | null;
  eventMetadata: DiscoveryHandoffEventMetadata;
}

/**
 * The D6 handoff's snapshot-building step (docs/JOB_DISCOVERY.md "Handoff API/action
 * architecture") — extracted out of `apps/web/app/api/discovery/[id]/start-application/route.ts`
 * (D9 Phase A) so the Auto Mode cron orchestrator can build the exact same payload as the manual
 * "Start application" click, rather than a second, drifting copy of this logic. Every caller
 * still calls `startApplicationFromCatalogJob` itself with the result plus its own `jobCatalogId`
 * (and, for the orchestrator, its own `eventSource`) — this function only ever builds the
 * sanitized snapshot/fingerprint/metadata/canonical-url inputs, never calls the RPC itself.
 *
 * Snapshot content comes only from canonical catalog/feature data — never from Match/Coverage/
 * Eligibility, which are historical provenance (captured separately below) and never part of the
 * application's own snapshot record. `skills` stays empty: `job_catalog_features`'
 * `extractedCompetencyCodes` are internal matching codes, not human-readable skill strings the
 * way this field is used elsewhere.
 */
export async function buildCatalogJobHandoffPayload(
  input: BuildCatalogJobHandoffPayloadInput,
): Promise<CatalogJobHandoffPayload> {
  const { job, features, jobSource, matchScore } = input;

  const sanitizable: JobSnapshotSanitizableInput = {
    company: job.companyName,
    title: job.title,
    location: job.locationText,
    employmentType: job.employmentType,
    sourceUrl: job.sourceUrl ?? job.applyUrl,
    externalId: null,
    description: job.description,
    requiredQualifications: job.qualifications ? [job.qualifications] : [],
    preferredQualifications: [],
    responsibilities: job.responsibilities ? [job.responsibilities] : [],
    skills: [],
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    locations: job.locationText ? [job.locationText] : [],
    workMode:
      features && features.normalizedWorkplaceType !== 'UNKNOWN'
        ? features.normalizedWorkplaceType
        : null,
    remoteLocationRestrictions: null,
    workAuthorizationLanguage: null,
    sourceType: jobSource?.sourceType ?? null,
  };

  const { sanitized, contentTruncated, truncatedFields } = sanitizeJobSnapshotInput(sanitizable);
  const contentFingerprint = await computeJobSnapshotFingerprint(sanitized, {
    contentTruncated,
    truncatedFields,
  });

  // Historical Match/Coverage/Eligibility provenance — a snapshot of what discovery showed at the
  // moment of handoff, stored only as DISCOVERY_HANDOFF event metadata (never on the application
  // row itself, never anything a later read treats as live/authoritative). Null when the job
  // hasn't been scored for this user yet, never fabricated.
  const eventMetadata = discoveryHandoffEventMetadataSchema.parse({
    jobCatalogId: job.id,
    sourceType: jobSource?.sourceType ?? null,
    matchScore: matchScore?.matchScore ?? null,
    coverage: matchScore?.coverage ?? null,
    eligibilityStatus: matchScore?.eligibilityStatus ?? null,
    rankingVersion: matchScore?.rankingVersion ?? null,
    featureVersion: matchScore?.featureVersion ?? null,
    eligibilityVersion: matchScore?.eligibilityVersion ?? null,
  });

  // `job.canonicalApplyUrl` is raw catalog data, not a confirmed apply destination —
  // `selectCanonicalHandoffUrl` is the one named place this handoff-specific precedence decision
  // lives, so every caller of this helper stays consistent with the Discover UI's own
  // `selectJobApplyActions` without re-deriving the same logic twice.
  const canonicalUrl = selectCanonicalHandoffUrl(job.canonicalApplyUrl);

  return {
    snapshot: sanitized,
    snapshotContentFingerprint: contentFingerprint,
    snapshotContentTruncated: contentTruncated,
    snapshotTruncatedFields: truncatedFields,
    canonicalUrl,
    eventMetadata,
  };
}
