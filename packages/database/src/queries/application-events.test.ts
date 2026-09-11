import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  listOwnRecentApplicationEvents,
  revertApplicationEvent,
} from './application-events';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const NEW_EVENT_ID = '66666666-6666-4666-8666-666666666666';

const APPLIED_EVENT_ROW = {
  id: EVENT_ID,
  user_id: USER_ID,
  application_id: APPLICATION_ID,
  event_type: 'STATUS_CHANGE',
  from_status: 'APPLIED',
  to_status: 'INTERVIEW',
  source: 'USER',
  email_signal_id: null,
  reverted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const NON_APPLIED_EVENT_ROW = {
  ...APPLIED_EVENT_ROW,
  from_status: 'SAVED',
  to_status: 'IN_PROGRESS',
};

const RECORDED_EVENT_ROW = {
  id: NEW_EVENT_ID,
  user_id: USER_ID,
  application_id: APPLICATION_ID,
  event_type: 'STATUS_CHANGE',
  from_status: 'INTERVIEW',
  to_status: 'APPLIED',
  source: 'SYSTEM',
  email_signal_id: null,
  reverted_at: null,
  created_at: '2026-01-02T00:00:00.000Z',
};

/** A chain object that supports both an explicit terminal call (.single()/.maybeSingle()) and
 * being awaited directly after .eq() chaining (the update-only call sites never call a terminal
 * method at all) — covering every usage shape revertApplicationEvent actually exercises. */
function makeChain(terminal: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> & PromiseLike<typeof terminal> = {
    then: (resolve: (value: typeof terminal) => unknown) => resolve(terminal),
  } as never;
  chain.select = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(terminal));
  chain.maybeSingle = vi.fn(() => Promise.resolve(terminal));
  return chain;
}

function ok(data: unknown) {
  return { data, error: null };
}

let fromMock: ReturnType<typeof vi.fn>;

function supabaseWith(...chains: ReturnType<typeof makeChain>[]) {
  fromMock = vi.fn();
  for (const chain of chains) {
    fromMock.mockReturnValueOnce(chain);
  }
  return { from: fromMock } as unknown as CareerOsSupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('revertApplicationEvent — reverting to a non-APPLIED status', () => {
  it('never checks applied_at at all when fromStatus is not APPLIED', async () => {
    const supabase = supabaseWith(
      makeChain(ok(NON_APPLIED_EVENT_ROW)), // fetch the event
      makeChain(ok(null)), // applications update
      makeChain(ok(null)), // application_events mark-reverted update
      makeChain(ok(RECORDED_EVENT_ROW)), // recordApplicationEvent insert
    );

    const result = await revertApplicationEvent(supabase, USER_ID, EVENT_ID);

    expect(fromMock).toHaveBeenCalledTimes(4);
    expect(result.id).toBe(NEW_EVENT_ID);
  });
});

describe('revertApplicationEvent — reverting to APPLIED (Phase 5B hardening)', () => {
  it('succeeds when the application genuinely has a non-null applied_at', async () => {
    const supabase = supabaseWith(
      makeChain(ok(APPLIED_EVENT_ROW)), // fetch the event
      makeChain(ok({ applied_at: '2025-06-01T00:00:00.000Z' })), // applied_at verification
      makeChain(ok(null)), // applications update (restoring status = 'APPLIED')
      makeChain(ok(null)), // application_events mark-reverted update
      makeChain(ok(RECORDED_EVENT_ROW)), // recordApplicationEvent insert
    );

    const result = await revertApplicationEvent(supabase, USER_ID, EVENT_ID);

    expect(fromMock).toHaveBeenCalledTimes(5);
    expect(result.id).toBe(NEW_EVENT_ID);
  });

  it('refuses when the application has never actually been applied (applied_at is null) — never trusts the event log alone', async () => {
    const supabase = supabaseWith(
      makeChain(ok(APPLIED_EVENT_ROW)), // fetch the (possibly fabricated) event
      makeChain(ok({ applied_at: null })), // applied_at verification fails
    );

    await expect(revertApplicationEvent(supabase, USER_ID, EVENT_ID)).rejects.toThrow(
      /ever having been genuinely applied/,
    );

    // The actual applications-table write must never even be attempted.
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('refuses when the application row cannot be found at all (fabricated applicationId)', async () => {
    const supabase = supabaseWith(
      makeChain(ok(APPLIED_EVENT_ROW)),
      makeChain(ok(null)), // maybeSingle finds nothing
    );

    await expect(revertApplicationEvent(supabase, USER_ID, EVENT_ID)).rejects.toThrow(
      /ever having been genuinely applied/,
    );
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});

describe('revertApplicationEvent — guard rails unrelated to APPLIED', () => {
  it('rejects a non-STATUS_CHANGE event before ever touching applications', async () => {
    const supabase = supabaseWith(
      makeChain(ok({ ...NON_APPLIED_EVENT_ROW, event_type: 'NOTE' })),
    );

    await expect(revertApplicationEvent(supabase, USER_ID, EVENT_ID)).rejects.toThrow(
      /Only STATUS_CHANGE events can be reverted/,
    );
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an already-reverted event before ever touching applications', async () => {
    const supabase = supabaseWith(
      makeChain(
        ok({ ...NON_APPLIED_EVENT_ROW, reverted_at: '2026-01-01T00:00:00.000Z' }),
      ),
    );

    await expect(revertApplicationEvent(supabase, USER_ID, EVENT_ID)).rejects.toThrow(
      /already been reverted/,
    );
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});

describe('listOwnRecentApplicationEvents', () => {
  it('scopes by user_id, orders newest first, and applies the given limit — across all applications, not one', async () => {
    const eq = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limitFn = vi.fn();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = eq.mockImplementation(() => chain);
    chain.order = order.mockImplementation(() => chain);
    chain.limit = limitFn.mockImplementation(() =>
      Promise.resolve({ data: [NON_APPLIED_EVENT_ROW], error: null }),
    );
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnRecentApplicationEvents(supabase, USER_ID, 10);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(eq).not.toHaveBeenCalledWith('application_id', expect.anything());
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limitFn).toHaveBeenCalledWith(10);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(EVENT_ID);
  });

  it('returns an empty array rather than throwing when there are no events at all', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnRecentApplicationEvents(supabase, USER_ID, 10);
    expect(result).toEqual([]);
  });
});
