import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOrCreateOwnEligibilityProfile, updateOwnEligibilityProfile } from './discovery-eligibility-profiles';

const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const BASE_ROW = {
  user_id: USER_ID,
  currently_authorized_to_work: null,
  requires_sponsorship_now: null,
  requires_sponsorship_future: null,
  is_us_citizen: null,
  has_active_security_clearance: null,
  eligible_to_obtain_security_clearance: null,
  graduation_year: null,
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

describe('getOrCreateOwnEligibilityProfile', () => {
  it('every field defaults to null (unanswered), never a guessed value', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: null, error: null },
      singleResult: { data: BASE_ROW, error: null },
    });
    const result = await getOrCreateOwnEligibilityProfile(supabase, USER_ID);
    expect(result.requiresSponsorshipFuture).toBeNull();
    expect(result.isUsCitizen).toBeNull();
    expect(result.graduationYear).toBeNull();
  });
});

describe('updateOwnEligibilityProfile', () => {
  it('allows setting a boolean field to false explicitly (distinct from null/unanswered)', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: BASE_ROW, error: null },
      singleResult: { data: { ...BASE_ROW, requires_sponsorship_now: false }, error: null },
    });
    await updateOwnEligibilityProfile(supabase, USER_ID, { requiresSponsorshipNow: false });
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({ requires_sponsorship_now: false });
  });

  it('only includes explicitly-provided fields', async () => {
    const supabase = fakeSupabase({
      selectResult: { data: BASE_ROW, error: null },
      singleResult: { data: BASE_ROW, error: null },
    });
    await updateOwnEligibilityProfile(supabase, USER_ID, { graduationYear: 2028 });
    const chain = (supabase as unknown as { _chain: { update: ReturnType<typeof vi.fn> } })._chain;
    const [payload] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({ graduation_year: 2028 });
  });
});
