import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '@career-os/database';
import { enrichJobrightJob, extractJobPostingJsonLd, stripJobrightBoilerplate } from './jobright-enrichment';

/** Minimal in-memory single-table fake mirroring the exact `job_catalog` PostgREST call shapes
 * `getJobCatalogEntryById`/`updateJobCatalogEnrichment` issue — same technique as
 * `orchestrator/sync-source.test.ts`. */
interface FakeRow {
  id: string;
  [key: string]: unknown;
}

class FakeQuery {
  private op: 'select' | 'update' | null = null;
  private filters: Array<['eq', string, unknown]> = [];
  private payload: Record<string, unknown> | null = null;

  constructor(private readonly rows: FakeRow[]) {}

  select(_cols: string): this {
    this.op = 'select';
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push(['eq', col, value]);
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  private matches(row: FakeRow): boolean {
    return this.filters.every(([, col, value]) => row[col] === value);
  }

  async maybeSingle(): Promise<{ data: unknown; error: null }> {
    return { data: this.rows.find((row) => this.matches(row)) ?? null, error: null };
  }

  then(
    resolve: (value: { data: unknown; error: null }) => void,
    reject: (reason: unknown) => void,
  ): void {
    try {
      if (this.op === 'update') {
        for (const row of this.rows.filter((r) => this.matches(r))) {
          Object.assign(row, this.payload);
        }
      }
      resolve({ data: null, error: null });
    } catch (error) {
      reject(error);
    }
  }
}

function fakeSupabase(rows: FakeRow[]): CareerOsSupabaseClient {
  return { from: () => new FakeQuery(rows) } as unknown as CareerOsSupabaseClient;
}

function seedRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'cccccccc-0000-4000-8000-000000000001',
    source_id: 'dddddddd-0000-4000-8000-000000000002',
    source_job_id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    company_name: 'Acme Corp',
    title: 'Software Engineer Intern',
    normalized_title: 'software engineer intern',
    location_text: 'Remote',
    normalized_location: 'remote',
    city: null,
    state_region: null,
    country: null,
    workplace_type: 'REMOTE',
    employment_type: 'Internship',
    description: null,
    responsibilities: null,
    qualifications: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    apply_url: 'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
    source_url: 'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
    canonical_apply_url: 'https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
    dedupe_fingerprint: 'acme corp|software engineer intern|remote|https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa',
    cross_source_observations: [],
    posted_at: '2026-09-17T00:00:00.000Z',
    source_updated_at: null,
    first_seen_at: '2026-09-17T00:00:00.000Z',
    last_seen_at: '2026-09-17T00:00:00.000Z',
    content_updated_at: '2026-09-17T00:00:00.000Z',
    consecutive_misses: 0,
    status: 'ACTIVE',
    closed_at: null,
    resolution_status: 'NOT_ATTEMPTED',
    resolution_strategy: null,
    resolution_confidence: null,
    resolution_candidate_url: null,
    resolution_attempt_count: 0,
    resolution_last_attempt_at: null,
    resolution_link_check_failures: 0,
    content_hash: 'v1:seed-hash',
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

const JSON_LD_HTML = `<html><head>
<script id="job-posting" type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  title: 'Software Engineer Intern',
  description:
    '<p>Real posting text about the role and responsibilities.</p><h2>Company Overview</h2><p>Acme has a track record of offering H1B sponsorships, with 13 in 2026.</p>',
  datePosted: '2026-09-17',
  employmentType: 'INTERN',
  jobLocation: { address: { addressLocality: 'New York', addressRegion: 'NY', addressCountry: 'United States' } },
  baseSalary: { currency: 'USD', value: { minValue: 40, maxValue: 50, unitText: 'HOUR' } },
})}</script>
</head><body></body></html>`;

function mockFetchOnce(options: { ok: boolean; status?: number; body?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: options.ok,
      status: options.status ?? (options.ok ? 200 : 500),
      text: vi.fn().mockResolvedValue(options.body ?? ''),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractJobPostingJsonLd', () => {
  it('parses the JobPosting block out of a page with other scripts present', () => {
    const parsed = extractJobPostingJsonLd(JSON_LD_HTML);
    expect(parsed?.title).toBe('Software Engineer Intern');
  });

  it('returns null when no JobPosting JSON-LD block exists', () => {
    expect(extractJobPostingJsonLd('<html><body>no data here</body></html>')).toBeNull();
  });
});

describe('stripJobrightBoilerplate', () => {
  it('truncates at the first "Company Overview" heading', () => {
    const result = stripJobrightBoilerplate(
      'Real posting text.<h2>Company Overview</h2><p>Aggregate sponsorship commentary.</p>',
    );
    expect(result).toBe('Real posting text.');
    expect(result).not.toContain('sponsorship');
  });

  it('leaves a description with no boilerplate heading untouched', () => {
    expect(stripJobrightBoilerplate('Just the role description.')).toBe('Just the role description.');
  });
});

describe('enrichJobrightJob', () => {
  it('1. a successful fetch enriches the row and strips Jobright\'s own sponsorship boilerplate out of the description', async () => {
    const row = seedRow();
    const supabase = fakeSupabase([row]);
    mockFetchOnce({ ok: true, body: JSON_LD_HTML });

    const result = await enrichJobrightJob(supabase, { jobCatalogId: 'cccccccc-0000-4000-8000-000000000001', applyUrl: row.apply_url as string });

    expect(result.outcome).toBe('ENRICHED');
    expect(row.description).toBe('<p>Real posting text about the role and responsibilities.</p>');
    expect(row.description).not.toContain('H1B');
    expect(row.salary_min).toBe(40);
    expect(row.salary_max).toBe(50);
    expect(row.salary_currency).toBe('USD');
    expect(row.employment_type).toBe('INTERN');
    expect(row.content_hash).not.toBe('v1:seed-hash');
  });

  it('2. a failed fetch (network/HTTP error) leaves the README-seeded row completely untouched', async () => {
    const row = seedRow();
    const supabase = fakeSupabase([row]);
    mockFetchOnce({ ok: false, status: 500 });

    const result = await enrichJobrightJob(supabase, { jobCatalogId: 'cccccccc-0000-4000-8000-000000000001', applyUrl: row.apply_url as string });

    expect(result.outcome).toBe('FAILED');
    expect(row.description).toBeNull();
    expect(row.content_hash).toBe('v1:seed-hash');
  });

  it('3. a detail page with no JobPosting JSON-LD block (e.g. removed/moved) preserves the README-only record instead of guessing', async () => {
    const row = seedRow();
    const supabase = fakeSupabase([row]);
    mockFetchOnce({ ok: true, body: '<html><body>page changed, no structured data</body></html>' });

    const result = await enrichJobrightJob(supabase, { jobCatalogId: 'cccccccc-0000-4000-8000-000000000001', applyUrl: row.apply_url as string });

    expect(result.outcome).toBe('FAILED');
    expect(result.reason).toContain('JSON-LD');
    expect(row.description).toBeNull();
    expect(row.content_hash).toBe('v1:seed-hash');
  });
});
