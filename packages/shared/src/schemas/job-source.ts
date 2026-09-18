import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * Job Discovery Track (docs/JOB_DISCOVERY.md) — allowed job source providers. `JOBRIGHT_GITHUB`
 * (D7) is not an ATS — it's a GitHub-hosted aggregator repo — but follows the exact same
 * adapter/registry contract as the three real ATS providers (docs/JOB_DISCOVERY.md "Cross-source
 * dedupe": Jobright must never be described as the employer's own ATS). Deliberately does not
 * include further speculative types (WORKDAY, LINKEDIN, INDEED, GENERIC, SMARTRECRUITERS) before
 * they exist as real adapters.
 */
export const jobSourceTypeSchema = z.enum(['GREENHOUSE', 'LEVER', 'ASHBY', 'JOBRIGHT_GITHUB']);
export type JobSourceType = z.infer<typeof jobSourceTypeSchema>;

/** The persisted `job_sources` row shape — a global, platform-owned registry, not user-owned. */
export const jobSourceSchema = z.object({
  id: uuidSchema,
  companyName: z.string().min(1),
  sourceType: jobSourceTypeSchema,
  sourceIdentifier: z.string().min(1),
  careersUrl: z.string().nullable(),
  enabled: z.boolean(),
  crawlIntervalHours: z.number().int().positive(),
  lastCrawledAt: isoDateTimeSchema.nullable(),
  lastSuccessAt: isoDateTimeSchema.nullable(),
  lastErrorAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  /** D7 — cached ETag from the last successful GitHub Contents API fetch, so the next sync can
   * send `If-None-Match` and skip re-parsing an unchanged README. Null for every non-GitHub
   * source and for a GitHub source that has never synced successfully. */
  etag: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type JobSource = z.infer<typeof jobSourceSchema>;

/**
 * One entry in a `scripts/discovery/import-sources.ts` input file (docs/JOB_DISCOVERY.md
 * "Source registry management"). Validated before any upsert — never trusted as-is. Source files
 * carry only public ATS identifiers/URLs and are safe to commit (never a secret).
 */
export const jobSourceImportEntrySchema = z.object({
  companyName: z.string().min(1),
  sourceType: jobSourceTypeSchema,
  sourceIdentifier: z.string().min(1),
  careersUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  crawlIntervalHours: z.number().int().positive().optional(),
});
export type JobSourceImportEntry = z.infer<typeof jobSourceImportEntrySchema>;

export const jobSourceImportFileSchema = z.array(jobSourceImportEntrySchema);
