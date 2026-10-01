import { z } from 'zod';
import { jobPlatformTypeSchema } from './job';

/**
 * Size caps for a job extracted from an arbitrary web page. Generous enough for any real posting
 * (larger than JOB_SNAPSHOT_CAPS, which bounds the snapshot and prompt copy), but bounded — the
 * payload is untrusted page content and every byte of it lands in the jobs table.
 */
export const JOB_EXTRACTION_CAPS = {
  shortText: 500,
  description: 50_000,
  arrayLength: 100,
  arrayItemLength: 1_000,
  url: 2_048,
  rawExtractionBytes: 50_000,
} as const;

/** Truncates rather than rejects: an oversized posting still gets analyzed, just clipped. */
const cappedText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : value.slice(0, max)));

const cappedList = z
  .array(z.string())
  .default([])
  .transform((items) =>
    items
      .slice(0, JOB_EXTRACTION_CAPS.arrayLength)
      .map((item) => item.slice(0, JOB_EXTRACTION_CAPS.arrayItemLength)),
  );

/** http(s) only — a page's own JSON-LD/links are attacker-controlled, and a `javascript:`/`data:`
 * URL is never a real posting or apply destination. Anything else becomes null (absent), the same
 * outcome as "no reliable URL found", rather than failing the whole analysis. */
const httpUrl = z
  .string()
  .nullable()
  .transform((value) => {
    if (value === null || value.length > JOB_EXTRACTION_CAPS.url) return null;
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  });

/**
 * The payload the extension's content script produces and POST /api/jobs/analyze accepts — the
 * shape of a jobs row minus id/userId/timestamps (JobInput), with the caps above applied. Both
 * sides parse through this same schema, so the extension's preview and what's stored always
 * match.
 */
export const jobExtractionPayloadSchema = z.object({
  company: cappedText(JOB_EXTRACTION_CAPS.shortText),
  title: cappedText(JOB_EXTRACTION_CAPS.shortText),
  location: cappedText(JOB_EXTRACTION_CAPS.shortText),
  employmentType: cappedText(JOB_EXTRACTION_CAPS.shortText),
  description: cappedText(JOB_EXTRACTION_CAPS.description),
  responsibilities: cappedList,
  qualifications: cappedList,
  preferredQualifications: cappedList,
  skills: cappedList,
  sourceUrl: httpUrl,
  applyUrl: httpUrl,
  platformType: jobPlatformTypeSchema.nullable(),
  // Dropped (not rejected) when oversized — it's a debugging aid, never needed for analysis.
  rawExtraction: z
    .record(z.unknown())
    .nullable()
    .transform((value) =>
      value !== null && JSON.stringify(value).length > JOB_EXTRACTION_CAPS.rawExtractionBytes
        ? null
        : value,
    ),
});
export type JobExtractionPayload = z.output<typeof jobExtractionPayloadSchema>;
