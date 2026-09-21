import type { CareerOsSupabaseClient } from '@career-os/database';
import {
  appendCrossSourceObservation,
  getJobCatalogIdsBySourceJobIds,
  listActiveJobCatalogEntriesForDedupe,
  listAllJobSources,
  listJobCatalogEnrichmentSnapshots,
  recordJobSourceCrawlFailure,
  recordJobSourceCrawlSuccess,
  reconcileMissingJobsForSource,
  updateJobSourceEtag,
  upsertDiscoveredJobsForSource,
} from '@career-os/database';
import {
  computeJobCatalogContentHash,
  type JobSource,
  type NormalizedDiscoveredJob,
  type RawDiscoveredJob,
} from '@career-os/shared';
import { ashbyAdapter } from '../adapters/ashby';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { jobrightGithubAdapter } from '../adapters/jobright-github';
import { leverAdapter } from '../adapters/lever';
import { buildCrossSourceDedupeIndex, findCrossSourceDuplicate } from '../dedupe/cross-source-dedupe';
import { normalizeDiscoveredJob } from '../normalize';
import { mergeIntoAtsMatch } from '../official-posting-resolution';
import type { JobSourceAdapter } from '../types';

const ADAPTERS: Record<JobSource['sourceType'], JobSourceAdapter> = {
  GREENHOUSE: greenhouseAdapter,
  LEVER: leverAdapter,
  ASHBY: ashbyAdapter,
  JOBRIGHT_GITHUB: jobrightGithubAdapter,
};

export interface SourceSyncResult {
  sourceId: string;
  companyName: string;
  provider: JobSource['sourceType'];
  outcome: 'SUCCESS' | 'FAILURE';
  error?: string;
  durationMs: number;
  jobsFetched: number;
  new: number;
  updated: number;
  unchanged: number;
  possiblyClosed: number;
  closed: number;
  reopened: number;
  rejected: number;
  /** D7 — a Jobright candidate suppressed as a duplicate of an existing ATS-native row (a cross-
   * source observation was appended instead of inserting a second `job_catalog` row). Always 0/
   * omitted for non-Jobright sources — optional so pre-existing call sites that construct a
   * `SourceSyncResult` by hand (tests, `run-sync.ts`'s catch branch) don't all need updating. */
  crossSourceDuplicates?: number;
  /** D7 — true when the fetch was a GitHub conditional-request 304: no upsert/reconcile ran
   * because nothing changed since the last sync. Always false/omitted for non-conditional adapters. */
  notModified?: boolean;
}

/**
 * Syncs exactly one source, end to end (docs/JOB_DISCOVERY.md "Ingestion orchestrator"):
 * select adapter -> fetch -> (on SUCCESS) dedupe by provider id -> normalize -> upsert -> ONLY
 * THEN reconcile missing jobs -> record source crawl health. A FAILURE result from the adapter
 * never reaches the upsert/reconcile step and never touches any existing job_catalog row's
 * status/misses — this is the single mechanism that keeps a provider outage from mass-closing
 * jobs (docs/JOB_DISCOVERY.md "Closed-job lifecycle" scenario F).
 */
export async function syncSource(
  supabase: CareerOsSupabaseClient,
  source: JobSource,
  now: Date = new Date(),
): Promise<SourceSyncResult> {
  const start = Date.now();
  const adapter = ADAPTERS[source.sourceType];

  const fetchResult = await adapter.fetchJobs(source);

  if (fetchResult.status === 'FAILURE') {
    await recordJobSourceCrawlFailure(supabase, source.id, fetchResult.error, now);
    return {
      sourceId: source.id,
      companyName: source.companyName,
      provider: source.sourceType,
      outcome: 'FAILURE',
      error: fetchResult.error,
      durationMs: Date.now() - start,
      jobsFetched: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      possiblyClosed: 0,
      closed: 0,
      reopened: 0,
      rejected: fetchResult.rejected.length,
      crossSourceDuplicates: 0,
    };
  }

  // D7 — a GitHub conditional-request 304: nothing changed since the cached etag. This is a
  // genuinely successful crawl, but running upsert/reconcile against an empty job list would
  // incorrectly mark every previously-seen Jobright job as missing this sync (see types.ts's
  // `NOT_MODIFIED` doc comment) — so both steps are skipped entirely, not just given empty input.
  if (fetchResult.status === 'NOT_MODIFIED') {
    await recordJobSourceCrawlSuccess(supabase, source.id, now);
    return {
      sourceId: source.id,
      companyName: source.companyName,
      provider: source.sourceType,
      outcome: 'SUCCESS',
      durationMs: Date.now() - start,
      jobsFetched: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      possiblyClosed: 0,
      closed: 0,
      reopened: 0,
      rejected: 0,
      crossSourceDuplicates: 0,
      notModified: true,
    };
  }

  // Deterministic dedupe of a duplicate provider id within one response
  // (docs/JOB_DISCOVERY.md scenario H) — first occurrence wins, the rest count as rejected.
  const seen = new Map<string, RawDiscoveredJob>();
  let duplicateCount = 0;
  for (const raw of fetchResult.jobs) {
    if (seen.has(raw.sourceJobId)) {
      duplicateCount += 1;
      continue;
    }
    seen.set(raw.sourceJobId, raw);
  }
  const uniqueRaw = [...seen.values()];

  if (source.sourceType === 'JOBRIGHT_GITHUB' && uniqueRaw.length === 0) {
    // Section 19 — a Jobright README that suddenly parses to zero rows is suspicious (the table
    // markers may have changed shape upstream), never a silently-fine "nothing to sync" sync.
    console.warn(
      `[discovery] Jobright source "${source.companyName}" (${source.sourceIdentifier}) parsed 0 rows this sync — possible source-health issue.`,
    );
  }

  const normalized = await Promise.all(uniqueRaw.map((raw) => normalizeDiscoveredJob(raw)));

  // D7 §8 — cross-source dedupe: a Jobright candidate that matches an ACTIVE catalog row from a
  // different, non-Jobright source is never inserted as a second `job_catalog` row. Its
  // observation is appended to the existing row instead (`appendCrossSourceObservation`), and it
  // is excluded from `toUpsert` — but NOT excluded from the reconcile list below, since it was
  // genuinely still present in this sync and must not be treated as missing.
  let toUpsert: NormalizedDiscoveredJob[] = normalized;
  let crossSourceDuplicates = 0;
  if (source.sourceType === 'JOBRIGHT_GITHUB' && normalized.length > 0) {
    const allSources = await listAllJobSources(supabase);
    const otherSourceIds = allSources
      .filter((candidate) => candidate.sourceType !== 'JOBRIGHT_GITHUB')
      .map((candidate) => candidate.id);
    const dedupeCandidates = await listActiveJobCatalogEntriesForDedupe(supabase, otherSourceIds);
    const dedupeIndex = buildCrossSourceDedupeIndex(dedupeCandidates);

    // D7.1 — a job whose sourceJobId already has its own job_catalog row (ingested before a
    // matching ATS-native row existed) needs a full MERGE, not just a "don't insert a duplicate"
    // suppression, the moment it starts matching one: without this, the existing row would simply
    // freeze in place (excluded from toUpsert below, but never reconciled either) and keep showing
    // as its own independent card forever (docs/JOB_DISCOVERY.md "Official posting resolution").
    const existingJobCatalogIds = await getJobCatalogIdsBySourceJobIds(
      supabase,
      source.id,
      normalized.map((job) => job.sourceJobId),
    );

    const genuinelyNew: NormalizedDiscoveredJob[] = [];
    for (const job of normalized) {
      const match = findCrossSourceDuplicate(dedupeIndex, {
        companyName: job.companyName,
        title: job.title,
        locationText: job.locationText,
        canonicalApplyUrl: job.canonicalApplyUrl,
        postedAt: job.postedAt,
      });
      if (match) {
        crossSourceDuplicates += 1;
        const existingJobCatalogId = existingJobCatalogIds.get(job.sourceJobId);
        if (existingJobCatalogId) {
          await mergeIntoAtsMatch(
            supabase,
            {
              jobrightJobCatalogId: existingJobCatalogId,
              atsJobCatalogId: match.jobCatalogId,
              sourceIdentifier: source.sourceIdentifier,
              sourceJobId: job.sourceJobId,
              sourceUrl: job.sourceUrl ?? job.applyUrl,
            },
            now,
          );
        } else {
          await appendCrossSourceObservation(supabase, match.jobCatalogId, {
            provider: 'JOBRIGHT_GITHUB',
            sourceIdentifier: source.sourceIdentifier,
            sourceJobId: job.sourceJobId,
            sourceUrl: job.sourceUrl ?? job.applyUrl,
            observedAt: now.toISOString(),
          });
        }
      } else {
        genuinelyNew.push(job);
      }
    }
    // D7 §9-10 — the raw README table never supplies description/salary, so every genuinely-new-
    // or-unchanged row's own fields are null for these. Without this merge, a previously enriched
    // row would recompute its content hash from those nulls on this normal resync, see a mismatch
    // against its currently-stored (enriched) hash, and get overwritten right back to its
    // README-only state — silently destroying the enrichment stage's work on every single sync.
    // Carrying the existing enriched values forward (only where the raw job's own field is null)
    // keeps the hash — and therefore the row — stable when nothing genuinely changed.
    if (genuinelyNew.length > 0) {
      const snapshots = await listJobCatalogEnrichmentSnapshots(
        supabase,
        source.id,
        genuinelyNew.map((job) => job.sourceJobId),
      );
      toUpsert = await Promise.all(
        genuinelyNew.map(async (job) => {
          const snapshot = snapshots.get(job.sourceJobId);
          if (!snapshot) return job;

          const merged: NormalizedDiscoveredJob = {
            ...job,
            description: job.description ?? snapshot.description,
            responsibilities: job.responsibilities ?? snapshot.responsibilities,
            qualifications: job.qualifications ?? snapshot.qualifications,
            salaryMin: job.salaryMin ?? snapshot.salaryMin,
            salaryMax: job.salaryMax ?? snapshot.salaryMax,
            salaryCurrency: job.salaryCurrency ?? snapshot.salaryCurrency,
          };
          merged.contentHash = await computeJobCatalogContentHash({
            companyName: merged.companyName,
            title: merged.title,
            locationText: merged.locationText,
            workplaceType: merged.workplaceType,
            employmentType: merged.employmentType,
            description: merged.description,
            responsibilities: merged.responsibilities,
            qualifications: merged.qualifications,
            salaryMin: merged.salaryMin,
            salaryMax: merged.salaryMax,
            salaryCurrency: merged.salaryCurrency,
            applyUrl: merged.applyUrl,
          });
          return merged;
        }),
      );
    } else {
      toUpsert = genuinelyNew;
    }
  }

  const upsertSummary = await upsertDiscoveredJobsForSource(supabase, source.id, toUpsert, now);

  // Reconciliation happens ONLY here, after upsert of a fully-successful fetch — never on a
  // FAILURE result (handled entirely above, before this point is ever reached). The full
  // `normalized` list (not `toUpsert`) is used so a suppressed cross-source duplicate still counts
  // as "seen this sync" and is never marked possibly-closed for being deliberately not re-inserted.
  const reconcileSummary = await reconcileMissingJobsForSource(
    supabase,
    source.id,
    normalized.map((job) => job.sourceJobId),
    now,
  );

  await recordJobSourceCrawlSuccess(supabase, source.id, now);
  if (fetchResult.etag !== undefined) {
    await updateJobSourceEtag(supabase, source.id, fetchResult.etag);
  }

  return {
    sourceId: source.id,
    companyName: source.companyName,
    provider: source.sourceType,
    outcome: 'SUCCESS',
    durationMs: Date.now() - start,
    jobsFetched: fetchResult.jobs.length,
    new: upsertSummary.new,
    updated: upsertSummary.updated,
    unchanged: upsertSummary.unchanged,
    reopened: upsertSummary.reopened,
    possiblyClosed: reconcileSummary.possiblyClosed,
    closed: reconcileSummary.closed,
    rejected: fetchResult.rejected.length + duplicateCount,
    crossSourceDuplicates,
  };
}
