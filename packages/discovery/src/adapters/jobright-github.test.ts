import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractJobrightJobId, parseJobrightReadme } from './jobright-github';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('parseJobrightReadme', () => {
  const referenceDate = new Date('2026-09-18T00:00:00.000Z');

  it('1. parses a normal row into a RawDiscoveredJob with all fields mapped', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const datadog = result.jobs.find((job) => job.sourceJobId === '6a831bfe2dbaf907b07665e1');
    expect(datadog).toMatchObject({
      companyName: 'Datadog',
      title: 'Product Management Intern',
      locationText: 'New York, NY, United States',
      workplaceType: 'ONSITE',
      employmentType: 'Internship',
      applyUrl: 'https://jobright.ai/jobs/info/6a831bfe2dbaf907b07665e1?utm_campaign=git&utm_source=git',
      postedAt: '2026-09-17T00:00:00.000Z',
    });
  });

  it('2. a continuation row (↳) inherits the previous row\'s company without ever storing the marker itself', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const continuation = result.jobs.find((job) => job.sourceJobId === 'aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(continuation?.companyName).toBe('Datadog');
    expect(result.jobs.every((job) => job.companyName !== '↳')).toBe(true);
  });

  it('3. extracts company/title text correctly from bold markdown links, and falls back to plain text when the company cell is not a link', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const plainCompanyRow = result.jobs.find((job) => job.title === 'Analyst Intern');
    expect(plainCompanyRow?.companyName).toBe('Plain Text Co');
  });

  it('4. blank optional cells (location/work model/date) normalize to null rather than empty strings', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const acme = result.jobs.find((job) => job.companyName === 'Acme Co');
    expect(acme).toBeDefined();
    expect(acme?.locationText).toBeNull();
    expect(acme?.workplaceType).toBeNull();
    expect(acme?.postedAt).toBeNull();
  });

  it('5. a malformed row (wrong column count) is skipped and reported as rejected, never thrown', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    expect(result.rejected.some((r) => r.reason.includes('expected 5 columns'))).toBe(true);
  });

  it('5b. a row with a missing/malformed title link is rejected, never emitted with an empty title', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    expect(result.rejected.some((r) => r.reason.includes('missing/malformed title link'))).toBe(true);
    expect(result.jobs.every((job) => job.title.length > 0)).toBe(true);
  });

  it('6. a duplicate row (identical Jobright id appearing twice) parses to two entries sharing the same sourceJobId — the orchestrator, not the parser, dedupes them', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const dupRows = result.jobs.filter((job) => job.sourceJobId === 'bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(dupRows).toHaveLength(2);
  });

  it('7. missing/changed TABLE_START/TABLE_END markers are detected as a structurally unhealthy source, never silently parsed as zero legitimate rows', () => {
    const result = parseJobrightReadme(loadFixture('jobright-readme-no-markers.md'), new Date());
    expect(result.tableFound).toBe(false);
    expect(result.jobs).toHaveLength(0);
  });
});

describe('extractJobrightJobId', () => {
  it('1. extracts the 24-hex-char id and strips UTM/query parameters', () => {
    expect(
      extractJobrightJobId(
        'https://jobright.ai/jobs/info/6a831bfe2dbaf907b07665e1?utm_campaign=git&utm_source=git',
      ),
    ).toBe('6a831bfe2dbaf907b07665e1');
  });

  it('2. extracts the id from a bare URL with no query string at all', () => {
    expect(extractJobrightJobId('https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('3. returns null (never a raw URL-with-UTM) for a URL that does not match the Jobright detail-page shape, and the parser falls back to a deterministic key', () => {
    expect(extractJobrightJobId('https://example.com/careers/acme/ops')).toBeNull();

    const referenceDate = new Date('2026-09-18T00:00:00.000Z');
    const result = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const acme = result.jobs.find((job) => job.companyName === 'Acme Co');
    expect(acme?.sourceJobId).toBe('fallback:acme co:ops intern:');
    // Stability: re-parsing the identical fixture produces the identical fallback key.
    const secondParse = parseJobrightReadme(loadFixture('jobright-readme-normal.md'), referenceDate);
    const acmeAgain = secondParse.jobs.find((job) => job.companyName === 'Acme Co');
    expect(acmeAgain?.sourceJobId).toBe(acme?.sourceJobId);
  });
});
