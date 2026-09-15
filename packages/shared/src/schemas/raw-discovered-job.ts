import { z } from 'zod';
import { jobCatalogWorkplaceTypeSchema } from './job-catalog';

/**
 * The one common intermediate shape every ATS adapter (docs/JOB_DISCOVERY.md "Adapter
 * architecture") normalizes its provider-specific response into, before it ever reaches
 * normalization/upsert — provider response shapes never leak past the adapter boundary.
 *
 * Every optional field is genuinely optional/nullable: a provider that doesn't supply a value
 * produces `null`/`undefined` here, never a fabricated one (CLAUDE.md "never invent a fact"
 * applies to discovery ingestion too, even though this path makes zero AI calls).
 */
export const rawDiscoveredJobSchema = z.object({
  sourceJobId: z.string().min(1),
  companyName: z.string().min(1),

  title: z.string().min(1),

  locationText: z.string().nullable(),

  workplaceType: jobCatalogWorkplaceTypeSchema.nullable().optional(),
  employmentType: z.string().nullable().optional(),

  description: z.string().nullable().optional(),
  responsibilities: z.string().nullable().optional(),
  qualifications: z.string().nullable().optional(),

  salaryMin: z.number().nullable().optional(),
  salaryMax: z.number().nullable().optional(),
  salaryCurrency: z.string().nullable().optional(),

  applyUrl: z.string().min(1),
  sourceUrl: z.string().nullable().optional(),

  /** Raw ISO-8601 string as supplied by the provider — parsed/validated by the caller. */
  postedAt: z.string().nullable().optional(),
  sourceUpdatedAt: z.string().nullable().optional(),
});
export type RawDiscoveredJob = z.infer<typeof rawDiscoveredJobSchema>;
