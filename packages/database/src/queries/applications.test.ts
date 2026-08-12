import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOwnApplicationByJobId, upsertApplicationFromExtension } from './applications';

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
