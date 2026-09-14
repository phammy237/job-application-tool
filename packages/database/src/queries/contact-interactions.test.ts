import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  createOwnContactInteraction,
  deleteOwnContactInteraction,
  getOwnContactInteraction,
  listOwnContactInteractions,
  updateOwnContactInteraction,
} from './contact-interactions';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const INTERACTION_ID = '55555555-5555-4555-8555-555555555555';

const BASE_ROW = {
  id: INTERACTION_ID,
  user_id: USER_ID,
  contact_id: CONTACT_ID,
  interaction_type: 'EMAIL',
  direction: null,
  occurred_at: '2026-01-01T00:00:00.000Z',
  subject: null,
  notes: null,
  application_id: null,
  source: 'MANUAL',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  (chain as { then?: unknown }).then = (resolve: (r: unknown) => void) =>
    resolve({ data: [], error: null });
  Object.assign(chain, overrides);
  return chain;
}

describe('listOwnContactInteractions', () => {
  it('scopes by user_id and contact_id, ordered occurred_at desc then created_at desc', async () => {
    const chain = makeChain({
      order: vi.fn(() => chain),
    });
    // Final .order() call's return value is awaited directly.
    let orderCalls = 0;
    chain.order = vi.fn((..._args: unknown[]) => {
      orderCalls += 1;
      if (orderCalls === 2) {
        return Promise.resolve({ data: [BASE_ROW], error: null });
      }
      return chain;
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnContactInteractions(supabase, USER_ID, CONTACT_ID);

    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.eq).toHaveBeenCalledWith('contact_id', CONTACT_ID);
    expect(chain.order).toHaveBeenNthCalledWith(1, 'occurred_at', { ascending: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false });
    expect(result).toHaveLength(1);
    expect(result[0]?.interactionType).toBe('EMAIL');
  });

  it('returns an empty array when there are no interactions', async () => {
    const chain = makeChain();
    let orderCalls = 0;
    chain.order = vi.fn(() => {
      orderCalls += 1;
      return orderCalls === 2 ? Promise.resolve({ data: [], error: null }) : chain;
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
    const result = await listOwnContactInteractions(supabase, USER_ID, CONTACT_ID);
    expect(result).toEqual([]);
  });
});

describe('getOwnContactInteraction / row mapping', () => {
  it('scopes by id and user_id, and maps nullable fields through', async () => {
    const chain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const interaction = await getOwnContactInteraction(supabase, USER_ID, INTERACTION_ID);

    expect(chain.eq).toHaveBeenCalledWith('id', INTERACTION_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(interaction?.direction).toBeNull();
    expect(interaction?.applicationId).toBeNull();
    expect(interaction?.source).toBe('MANUAL');
  });

  it('returns null when not found', async () => {
    const chain = makeChain();
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
    const interaction = await getOwnContactInteraction(supabase, USER_ID, INTERACTION_ID);
    expect(interaction).toBeNull();
  });
});

describe('createOwnContactInteraction', () => {
  const MINIMAL_INPUT = {
    interactionType: 'EMAIL' as const,
    occurredAt: '2026-01-01T00:00:00.000Z',
    direction: null,
    subject: null,
    notes: null,
    applicationId: null,
  };

  it('creates a minimal interaction, always with source MANUAL', async () => {
    const chain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const interaction = await createOwnContactInteraction(
      supabase,
      USER_ID,
      CONTACT_ID,
      MINIMAL_INPUT,
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        contact_id: CONTACT_ID,
        interaction_type: 'EMAIL',
        source: 'MANUAL',
      }),
    );
    expect(interaction.id).toBe(INTERACTION_ID);
  });

  it('validates the application is linked to the contact before creating', async () => {
    const linkChain = makeChain({
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { application_id: APPLICATION_ID }, error: null }),
    });
    const interactionsChain = makeChain({
      single: vi.fn().mockResolvedValue({
        data: { ...BASE_ROW, application_id: APPLICATION_ID },
        error: null,
      }),
    });
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linkChain : interactionsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await createOwnContactInteraction(supabase, USER_ID, CONTACT_ID, {
      ...MINIMAL_INPUT,
      applicationId: APPLICATION_ID,
    });

    expect(linkChain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(linkChain.eq).toHaveBeenCalledWith('contact_id', CONTACT_ID);
    expect(linkChain.eq).toHaveBeenCalledWith('application_id', APPLICATION_ID);
    expect(interactionsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ application_id: APPLICATION_ID }),
    );
  });

  it('rejects an application that is not linked to the contact', async () => {
    const linkChain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const interactionsChain = makeChain();
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linkChain : interactionsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await expect(
      createOwnContactInteraction(supabase, USER_ID, CONTACT_ID, {
        ...MINIMAL_INPUT,
        applicationId: APPLICATION_ID,
      }),
    ).rejects.toThrow('This application is not linked to this contact');
    expect(interactionsChain.insert).not.toHaveBeenCalled();
  });

  it('skips application-link validation entirely when no applicationId is given', async () => {
    const linkChain = makeChain();
    const interactionsChain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linkChain : interactionsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await createOwnContactInteraction(supabase, USER_ID, CONTACT_ID, MINIMAL_INPUT);

    expect(from).not.toHaveBeenCalledWith('application_contacts');
  });
});

describe('updateOwnContactInteraction', () => {
  it('throws a clear error when the interaction does not exist or is not owned', async () => {
    const chain = makeChain();
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await expect(
      updateOwnContactInteraction(supabase, USER_ID, INTERACTION_ID, { subject: 'x' }),
    ).rejects.toThrow('interaction not found or not owned by this user');
  });

  it('validates a newly-set applicationId against the interaction’s own contactId', async () => {
    const fetchChain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const linkChain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const from = vi.fn((table: string) => {
      if (table === 'application_contacts') return linkChain;
      return fetchChain;
    });
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await expect(
      updateOwnContactInteraction(supabase, USER_ID, INTERACTION_ID, {
        applicationId: APPLICATION_ID,
      }),
    ).rejects.toThrow('This application is not linked to this contact');
    expect(linkChain.eq).toHaveBeenCalledWith('contact_id', CONTACT_ID);
  });

  it('updates the given fields, scoped by id and user_id', async () => {
    const chain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
      single: vi
        .fn()
        .mockResolvedValue({ data: { ...BASE_ROW, subject: 'Updated' }, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await updateOwnContactInteraction(supabase, USER_ID, INTERACTION_ID, {
      subject: 'Updated',
    });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Updated' }),
    );
    expect(chain.eq).toHaveBeenCalledWith('id', INTERACTION_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result.subject).toBe('Updated');
  });

  it('allows clearing applicationId to null without re-validating linkage', async () => {
    const fetchChain = makeChain({
      maybeSingle: vi
        .fn()
        .mockResolvedValue({
          data: { ...BASE_ROW, application_id: APPLICATION_ID },
          error: null,
        }),
      single: vi
        .fn()
        .mockResolvedValue({ data: { ...BASE_ROW, application_id: null }, error: null }),
    });
    const linkChain = makeChain();
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linkChain : fetchChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await updateOwnContactInteraction(supabase, USER_ID, INTERACTION_ID, {
      applicationId: null,
    });

    expect(from).not.toHaveBeenCalledWith('application_contacts');
    expect(fetchChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ application_id: null }),
    );
  });
});

describe('deleteOwnContactInteraction', () => {
  it('scopes the delete by id and user_id', async () => {
    const chain = makeChain();
    (chain as { then?: unknown }).then = (resolve: (r: unknown) => void) =>
      resolve({ error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await deleteOwnContactInteraction(supabase, USER_ID, INTERACTION_ID);

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', INTERACTION_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });
});
