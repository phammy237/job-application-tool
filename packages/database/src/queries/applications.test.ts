import { describe, expect, it, vi } from 'vitest';
import type { SanitizedJobSnapshotContent } from '@career-os/shared';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  getOwnApplicationByJobId,
  upsertApplicationFromExtension,
  upsertApplicationWithSnapshot,
} from './applications';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

const BASE_ROW = {
  id: APPLICATION_ID,
  user_id: USER_ID,
  job_id: JOB_ID,
  resume_id: null,
  company: 'Acme',
  title: 'Backend Engineer',
  status: 'IN_PROGRESS',
  notes: null,
  applied_at: null,
  location: 'Remote',
  source_url: 'https://boards.example.com/job/123',
  canonical_url: 'https://boards.example.com/job/123',
  ats_provider: 'GENERIC',
  external_id: null,
  autofill_summary: null,
  unresolved_fields: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('getOwnApplicationByJobId', () => {
  it('scopes the query by both user_id and job_id', async () => {
    const eq = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = eq.mockImplementation(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnApplicationByJobId(supabase, USER_ID, JOB_ID);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('job_id', JOB_ID);
    expect(result?.id).toBe(APPLICATION_ID);
  });

  it('returns null when no application is tracked for the job', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnApplicationByJobId(supabase, USER_ID, JOB_ID);
    expect(result).toBeNull();
  });
});

describe('rowToApplication migration-observability warning (via getOwnApplicationByJobId)', () => {
  function chainReturning(row: unknown) {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    return { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
  }

  it('warns exactly once when a row is missing the migration 0008/0009 columns, and never crashes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A row shaped like one read from a database that never had migrations 0008/0009 applied
      // — the keys are absent entirely, not present-and-null.
      const { source_url: _sourceUrl, location: _location, ...rowMissingMigrationColumns } = BASE_ROW;

      const first = await getOwnApplicationByJobId(chainReturning(rowMissingMigrationColumns), USER_ID, JOB_ID);
      expect(first?.sourceUrl).toBeNull();
      expect(first?.location).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('migration 0008/0009');

      // A second row shaped the same way must not warn again (once per process, not once per row).
      await getOwnApplicationByJobId(chainReturning(rowMissingMigrationColumns), USER_ID, JOB_ID);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // A normally-shaped row (migration present) must not trigger any further warning either.
      await getOwnApplicationByJobId(chainReturning(BASE_ROW), USER_ID, JOB_ID);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('upsertApplicationFromExtension', () => {
  it('calls the upsert_application_from_extension RPC with the authenticated user id, not any client-supplied id', async () => {
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { application_id: APPLICATION_ID, created: true, final_status: 'SAVED', previous_status: null },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationFromExtension(supabase, USER_ID, {
      jobId: JOB_ID,
      company: 'Acme',
      title: 'Backend Engineer',
      location: null,
      status: 'SAVED',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: { approved: 0, filled: 0, skipped: 0, failed: 0, unresolved: 0, manual: 0 },
      unresolvedFields: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      'upsert_application_from_extension',
      expect.objectContaining({ p_user_id: USER_ID, p_job_id: JOB_ID }),
    );
    expect(result).toEqual({
      applicationId: APPLICATION_ID,
      created: true,
      status: 'SAVED',
      previousStatus: null,
    });
  });
});

const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

const BASE_SNAPSHOT_CONTENT: SanitizedJobSnapshotContent = {
  company: 'Acme',
  title: 'Backend Engineer',
  location: 'Remote',
  employmentType: 'Full-time',
  sourceUrl: 'https://boards.example.com/job/123',
  externalId: null,
  description: 'Build things.',
  requiredQualifications: ['5 years of Python'],
  preferredQualifications: [],
  responsibilities: [],
  skills: ['Python'],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  locations: ['Remote'],
  workMode: 'REMOTE',
  remoteLocationRestrictions: null,
  workAuthorizationLanguage: null,
  sourceType: 'GENERIC',
};

describe('upsertApplicationWithSnapshot', () => {
  it('calls the server-only upsert_application_with_snapshot RPC with the authenticated user id and links the snapshot when SAVED/IN_PROGRESS', async () => {
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          application_id: APPLICATION_ID,
          created: true,
          final_status: 'SAVED',
          previous_status: null,
          job_snapshot_id: SNAPSHOT_ID,
          snapshot_frozen: false,
        },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationWithSnapshot(supabase, USER_ID, {
      jobId: JOB_ID,
      status: 'SAVED',
      snapshot: BASE_SNAPSHOT_CONTENT,
      snapshotContentFingerprint: 'v1:abc123',
      snapshotContentTruncated: false,
      snapshotTruncatedFields: [],
      location: 'Remote',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: { approved: 0, filled: 0, skipped: 0, failed: 0, unresolved: 0, manual: 0 },
      unresolvedFields: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      'upsert_application_with_snapshot',
      expect.objectContaining({
        p_user_id: USER_ID,
        p_job_id: JOB_ID,
        p_snapshot_content_fingerprint: 'v1:abc123',
      }),
    );
    expect(result).toEqual({
      applicationId: APPLICATION_ID,
      created: true,
      status: 'SAVED',
      previousStatus: null,
      jobSnapshotId: SNAPSHOT_ID,
      snapshotFrozen: false,
    });
  });

  it('surfaces snapshotFrozen=true and the preserved (unchanged) jobSnapshotId when the application is already APPLIED', async () => {
    const EXISTING_SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999';
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          application_id: APPLICATION_ID,
          created: false,
          final_status: 'APPLIED',
          previous_status: 'APPLIED',
          job_snapshot_id: EXISTING_SNAPSHOT_ID,
          snapshot_frozen: true,
        },
        error: null,
      }),
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await upsertApplicationWithSnapshot(supabase, USER_ID, {
      jobId: JOB_ID,
      status: 'SAVED',
      snapshot: { ...BASE_SNAPSHOT_CONTENT, description: 'Re-analyzed, different content now.' },
      snapshotContentFingerprint: 'v1:different',
      snapshotContentTruncated: false,
      snapshotTruncatedFields: [],
      location: 'Remote',
      sourceUrl: 'https://boards.example.com/job/123',
      canonicalUrl: 'https://boards.example.com/job/123',
      atsProvider: 'GENERIC',
      externalId: null,
      autofillSummary: { approved: 0, filled: 0, skipped: 0, failed: 0, unresolved: 0, manual: 0 },
      unresolvedFields: [],
    });

    expect(result.snapshotFrozen).toBe(true);
    expect(result.jobSnapshotId).toBe(EXISTING_SNAPSHOT_ID);
  });
});
