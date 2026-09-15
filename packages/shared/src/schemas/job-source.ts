import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * Job Discovery Track (docs/JOB_DISCOVERY.md) — allowed ATS providers for THIS phase only.
 * Deliberately does not include speculative types (WORKDAY, LINKEDIN, INDEED, GENERIC,
 * SMARTRECRUITERS) before they exist as real adapters.
 */
export const jobSourceTypeSchema = z.enum(['GREENHOUSE', 'LEVER', 'ASHBY']);
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
