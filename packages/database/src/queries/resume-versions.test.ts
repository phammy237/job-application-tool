import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  countOwnResumeVersionsForResumes,
  createOwnResumeVersion,
  deleteOwnResumeVersion,
  getOwnResumeVersion,
  listOwnResumeVersionsForResume,
} from './resume-versions';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';

const BASE_ROW = {
  id: VERSION_ID,
  user_id: USER_ID,
  resume_id: RESUME_ID,
  version_number: 1,
  display_name: 'My Resume -- Acme -- Engineer',
  snapshot_format: 'METADATA_ONLY',
  snapshot_payload: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('listOwnResumeVersionsForResume', () => {
  it('scopes by user_id and resume_id, newest version first', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    const eq = vi.fn(() => chain);
    chain.eq = eq;
    chain.order = vi.fn().mockResolvedValue({ data: [BASE_ROW], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnResumeVersionsForResume(supabase, USER_ID, RESUME_ID);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).toHaveBeenCalledWith('resume_id', RESUME_ID);
    expect(chain.order).toHaveBeenCalledWith('version_number', { ascending: false });
    expect(result).toHaveLength(1);
  });
});

describe('getOwnResumeVersion', () => {
  it('returns null when not found or not owned', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    expect(await getOwnResumeVersion(supabase, USER_ID, VERSION_ID)).toBeNull();
  });
});

describe('createOwnResumeVersion', () => {
  it('calls the create_resume_version RPC with the authenticated user id, never trusting a client-supplied version number', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await createOwnResumeVersion(supabase, USER_ID, {
      resumeId: RESUME_ID,
      displayName: 'My Resume -- Acme -- Engineer',
    });

    expect(rpc).toHaveBeenCalledWith('create_resume_version', {
      p_user_id: USER_ID,
      p_resume_id: RESUME_ID,
      p_display_name: 'My Resume -- Acme -- Engineer',
    });
    expect(result.versionNumber).toBe(1);
  });
});

describe('deleteOwnResumeVersion', () => {
  it('deletes, scoped by id and user_id', async () => {
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const deleteMock = vi.fn(() => ({ eq: firstEq }));
    const supabase = {
      from: vi.fn(() => ({ delete: deleteMock })),
    } as unknown as CareerOsSupabaseClient;

    await expect(
      deleteOwnResumeVersion(supabase, USER_ID, VERSION_ID),
    ).resolves.toBeUndefined();
  });

  it('turns a foreign-key violation (this version was submitted) into a friendly error, not a raw Postgres message', async () => {
    const deleteMock = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi
          .fn()
          .mockResolvedValue({ error: { code: '23503', message: 'fk violation' } }),
      })),
    }));
    const supabase = {
      from: vi.fn(() => ({ delete: deleteMock })),
    } as unknown as CareerOsSupabaseClient;

    await expect(deleteOwnResumeVersion(supabase, USER_ID, VERSION_ID)).rejects.toThrow(
      /submitted application and cannot be deleted/,
    );
  });
});

describe('countOwnResumeVersionsForResumes', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await countOwnResumeVersionsForResumes(supabase, USER_ID, []);
    expect(result.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('counts versions per resume in one batched query', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn().mockResolvedValue({
      data: [{ resume_id: RESUME_ID }, { resume_id: RESUME_ID }],
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await countOwnResumeVersionsForResumes(supabase, USER_ID, [RESUME_ID]);
    expect(result.get(RESUME_ID)).toBe(2);
  });
});
