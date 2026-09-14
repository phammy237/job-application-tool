import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  createOwnResume,
  deleteOwnResume,
  getOwnResume,
  listOwnResumes,
  updateOwnResume,
} from './resumes';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESUME_ID = '33333333-3333-4333-8333-333333333333';

const BASE_ROW = {
  id: RESUME_ID,
  user_id: USER_ID,
  name: 'Master Resume',
  kind: 'MASTER',
  parent_resume_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function chainReturningList(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
}

describe('listOwnResumes', () => {
  it('scopes by user_id', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    const eq = vi.fn(() => chain);
    chain.eq = eq;
    chain.order = vi.fn().mockResolvedValue({ data: [BASE_ROW], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnResumes(supabase, USER_ID);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('MASTER');
  });

  it('returns an empty array when the user has no resumes', async () => {
    const supabase = chainReturningList([]);
    const result = await listOwnResumes(supabase, USER_ID);
    expect(result).toEqual([]);
  });
});

describe('getOwnResume', () => {
  it('returns null when not found or not owned', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOwnResume(supabase, USER_ID, RESUME_ID);
    expect(result).toBeNull();
  });
});

describe('createOwnResume', () => {
  it('inserts with the given user_id, name, kind, and parent', async () => {
    const chain: Record<string, unknown> = {};
    chain.insert = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.single = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await createOwnResume(supabase, USER_ID, { name: 'Master Resume', kind: 'MASTER' });

    expect(chain.insert).toHaveBeenCalledWith({
      user_id: USER_ID,
      name: 'Master Resume',
      kind: 'MASTER',
      parent_resume_id: null,
    });
  });

  it('turns a unique-violation (second MASTER resume) into a friendly error', async () => {
    const chain: Record<string, unknown> = {};
    chain.insert = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await expect(
      createOwnResume(supabase, USER_ID, { name: 'Another Master', kind: 'MASTER' }),
    ).rejects.toThrow(/already have a master resume/);
  });
});

describe('updateOwnResume', () => {
  it('renames, scoped by id and user_id', async () => {
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn(() => chain);
    const eq = vi.fn(() => chain);
    chain.eq = eq;
    chain.select = vi.fn(() => chain);
    chain.single = vi
      .fn()
      .mockResolvedValue({ data: { ...BASE_ROW, name: 'Renamed' }, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await updateOwnResume(supabase, USER_ID, RESUME_ID, {
      name: 'Renamed',
    });

    expect(chain.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(eq).toHaveBeenCalledWith('id', RESUME_ID);
    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result.name).toBe('Renamed');
  });
});

describe('deleteOwnResume', () => {
  it('deletes, scoped by id and user_id', async () => {
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const deleteMock = vi.fn(() => ({ eq: firstEq }));
    const supabase = {
      from: vi.fn(() => ({ delete: deleteMock })),
    } as unknown as CareerOsSupabaseClient;

    await expect(deleteOwnResume(supabase, USER_ID, RESUME_ID)).resolves.toBeUndefined();
    expect(firstEq).toHaveBeenCalledWith('id', RESUME_ID);
    expect(secondEq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('turns a foreign-key violation (a submitted version exists) into a friendly error', async () => {
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

    await expect(deleteOwnResume(supabase, USER_ID, RESUME_ID)).rejects.toThrow(
      /cannot be deleted/,
    );
  });
});
