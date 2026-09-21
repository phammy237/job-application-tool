import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * Minimal shape for Phase 1 — manually-created applications reference a jobs row with just
 * company/title/location filled in. Full extraction fields (description, responsibilities,
 * qualifications, raw_extraction, platform_type) are populated starting Phase 2 by the
 * extension. See docs/DATA_MODEL.md "jobs".
 */
export const jobPlatformTypeSchema = z.enum([
  'GENERIC',
  'GREENHOUSE',
  'LEVER',
  'WORKDAY',
]);
export type JobPlatformType = z.infer<typeof jobPlatformTypeSchema>;

export const jobSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  company: z.string().nullable(),
  title: z.string().nullable(),
  location: z.string().nullable(),
  employmentType: z.string().nullable(),
  description: z.string().nullable(),
  responsibilities: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  preferredQualifications: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  sourceUrl: z.string().url().nullable(),
  /** The direct official application destination (e.g. an ATS apply link), distinct from
   * `sourceUrl` (the job-description page itself) — see docs/DATA_MODEL.md "jobs". Absent
   * rather than guessed when no reliable Apply link/JSON-LD was found on the page. */
  applyUrl: z.string().url().nullable(),
  platformType: jobPlatformTypeSchema.nullable(),
  rawExtraction: z.record(z.unknown()).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Job = z.infer<typeof jobSchema>;

export const jobInputSchema = jobSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type JobInput = z.infer<typeof jobInputSchema>;
