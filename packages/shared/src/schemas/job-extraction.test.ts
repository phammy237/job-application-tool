import { describe, expect, it } from 'vitest';
import { JOB_EXTRACTION_CAPS, jobExtractionPayloadSchema } from './job-extraction';

const BASE = {
  company: 'Acme',
  title: 'Engineer',
  location: null,
  employmentType: null,
  description: 'Build things.',
  responsibilities: [],
  qualifications: [],
  preferredQualifications: [],
  skills: [],
  sourceUrl: 'https://acme.example.com/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
  platformType: 'GENERIC',
  rawExtraction: null,
};

describe('jobExtractionPayloadSchema', () => {
  it('passes an ordinary extraction through unchanged', () => {
    expect(jobExtractionPayloadSchema.parse(BASE)).toEqual(BASE);
  });

  it('truncates oversized text and lists instead of rejecting the whole analysis', () => {
    const parsed = jobExtractionPayloadSchema.parse({
      ...BASE,
      title: 'x'.repeat(10_000),
      description: 'y'.repeat(1_000_000),
      qualifications: Array.from({ length: 5_000 }, () => 'z'.repeat(5_000)),
    });
    expect(parsed.title).toHaveLength(JOB_EXTRACTION_CAPS.shortText);
    expect(parsed.description).toHaveLength(JOB_EXTRACTION_CAPS.description);
    expect(parsed.qualifications).toHaveLength(JOB_EXTRACTION_CAPS.arrayLength);
    expect(parsed.qualifications[0]).toHaveLength(JOB_EXTRACTION_CAPS.arrayItemLength);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['not a url'],
    [`https://example.com/${'a'.repeat(JOB_EXTRACTION_CAPS.url)}`],
  ])('drops a non-http(s) or oversized URL (%s) to null', (url) => {
    const parsed = jobExtractionPayloadSchema.parse({ ...BASE, sourceUrl: url, applyUrl: url });
    expect(parsed.sourceUrl).toBeNull();
    expect(parsed.applyUrl).toBeNull();
  });

  it('drops an oversized rawExtraction but keeps a normal one', () => {
    expect(
      jobExtractionPayloadSchema.parse({ ...BASE, rawExtraction: { jsonLd: { a: 1 } } })
        .rawExtraction,
    ).toEqual({ jsonLd: { a: 1 } });
    expect(
      jobExtractionPayloadSchema.parse({
        ...BASE,
        rawExtraction: { jsonLd: 'x'.repeat(JOB_EXTRACTION_CAPS.rawExtractionBytes) },
      }).rawExtraction,
    ).toBeNull();
  });

  it('still rejects a structurally wrong payload', () => {
    expect(jobExtractionPayloadSchema.safeParse({ ...BASE, skills: 'not-an-array' }).success).toBe(
      false,
    );
  });
});
