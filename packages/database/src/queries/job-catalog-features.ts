import {
  jobCatalogFeaturesSchema,
  type ExtractedJobCatalogFeatures,
  type JobCatalogFeatures,
} from '@career-os/shared';
import { assertNoError } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['job_catalog_features']['Row'];
type InsertRow = Database['public']['Tables']['job_catalog_features']['Insert'];

const UPSERT_CHUNK_SIZE = 100;
// PostgREST sends `.in('col', [...])` as a URL query parameter, not a request body — with
// UUIDs (~38 chars each) a few hundred of them overflows the ~16KB HTTP header limit and fails
// with a hard "fetch failed" / HeadersOverflowError, confirmed live against the real 1,371-job
// catalog during D4 verification (500 was too many). 150 stays comfortably under that limit even
// with the apikey/authorization headers Supabase itself adds.
const CANDIDATE_LOOKUP_CHUNK_SIZE = 150;
// PostgREST's default row cap on a plain `.select()` with no `.range()` is 1,000 — confirmed live
// (a 1,371-row `job_catalog` fetch silently returned only 1,000 rows before this was added).
// Every "fetch every row" query in this file must page through in chunks of this size.
const PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function rowToJobCatalogFeatures(row: Row): JobCatalogFeatures {
  return jobCatalogFeaturesSchema.parse({
    id: row.id,
    jobCatalogId: row.job_catalog_id,
    contentHashAtExtraction: row.content_hash_at_extraction,
    plainTextDescription: row.plain_text_description,
    roleFamily: row.role_family,
    seniority: row.seniority,
    isInternship: row.is_internship,
    isNewGrad: row.is_new_grad,
    normalizedEmploymentType: row.normalized_employment_type,
    normalizedWorkplaceType: row.normalized_workplace_type,
    locationTokens: row.location_tokens ?? [],
    extractedCompetencyCodes: row.extracted_competency_codes ?? [],
    requiredYearsMin: row.required_years_min,
    requiredYearsMax: row.required_years_max,
    graduationYearMin: row.graduation_year_min,
    graduationYearMax: row.graduation_year_max,
    sponsorshipSignal: row.sponsorship_signal,
    citizenshipRequirement: row.citizenship_requirement,
    clearanceRequirement: row.clearance_requirement,
    workAuthorizationRequirement: row.work_authorization_requirement,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    featureVersion: row.feature_version,
    computedAt: row.computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function getJobCatalogFeatures(
  supabase: CareerOsSupabaseClient,
  jobCatalogId: string,
): Promise<JobCatalogFeatures | null> {
  const { data, error } = await supabase
    .from('job_catalog_features')
    .select('*')
    .eq('job_catalog_id', jobCatalogId)
    .maybeSingle();
  assertNoError(error, 'getJobCatalogFeatures');
  return data ? rowToJobCatalogFeatures(data) : null;
}

export interface FeatureExtractionCandidate {
  jobCatalogId: string;
  title: string;
  description: string | null;
  locationText: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  contentHash: string;
}

/**
 * Every `job_catalog` row that either has no `job_catalog_features` row yet, or whose stored
 * `content_hash_at_extraction`/`feature_version` no longer matches the job's current content or
 * the currently-active extractor version (docs/JOB_DISCOVERY.md "Recomputation"). Fetches both
 * tables' relevant columns in bounded batches and diffs them in application code — at the "tens
 * of thousands of jobs" scale target this comfortably avoids both N+1 requests and a hand-written
 * SQL anti-join.
 */
export async function listJobCatalogRowsNeedingFeatureRecompute(
  supabase: CareerOsSupabaseClient,
  currentFeatureVersion: string,
): Promise<FeatureExtractionCandidate[]> {
  const catalogRows: Array<{
    id: string;
    title: string;
    description: string | null;
    location_text: string | null;
    employment_type: string | null;
    workplace_type: string | null;
    content_hash: string;
  }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: catalogError } = await supabase
      .from('job_catalog')
      .select('id, title, description, location_text, employment_type, workplace_type, content_hash')
      .range(offset, offset + PAGE_SIZE - 1);
    assertNoError(catalogError, 'listJobCatalogRowsNeedingFeatureRecompute (job_catalog)');
    catalogRows.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const existingByJobId = new Map<string, { contentHashAtExtraction: string; featureVersion: string }>();
  const allIds = catalogRows.map((row) => row.id);
  for (const idsChunk of chunk(allIds, CANDIDATE_LOOKUP_CHUNK_SIZE)) {
    const { data: featureRows, error: featureError } = await supabase
      .from('job_catalog_features')
      .select('job_catalog_id, content_hash_at_extraction, feature_version')
      .in('job_catalog_id', idsChunk);
    assertNoError(featureError, 'listJobCatalogRowsNeedingFeatureRecompute (job_catalog_features)');
    for (const row of featureRows ?? []) {
      existingByJobId.set(row.job_catalog_id, {
        contentHashAtExtraction: row.content_hash_at_extraction,
        featureVersion: row.feature_version,
      });
    }
  }

  const candidates: FeatureExtractionCandidate[] = [];
  for (const row of catalogRows) {
    const existing = existingByJobId.get(row.id);
    const needsRecompute =
      !existing ||
      existing.contentHashAtExtraction !== row.content_hash ||
      existing.featureVersion !== currentFeatureVersion;
    if (!needsRecompute) continue;

    candidates.push({
      jobCatalogId: row.id,
      title: row.title,
      description: row.description,
      locationText: row.location_text,
      employmentType: row.employment_type,
      workplaceType: row.workplace_type,
      contentHash: row.content_hash,
    });
  }
  return candidates;
}

export interface ScorableJob {
  jobCatalogId: string;
  companyName: string;
  firstSeenAt: string;
  features: JobCatalogFeatures;
}

/**
 * Every currently-ACTIVE `job_catalog` row that already has a `job_catalog_features` row,
 * joined in application code (same batched-fetch-then-map technique as the recompute-candidate
 * lookup above). A job with no features row yet is skipped defensively — `scripts/discovery/
 * rank.ts` always runs feature extraction first, so this should be empty in practice, but scoring
 * must never crash on a job it can't yet evaluate.
 */
export async function listActiveJobsWithFeatures(
  supabase: CareerOsSupabaseClient,
): Promise<ScorableJob[]> {
  const catalogRows: Array<{ id: string; company_name: string; first_seen_at: string }> = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error: catalogError } = await supabase
      .from('job_catalog')
      .select('id, company_name, first_seen_at')
      .eq('status', 'ACTIVE')
      .range(offset, offset + PAGE_SIZE - 1);
    assertNoError(catalogError, 'listActiveJobsWithFeatures (job_catalog)');
    catalogRows.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const featuresByJobId = new Map<string, JobCatalogFeatures>();
  const allIds = catalogRows.map((row) => row.id);
  for (const idsChunk of chunk(allIds, CANDIDATE_LOOKUP_CHUNK_SIZE)) {
    const { data: featureRows, error: featureError } = await supabase
      .from('job_catalog_features')
      .select('*')
      .in('job_catalog_id', idsChunk);
    assertNoError(featureError, 'listActiveJobsWithFeatures (job_catalog_features)');
    for (const row of featureRows ?? []) {
      featuresByJobId.set(row.job_catalog_id, rowToJobCatalogFeatures(row));
    }
  }

  const result: ScorableJob[] = [];
  for (const row of catalogRows) {
    const features = featuresByJobId.get(row.id);
    if (!features) continue;
    result.push({
      jobCatalogId: row.id,
      companyName: row.company_name,
      firstSeenAt: row.first_seen_at,
      features,
    });
  }
  return result;
}

/** Batched upsert keyed on the table's real unique constraint, `job_catalog_id` — a stale row's
 * content is fully overwritten (never merged), and `computed_at` always reflects this call. */
export async function upsertJobCatalogFeaturesBatch(
  supabase: CareerOsSupabaseClient,
  entries: ReadonlyArray<{ jobCatalogId: string; features: ExtractedJobCatalogFeatures }>,
  now: Date = new Date(),
): Promise<void> {
  if (entries.length === 0) return;
  const nowIso = now.toISOString();

  const rows: InsertRow[] = entries.map(({ jobCatalogId, features }) => ({
    job_catalog_id: jobCatalogId,
    content_hash_at_extraction: features.contentHashAtExtraction,
    plain_text_description: features.plainTextDescription,
    role_family: features.roleFamily,
    seniority: features.seniority,
    is_internship: features.isInternship,
    is_new_grad: features.isNewGrad,
    normalized_employment_type: features.normalizedEmploymentType,
    normalized_workplace_type: features.normalizedWorkplaceType,
    location_tokens: features.locationTokens,
    extracted_competency_codes: features.extractedCompetencyCodes,
    required_years_min: features.requiredYearsMin,
    required_years_max: features.requiredYearsMax,
    graduation_year_min: features.graduationYearMin,
    graduation_year_max: features.graduationYearMax,
    sponsorship_signal: features.sponsorshipSignal,
    citizenship_requirement: features.citizenshipRequirement,
    clearance_requirement: features.clearanceRequirement,
    work_authorization_requirement: features.workAuthorizationRequirement,
    evidence: features.evidence as Json,
    feature_version: features.featureVersion,
    computed_at: nowIso,
  }));

  for (const rowsChunk of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('job_catalog_features')
      .upsert(rowsChunk, { onConflict: 'job_catalog_id' });
    assertNoError(error, 'upsertJobCatalogFeaturesBatch');
  }
}
