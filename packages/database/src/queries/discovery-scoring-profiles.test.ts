import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOrCreateOwnScoringProfile, updateOwnScoringProfile } from './discovery-scoring-profiles';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const BASE_ROW = {
  user_id: USER_ID,
  profile_version: 'v1',
  preset: 'BALANCED',
  criteria_weights: { ROLE_FIT: 7, COMPETENCY_FIT: 7 },
  role_preferences: {},
  seniority_preferences: {},
  location_preferences: {},
  work_mode_preferences: {},
  employment_type_preferences: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function fakeSupabase(overrides: {
  selectResult?: { data: unknown; error: null };
  singleResult?: { data: unknown; error: null };
}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi
    .fn()
    .mockResolvedValue(overrides.selectResult ?? { data: null, error: null });
  chain.single = vi.fn().mockResolvedValue(overrides.singleResult ?? { data: BASE_ROW, error: null });
  return { from: vi.fn(() => chain), _chain: chain } as unknown as CareerOsSupabaseClient & {
    _chain: Record<string, unknown>;
  };
}

describe('getOrCreateOwnScoringProfile', () => {
  it('returns the existing profile without inserting when one already exists', async () => {
    const supabase = fakeSupabase({ selectResult: { data: BASE_ROW, error: null } });
    const result = await getOrCreateOwnScoringProfile(supabase, USER_ID);
    expect(result.preset).toBe('BALANCED');
    const chain = (supabase as unknown as { _chain: { insert: ReturnType<typeof vi.fn> } })._chain;
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it('creates a default row (DB column defaults) when none exists yet', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: null, error: null },
      singleResult: { data: BASE_ROW, error: null },
    });
    const result = await getOrCreateOwnScoringProfile(supabase, USER_ID);
    expect(result.userId).toBe(USER_ID);
    const chain = (supabase as unknown as { _chain: { insert: ReturnType<typeof vi.fn> } })._chain;
    expect(chain.insert).toHaveBeenCalledWith({ user_id: USER_ID });
  });
});

describe('updateOwnScoringProfile', () => {
  it('only includes explicitly-provided fields in the update payload', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: BASE_ROW, error: null },
      singleResult: { data: BASE_ROW, error: null },
    });
    await updateOwnScoringProfile(supabase, USER_ID, { preset: 'CUSTOM' });
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({ preset: 'CUSTOM' });
  });

  it('translates every camelCase field to its snake_case column', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: BASE_ROW, error: null },
      singleResult: { data: BASE_ROW, error: null },
    });
    await updateOwnScoringProfile(supabase, USER_ID, {
      criteriaWeights: { ROLE_FIT: 10 },
      rolePreferences: { PRODUCT_MANAGEMENT: 9 },
      locationPreferences: { NEW_YORK_NY: 'PREFERRED' },
    });
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload.criteria_weights).toEqual({ ROLE_FIT: 10 });
    expect(payload.role_preferences).toEqual({ PRODUCT_MANAGEMENT: 9 });
    expect(payload.location_preferences).toEqual({ NEW_YORK_NY: 'PREFERRED' });
  });
});
