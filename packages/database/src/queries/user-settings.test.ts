import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOrCreateOwnUserSettings, updateOwnAutoModeEnabled } from './user-settings';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const BASE_ROW = {
  user_id: USER_ID,
  gmail_integration_enabled: false,
  background_gmail_tracking_enabled: false,
  auto_mode_enabled: true,
  ai_requests_this_period: 0,
  ai_request_period_started_at: '2026-01-01T00:00:00.000Z',
  ai_request_limit: 50,
  theme: 'system',
};

describe('getOrCreateOwnUserSettings', () => {
  it('maps auto_mode_enabled through when present', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOrCreateOwnUserSettings(supabase, USER_ID);
    expect(result.autoModeEnabled).toBe(true);
  });

  it('degrades to false when the migration 0047 column is missing entirely (unmigrated database)', async () => {
    const { auto_mode_enabled: _omit, ...rowWithoutColumn } = BASE_ROW;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: rowWithoutColumn, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await getOrCreateOwnUserSettings(supabase, USER_ID);
    expect(result.autoModeEnabled).toBe(false);
  });
});

describe('updateOwnAutoModeEnabled', () => {
  it('updates only auto_mode_enabled, scoped by user_id', async () => {
    const selectChain: Record<string, unknown> = {};
    selectChain.select = vi.fn(() => selectChain);
    selectChain.eq = vi.fn(() => selectChain);
    selectChain.maybeSingle = vi.fn().mockResolvedValue({ data: BASE_ROW, error: null });

    const updateChain: Record<string, unknown> = {};
    updateChain.update = vi.fn(() => updateChain);
    updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });

    let callCount = 0;
    const from = vi.fn(() => {
      callCount += 1;
      return callCount === 1 ? selectChain : updateChain;
    });
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await updateOwnAutoModeEnabled(supabase, USER_ID, true);

    expect(updateChain.update).toHaveBeenCalledWith({ auto_mode_enabled: true });
    expect(updateChain.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });
});
