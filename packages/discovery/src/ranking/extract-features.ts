import { extractJobCatalogFeatures, JOB_CATALOG_FEATURE_VERSION } from '@career-os/shared';
import {
  listJobCatalogRowsNeedingFeatureRecompute,
  upsertJobCatalogFeaturesBatch,
  type CareerOsSupabaseClient,
} from '@career-os/database';

export interface ExtractFeaturesSummary {
  candidatesFound: number;
  extracted: number;
}

/**
 * Recomputes `job_catalog_features` for every `job_catalog` row whose stored features are
 * missing or stale — either the job's content changed, or the feature-extraction rules
 * themselves changed (`JOB_CATALOG_FEATURE_VERSION`) since the row was last computed
 * (docs/JOB_DISCOVERY.md "Recomputation"). Pure orchestration: all the actual extraction logic
 * lives in `packages/shared`'s `extractJobCatalogFeatures`; this only fetches candidates and
 * persists results. Idempotent — running it twice in a row with nothing changed recomputes
 * `candidatesFound: 0`.
 */
export async function extractFeaturesForStaleJobs(
  supabase: CareerOsSupabaseClient,
  now: Date = new Date(),
): Promise<ExtractFeaturesSummary> {
  const candidates = await listJobCatalogRowsNeedingFeatureRecompute(
    supabase,
    JOB_CATALOG_FEATURE_VERSION,
  );

  const entries = candidates.map((candidate) => ({
    jobCatalogId: candidate.jobCatalogId,
    features: extractJobCatalogFeatures({
      title: candidate.title,
      description: candidate.description,
      locationText: candidate.locationText,
      employmentType: candidate.employmentType,
      workplaceType: candidate.workplaceType as 'REMOTE' | 'HYBRID' | 'ONSITE' | null,
      contentHash: candidate.contentHash,
    }),
  }));

  await upsertJobCatalogFeaturesBatch(supabase, entries, now);

  return { candidatesFound: candidates.length, extracted: entries.length };
}
