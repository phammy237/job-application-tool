import { extractJobCatalogFeatures, JOB_CATALOG_FEATURE_VERSION } from '@career-os/shared';
import {
  listJobCatalogRowsNeedingFeatureRecompute,
  upsertJobCatalogFeaturesBatch,
  type CareerOsSupabaseClient,
} from '@career-os/database';

export interface FeatureExtractionFailure {
  jobCatalogId: string;
  reason: string;
}

export interface ExtractFeaturesSummary {
  candidatesFound: number;
  extracted: number;
  failed: number;
  failures: FeatureExtractionFailure[];
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recomputes `job_catalog_features` for every `job_catalog` row whose stored features are
 * missing or stale — either the job's content changed, or the feature-extraction rules
 * themselves changed (`JOB_CATALOG_FEATURE_VERSION`) since the row was last computed
 * (docs/JOB_DISCOVERY.md "Recomputation"). Pure orchestration: all the actual extraction logic
 * lives in `packages/shared`'s `extractJobCatalogFeatures`; this only fetches candidates and
 * persists results. Idempotent — running it twice in a row with nothing changed recomputes
 * `candidatesFound: 0`.
 *
 * One candidate's extraction is isolated from every other's — the same per-item failure-isolation
 * principle `runDiscoverySync`/`runJobrightEnrichment` already apply (docs/JOB_DISCOVERY.md
 * "Failure isolation"), which this function previously lacked: a single job whose title/
 * description tripped an unexpected exception in `extractJobCatalogFeatures` used to abort the
 * whole batch via an uncaught throw inside `.map()` — and since `scripts/discovery/rank.ts` always
 * runs this before re-scoring every user, that one bad candidate would have silently blocked the
 * daily ranking recompute for every user, reintroducing exactly the "newly-synced jobs never
 * become visible" gap `docs/JOB_DISCOVERY.md`'s D6.5 fix was written to close. A failed candidate
 * is skipped (its existing `job_catalog_features` row, if any, is left untouched — never persisted
 * half-computed) and reported in `failures`.
 */
export async function extractFeaturesForStaleJobs(
  supabase: CareerOsSupabaseClient,
  now: Date = new Date(),
): Promise<ExtractFeaturesSummary> {
  const candidates = await listJobCatalogRowsNeedingFeatureRecompute(
    supabase,
    JOB_CATALOG_FEATURE_VERSION,
  );

  const entries: Array<{ jobCatalogId: string; features: ReturnType<typeof extractJobCatalogFeatures> }> = [];
  const failures: FeatureExtractionFailure[] = [];

  for (const candidate of candidates) {
    try {
      entries.push({
        jobCatalogId: candidate.jobCatalogId,
        features: extractJobCatalogFeatures({
          title: candidate.title,
          description: candidate.description,
          locationText: candidate.locationText,
          employmentType: candidate.employmentType,
          workplaceType: candidate.workplaceType as 'REMOTE' | 'HYBRID' | 'ONSITE' | null,
          contentHash: candidate.contentHash,
        }),
      });
    } catch (error) {
      failures.push({ jobCatalogId: candidate.jobCatalogId, reason: errorReason(error) });
    }
  }

  await upsertJobCatalogFeaturesBatch(supabase, entries, now);

  return {
    candidatesFound: candidates.length,
    extracted: entries.length,
    failed: failures.length,
    failures,
  };
}
