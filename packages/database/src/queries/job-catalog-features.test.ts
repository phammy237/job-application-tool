import { describe, expect, it } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  listActiveJobsWithFeatures,
  listJobCatalogRowsNeedingFeatureRecompute,
  upsertJobCatalogFeaturesBatch,
} from './job-catalog-features';
import type { ExtractedJobCatalogFeatures } from '@career-os/shared';

/** Minimal in-memory, multi-table fake — same technique as packages/discovery's
 * sync-source.test.ts / job-catalog.test.ts. */
interface FakeRow {
  [key: string]: unknown;
}
class FakeStore {
  tables: { job_catalog: FakeRow[]; job_catalog_features: FakeRow[] } = {
    job_catalog: [],
    job_catalog_features: [],
  };
  private nextId = 1;
  genId(): string {
    return `feat-${this.nextId++}`;
  }
}
class FakeQuery {
  private op: 'select' | 'upsert' | null = null;
  private filters: Array<['eq' | 'in', string, unknown]> = [];
  private selectCols: string[] | null = null;
  private payload: unknown = null;
  private upsertOnConflict: string[] = [];

  constructor(
    private readonly store: FakeStore,
    private readonly table: 'job_catalog' | 'job_catalog_features',
  ) {}

  select(cols: string): this {
    this.op = 'select';
    this.selectCols = cols.split(',').map((c) => c.trim());
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push(['eq', col, value]);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push(['in', col, values]);
    return this;
  }
  // No-op: the fixtures in this file are always far smaller than one page, so pagination itself
  // doesn't need exercising here — it's verified against the real, ~1,400-row live catalog
  // instead (docs/JOB_DISCOVERY.md "Live ranking analysis").
  range(_from: number, _to: number): this {
    return this;
  }
  upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): this {
    this.op = 'upsert';
    this.payload = rows;
    this.upsertOnConflict = opts.onConflict.split(',');
    return this;
  }
  private rows(): FakeRow[] {
    return this.store.tables[this.table];
  }
  private matches(row: FakeRow): boolean {
    return this.filters.every(([kind, col, value]) => {
      if (kind === 'eq') return row[col] === value;
      return (value as unknown[]).includes(row[col]);
    });
  }
  then(resolve: (v: { data: unknown; error: null }) => void, reject: (r: unknown) => void): void {
    try {
      resolve(this.execute());
    } catch (e) {
      reject(e);
    }
  }
  private execute(): { data: unknown; error: null } {
    if (this.op === 'select') {
      const matched = this.rows().filter((r) => this.matches(r));
      const data = matched.map((row) => {
        if (this.selectCols?.includes('*')) return row;
        const picked: Record<string, unknown> = {};
        for (const col of this.selectCols ?? []) picked[col] = row[col];
        return picked;
      });
      return { data, error: null };
    }
    if (this.op === 'upsert') {
      const rows = this.store.tables[this.table];
      for (const incoming of this.payload as Record<string, unknown>[]) {
        const idx = rows.findIndex((r) => this.upsertOnConflict.every((c) => r[c] === incoming[c]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...incoming, id: rows[idx]!.id };
        else rows.push({ id: this.store.genId(), ...incoming });
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}
function fakeSupabase(store: FakeStore): CareerOsSupabaseClient {
  return {
    from: (table: 'job_catalog' | 'job_catalog_features') => new FakeQuery(store, table),
  } as unknown as CareerOsSupabaseClient;
}

function baseFeatures(overrides: Partial<ExtractedJobCatalogFeatures> = {}): ExtractedJobCatalogFeatures {
  return {
    contentHashAtExtraction: 'v1:hash1',
    plainTextDescription: 'Do things.',
    roleFamily: 'SOFTWARE_ENGINEERING',
    seniority: 'UNKNOWN',
    isInternship: false,
    isNewGrad: false,
    normalizedEmploymentType: 'FULL_TIME',
    normalizedWorkplaceType: 'REMOTE',
    locationTokens: [],
    extractedCompetencyCodes: [],
    requiredYearsMin: null,
    requiredYearsMax: null,
    graduationYearMin: null,
    graduationYearMax: null,
    sponsorshipSignal: 'UNKNOWN',
    citizenshipRequirement: 'UNKNOWN',
    clearanceRequirement: 'UNKNOWN',
    workAuthorizationRequirement: 'UNKNOWN',
    evidence: {},
    featureVersion: 'd4-features-v1',
    ...overrides,
  };
}

describe('listJobCatalogRowsNeedingFeatureRecompute', () => {
  it('includes a job_catalog row with no features row at all', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push({
      id: 'j1',
      title: 'Engineer',
      description: null,
      location_text: null,
      employment_type: null,
      workplace_type: null,
      content_hash: 'v1:h1',
    });
    const result = await listJobCatalogRowsNeedingFeatureRecompute(fakeSupabase(store), 'd4-features-v1');
    expect(result).toHaveLength(1);
    expect(result[0]?.jobCatalogId).toBe('j1');
  });

  it('excludes a job whose features are already current (same hash, same version)', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push({
      id: 'j1',
      title: 'Engineer',
      description: null,
      location_text: null,
      employment_type: null,
      workplace_type: null,
      content_hash: 'v1:h1',
    });
    store.tables.job_catalog_features.push({
      job_catalog_id: 'j1',
      content_hash_at_extraction: 'v1:h1',
      feature_version: 'd4-features-v1',
    });
    const result = await listJobCatalogRowsNeedingFeatureRecompute(fakeSupabase(store), 'd4-features-v1');
    expect(result).toHaveLength(0);
  });

  it('includes a job whose content_hash changed since features were computed', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push({
      id: 'j1',
      title: 'Engineer',
      description: null,
      location_text: null,
      employment_type: null,
      workplace_type: null,
      content_hash: 'v1:NEW',
    });
    store.tables.job_catalog_features.push({
      job_catalog_id: 'j1',
      content_hash_at_extraction: 'v1:OLD',
      feature_version: 'd4-features-v1',
    });
    const result = await listJobCatalogRowsNeedingFeatureRecompute(fakeSupabase(store), 'd4-features-v1');
    expect(result).toHaveLength(1);
  });

  it('includes a job whose feature_version is stale even with an unchanged content hash', async () => {
    const store = new FakeStore();
    store.tables.job_catalog.push({
      id: 'j1',
      title: 'Engineer',
      description: null,
      location_text: null,
      employment_type: null,
      workplace_type: null,
      content_hash: 'v1:h1',
    });
    store.tables.job_catalog_features.push({
      job_catalog_id: 'j1',
      content_hash_at_extraction: 'v1:h1',
      feature_version: 'd4-features-v0-old',
    });
    const result = await listJobCatalogRowsNeedingFeatureRecompute(fakeSupabase(store), 'd4-features-v1');
    expect(result).toHaveLength(1);
  });
});

describe('upsertJobCatalogFeaturesBatch', () => {
  it('inserts a new row for a job with no existing features', async () => {
    const store = new FakeStore();
    await upsertJobCatalogFeaturesBatch(fakeSupabase(store), [
      { jobCatalogId: 'j1', features: baseFeatures() },
    ]);
    expect(store.tables.job_catalog_features).toHaveLength(1);
    expect(store.tables.job_catalog_features[0]?.job_catalog_id).toBe('j1');
    expect(store.tables.job_catalog_features[0]?.role_family).toBe('SOFTWARE_ENGINEERING');
  });

  it('overwrites an existing row keyed on job_catalog_id, never duplicating', async () => {
    const store = new FakeStore();
    await upsertJobCatalogFeaturesBatch(fakeSupabase(store), [
      { jobCatalogId: 'j1', features: baseFeatures({ roleFamily: 'DATA_SCIENCE' }) },
    ]);
    await upsertJobCatalogFeaturesBatch(fakeSupabase(store), [
      { jobCatalogId: 'j1', features: baseFeatures({ roleFamily: 'PRODUCT_MANAGEMENT' }) },
    ]);
    expect(store.tables.job_catalog_features).toHaveLength(1);
    expect(store.tables.job_catalog_features[0]?.role_family).toBe('PRODUCT_MANAGEMENT');
  });

  it('is a no-op for an empty batch', async () => {
    const store = new FakeStore();
    await upsertJobCatalogFeaturesBatch(fakeSupabase(store), []);
    expect(store.tables.job_catalog_features).toHaveLength(0);
  });
});

describe('listActiveJobsWithFeatures', () => {
  it('only returns ACTIVE jobs that already have a features row', async () => {
    const store = new FakeStore();
    const J1 = 'aaaaaaaa-0000-4000-8000-000000000001';
    const J2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    const J3 = 'aaaaaaaa-0000-4000-8000-000000000003';
    store.tables.job_catalog.push(
      { id: J1, company_name: 'Acme', first_seen_at: '2026-01-01T00:00:00.000Z', status: 'ACTIVE' },
      { id: J2, company_name: 'Acme', first_seen_at: '2026-01-01T00:00:00.000Z', status: 'ACTIVE' },
      { id: J3, company_name: 'Acme', first_seen_at: '2026-01-01T00:00:00.000Z', status: 'CLOSED' },
    );
    store.tables.job_catalog_features.push({
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      job_catalog_id: J1,
      content_hash_at_extraction: 'v1:h',
      plain_text_description: '',
      role_family: 'UNKNOWN',
      seniority: 'UNKNOWN',
      is_internship: false,
      is_new_grad: false,
      normalized_employment_type: 'UNKNOWN',
      normalized_workplace_type: 'UNKNOWN',
      location_tokens: [],
      extracted_competency_codes: [],
      required_years_min: null,
      required_years_max: null,
      graduation_year_min: null,
      graduation_year_max: null,
      sponsorship_signal: 'UNKNOWN',
      citizenship_requirement: 'UNKNOWN',
      clearance_requirement: 'UNKNOWN',
      work_authorization_requirement: 'UNKNOWN',
      evidence: {},
      feature_version: 'd4-features-v1',
      computed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const result = await listActiveJobsWithFeatures(fakeSupabase(store));
    expect(result.map((r) => r.jobCatalogId)).toEqual([J1]);
  });
});
