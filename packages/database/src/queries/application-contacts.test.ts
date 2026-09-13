import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  countOwnApplicationLinksForContacts,
  linkOwnContactToApplication,
  listOwnApplicationContacts,
  listOwnApplicationsForContact,
  unlinkOwnContactFromApplication,
} from './application-contacts';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';

function thenableChain(finalResult: unknown, overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.then = (resolve: (r: unknown) => void) => resolve(finalResult);
  Object.assign(chain, overrides);
  return chain;
}

describe('listOwnApplicationContacts', () => {
  it('joins link rows with their contacts and attaches role', async () => {
    const linksChain = thenableChain({
      data: [{ contact_id: CONTACT_ID, role: 'REFERRER', created_at: '2026-01-01T00:00:00.000Z' }],
      error: null,
    });
    const contactsChain = thenableChain({
      data: [
        {
          id: CONTACT_ID,
          user_id: USER_ID,
          display_name: 'Jane Doe',
          first_name: null,
          last_name: null,
          email: null,
          phone: null,
          linkedin_url: null,
          current_company: null,
          current_title: null,
          location: null,
          notes: null,
          source: 'MANUAL',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linksChain : contactsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationContacts(supabase, USER_ID, APPLICATION_ID);

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('REFERRER');
    expect(result[0]?.contact.displayName).toBe('Jane Doe');
  });

  it('returns an empty array without a second query when there are no links', async () => {
    const linksChain = thenableChain({ data: [], error: null });
    const from = vi.fn(() => linksChain);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationContacts(supabase, USER_ID, APPLICATION_ID);

    expect(result).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('silently drops a link whose contact no longer resolves (defensive, should not throw)', async () => {
    const linksChain = thenableChain({
      data: [{ contact_id: CONTACT_ID, role: 'REFERRER', created_at: '2026-01-01T00:00:00.000Z' }],
      error: null,
    });
    const contactsChain = thenableChain({ data: [], error: null });
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linksChain : contactsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationContacts(supabase, USER_ID, APPLICATION_ID);
    expect(result).toEqual([]);
  });
});

describe('listOwnApplicationsForContact', () => {
  it('joins link rows with their applications and attaches role', async () => {
    const linksChain = thenableChain({
      data: [
        { application_id: APPLICATION_ID, role: 'INTERVIEWER', created_at: '2026-01-01T00:00:00.000Z' },
      ],
      error: null,
    });
    const appsChain = thenableChain({
      data: [{ id: APPLICATION_ID, company: 'Acme', title: 'Backend Engineer', status: 'INTERVIEW' }],
      error: null,
    });
    const from = vi.fn((table: string) =>
      table === 'application_contacts' ? linksChain : appsChain,
    );
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    const result = await listOwnApplicationsForContact(supabase, USER_ID, CONTACT_ID);

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('INTERVIEWER');
    expect(result[0]?.application.company).toBe('Acme');
  });
});

describe('countOwnApplicationLinksForContacts', () => {
  it('returns an empty map without querying for an empty id list', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await countOwnApplicationLinksForContacts(supabase, USER_ID, []);
    expect(result.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('counts distinct applications per contact, not link rows — two roles on one application still counts once', async () => {
    const chain = thenableChain({
      data: [
        { contact_id: 'c1', application_id: 'app-1' },
        { contact_id: 'c1', application_id: 'app-1' }, // same contact+application, second role
        { contact_id: 'c1', application_id: 'app-2' },
        { contact_id: 'c2', application_id: 'app-1' },
      ],
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await countOwnApplicationLinksForContacts(supabase, USER_ID, ['c1', 'c2']);
    expect(result.get('c1')).toBe(2);
    expect(result.get('c2')).toBe(1);
  });
});

describe('linkOwnContactToApplication', () => {
  it('inserts a link row scoped to the caller', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as CareerOsSupabaseClient;

    await linkOwnContactToApplication(supabase, USER_ID, {
      applicationId: APPLICATION_ID,
      contactId: CONTACT_ID,
      role: 'REFERRER',
    });

    expect(insert).toHaveBeenCalledWith({
      user_id: USER_ID,
      application_id: APPLICATION_ID,
      contact_id: CONTACT_ID,
      role: 'REFERRER',
    });
  });

  it('maps a duplicate-link unique violation to a friendly error', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as CareerOsSupabaseClient;

    await expect(
      linkOwnContactToApplication(supabase, USER_ID, {
        applicationId: APPLICATION_ID,
        contactId: CONTACT_ID,
        role: 'REFERRER',
      }),
    ).rejects.toThrow('This contact already has that role on this application.');
  });

  it('surfaces any other database error as-is', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23503', message: 'fk violation' } });
    const supabase = { from: vi.fn(() => ({ insert })) } as unknown as CareerOsSupabaseClient;

    await expect(
      linkOwnContactToApplication(supabase, USER_ID, {
        applicationId: APPLICATION_ID,
        contactId: CONTACT_ID,
        role: 'REFERRER',
      }),
    ).rejects.toThrow('fk violation');
  });
});

describe('unlinkOwnContactFromApplication', () => {
  it('scopes the delete by user_id, application_id, contact_id, and role', async () => {
    const chain = thenableChain({ error: null });
    chain.delete = vi.fn(() => chain);
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await unlinkOwnContactFromApplication(supabase, USER_ID, {
      applicationId: APPLICATION_ID,
      contactId: CONTACT_ID,
      role: 'INTERVIEWER',
    });

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.eq).toHaveBeenCalledWith('application_id', APPLICATION_ID);
    expect(chain.eq).toHaveBeenCalledWith('contact_id', CONTACT_ID);
    expect(chain.eq).toHaveBeenCalledWith('role', 'INTERVIEWER');
  });
});
