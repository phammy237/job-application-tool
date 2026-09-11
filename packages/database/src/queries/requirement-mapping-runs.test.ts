import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  createOwnPendingRequirementMappingRun,
  getCurrentOwnRequirementMappingRun,
  getOwnRequirementMappingRunById,
  markOwnRequirementMappingRunFailed,
} from './requirement-mapping-runs';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

describe('getCurrentOwnRequirementMappingRun', () => {
  it('scopes the query by user_id, job_snapshot_id, and status=CURRENT', async () => {
    const eq = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = eq.mockImplementation(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: RUN_ID,
        user_id: USER_ID,
        job_snapshot_id: SNAPSHOT_ID,
        status: 'CURRENT',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        prompt_version: 'requirement-evidence-v1',
        retrieval_fact_count: 10,
        failure_category: null,
        created_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:01:00.000Z',
        failed_at: null,
      },
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getCurrentOwnRequirementMappingRun(
      supabase,
      USER_ID,
      SNAPSHOT_ID,
    );

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('job_snapshot_id', SNAPSHOT_ID);
    expect(eq).toHaveBeenCalledWith('status', 'CURRENT');
    expect(result?.status).toBe('CURRENT');
  });

  it('returns null when no CURRENT run exists', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getCurrentOwnRequirementMappingRun(
      supabase,
      USER_ID,
      SNAPSHOT_ID,
    );
    expect(result).toBeNull();
  });
});

describe('getOwnRequirementMappingRunById', () => {
  it('scopes the query by user_id and id (no status filter — finds a SUPERSEDED run too)', async () => {
    const eq = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = eq.mockImplementation(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: RUN_ID,
        user_id: USER_ID,
        job_snapshot_id: SNAPSHOT_ID,
        status: 'SUPERSEDED',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        prompt_version: 'requirement-evidence-v1',
        retrieval_fact_count: 10,
        failure_category: null,
        created_at: '2026-01-01T00:00:00.000Z',
        completed_at: '2026-01-01T00:01:00.000Z',
        failed_at: null,
      },
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnRequirementMappingRunById(supabase, USER_ID, RUN_ID);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('id', RUN_ID);
    expect(eq).not.toHaveBeenCalledWith('status', expect.anything());
    expect(result?.status).toBe('SUPERSEDED');
  });

  it('returns null when no run with that id is owned by this user', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnRequirementMappingRunById(supabase, USER_ID, RUN_ID);
    expect(result).toBeNull();
  });
});

describe('createOwnPendingRequirementMappingRun', () => {
  it('calls the server-only RPC with the authenticated user id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: RUN_ID, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await createOwnPendingRequirementMappingRun(supabase, USER_ID, {
      jobSnapshotId: SNAPSHOT_ID,
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      promptVersion: 'requirement-evidence-v1',
      retrievalFactCount: 12,
    });

    expect(rpc).toHaveBeenCalledWith(
      'create_pending_requirement_mapping_run',
      expect.objectContaining({ p_user_id: USER_ID, p_job_snapshot_id: SNAPSHOT_ID }),
    );
    expect(result).toBe(RUN_ID);
  });
});

describe('markOwnRequirementMappingRunFailed', () => {
  it('returns true when the run actually transitioned', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;
    const result = await markOwnRequirementMappingRunFailed(
      supabase,
      USER_ID,
      RUN_ID,
      'provider_error',
    );
    expect(result).toBe(true);
  });

  it('returns false (idempotent no-op) when the run was already terminal', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;
    const result = await markOwnRequirementMappingRunFailed(
      supabase,
      USER_ID,
      RUN_ID,
      'refusal',
    );
    expect(result).toBe(false);
  });
});
