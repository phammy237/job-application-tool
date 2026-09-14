import { describe, expect, it, vi } from 'vitest';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  clearOwnContactFollowUp,
  createOwnContact,
  deleteOwnContact,
  findOwnPossibleDuplicateContacts,
  getOwnContact,
  listOwnContactTags,
  listOwnContactTagsForContacts,
  listOwnContacts,
  listOwnContactsWithDueFollowUp,
  replaceOwnContactTags,
  setOwnContactFollowUp,
  updateOwnContact,
} from './contacts';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';

const BASE_ROW = {
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
  follow_up_at: null,
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
  chain.in = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.order = vi.fn().mockResolvedValue({ data: [], error: null });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  Object.assign(chain, overrides);
  return chain;
}

describe('getOwnContact / rowToContact', () => {
  it('scopes by id and user_id, and maps nullable fields through', async () => {
    const chain = makeChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const contact = await getOwnContact(supabase, USER_ID, CONTACT_ID);

    expect(chain.eq).toHaveBeenCalledWith('id', CONTACT_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(contact?.displayName).toBe('Jane Doe');
    expect(contact?.email).toBeNull();
    expect(contact?.source).toBe('MANUAL');
  });

  it('returns null when no row is found', async () => {
    const chain = makeChain();
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;
    const contact = await getOwnContact(supabase, USER_ID, CONTACT_ID);
    expect(contact).toBeNull();
  });
});

describe('listOwnContacts', () => {
  it('filters only by user_id when no search term is given', async () => {
    const chain = makeChain();
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await listOwnContacts(supabase, USER_ID);

    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.or).not.toHaveBeenCalled();
  });

  it('searches display_name, current_company, current_title, and email', async () => {
    const chain = makeChain();
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await listOwnContacts(supabase, USER_ID, { search: 'jane' });

    expect(chain.or).toHaveBeenCalledWith(
      'display_name.ilike.%jane%,current_company.ilike.%jane%,' +
        'current_title.ilike.%jane%,email.ilike.%jane%',
    );
  });
});

describe('createOwnContact', () => {
  it('inserts identity/detail columns and the source, requiring only displayName', async () => {
    const chain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const contact = await createOwnContact(supabase, USER_ID, {
      displayName: 'Jane Doe',
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      linkedinUrl: null,
      currentCompany: null,
      currentTitle: null,
      location: null,
      notes: null,
      source: 'MANUAL',
      tags: [],
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID, display_name: 'Jane Doe', source: 'MANUAL' }),
    );
    expect(contact.id).toBe(CONTACT_ID);
  });

  it('writes initial tags when provided', async () => {
    const contactsChain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const tagsChain = makeChain();
    tagsChain.delete = vi.fn(() => tagsChain);
    tagsChain.insert = vi.fn().mockResolvedValue({ error: null });

    const from = vi.fn((table: string) => (table === 'contacts' ? contactsChain : tagsChain));
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await createOwnContact(supabase, USER_ID, {
      displayName: 'Jane Doe',
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      linkedinUrl: null,
      currentCompany: null,
      currentTitle: null,
      location: null,
      notes: null,
      source: 'MANUAL',
      tags: ['RECRUITER', 'ALUMNI'],
    });

    expect(tagsChain.delete).toHaveBeenCalled();
    expect(tagsChain.insert).toHaveBeenCalledWith([
      { user_id: USER_ID, contact_id: CONTACT_ID, tag: 'RECRUITER' },
      { user_id: USER_ID, contact_id: CONTACT_ID, tag: 'ALUMNI' },
    ]);
  });

  it('does not touch contact_tags when no tags are given', async () => {
    const contactsChain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const from = vi.fn(() => contactsChain);
    const supabase = { from } as unknown as CareerOsSupabaseClient;

    await createOwnContact(supabase, USER_ID, {
      displayName: 'Jane Doe',
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      linkedinUrl: null,
      currentCompany: null,
      currentTitle: null,
      location: null,
      notes: null,
      source: 'MANUAL',
      tags: [],
    });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('contacts');
  });
});

describe('updateOwnContact', () => {
  it('scopes the update by id and user_id', async () => {
    const chain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await updateOwnContact(supabase, USER_ID, CONTACT_ID, { currentTitle: 'Engineer' });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ current_title: 'Engineer' }),
    );
    expect(chain.eq).toHaveBeenCalledWith('id', CONTACT_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
  });
});

describe('deleteOwnContact', () => {
  it('scopes the delete by id and user_id', async () => {
    const chain = makeChain();
    chain.delete = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    (chain as { then?: unknown }).then = (resolve: (r: unknown) => void) =>
      resolve({ error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await deleteOwnContact(supabase, USER_ID, CONTACT_ID);

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenNthCalledWith(1, 'id', CONTACT_ID);
    expect(chain.eq).toHaveBeenNthCalledWith(2, 'user_id', USER_ID);
  });
});

describe('listOwnContactTags', () => {
  it('parses each tag through the tag schema', async () => {
    const chain = makeChain();
    chain.eq = vi.fn(() => chain);
    // Final call in listOwnContactTags is the second .eq() — make the chain thenable.
    (chain as { then?: unknown }).then = (resolve: (r: unknown) => void) =>
      resolve({ data: [{ tag: 'RECRUITER' }, { tag: 'ALUMNI' }], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const tags = await listOwnContactTags(supabase, USER_ID, CONTACT_ID);
    expect(tags).toEqual(['RECRUITER', 'ALUMNI']);
  });
});

describe('listOwnContactTagsForContacts', () => {
  it('returns an empty map without querying for an empty id list', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as CareerOsSupabaseClient;
    const result = await listOwnContactTagsForContacts(supabase, USER_ID, []);
    expect(result.size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('groups multiple tags per contact_id', async () => {
    const chain = makeChain();
    chain.in = vi.fn(() => chain);
    (chain as { then?: unknown }).then = (resolve: (r: unknown) => void) =>
      resolve({
        data: [
          { contact_id: 'c1', tag: 'RECRUITER' },
          { contact_id: 'c1', tag: 'ALUMNI' },
          { contact_id: 'c2', tag: 'MENTOR' },
        ],
        error: null,
      });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnContactTagsForContacts(supabase, USER_ID, ['c1', 'c2']);
    expect(result.get('c1')).toEqual(['RECRUITER', 'ALUMNI']);
    expect(result.get('c2')).toEqual(['MENTOR']);
  });
});

describe('replaceOwnContactTags', () => {
  it('deletes existing tags then inserts the new set', async () => {
    const chain = makeChain();
    chain.delete = vi.fn(() => chain);
    chain.insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await replaceOwnContactTags(supabase, USER_ID, CONTACT_ID, ['MENTOR']);

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: USER_ID, contact_id: CONTACT_ID, tag: 'MENTOR' },
    ]);
  });

  it('skips the insert call entirely when clearing all tags', async () => {
    const chain = makeChain();
    chain.delete = vi.fn(() => chain);
    chain.insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    await replaceOwnContactTags(supabase, USER_ID, CONTACT_ID, []);

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.insert).not.toHaveBeenCalled();
  });
});

describe('findOwnPossibleDuplicateContacts', () => {
  it('flags an existing contact with a matching email', async () => {
    const chain = makeChain({
      order: vi.fn().mockResolvedValue({
        data: [{ ...BASE_ROW, email: 'jane@example.com' }],
        error: null,
      }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await findOwnPossibleDuplicateContacts(supabase, USER_ID, {
      displayName: 'Someone New',
      email: 'jane@example.com',
      linkedinUrl: null,
      currentCompany: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe('EMAIL_MATCH');
  });

  it('excludes the contact being edited from its own duplicate results', async () => {
    const chain = makeChain({
      order: vi.fn().mockResolvedValue({
        data: [{ ...BASE_ROW, email: 'jane@example.com' }],
        error: null,
      }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await findOwnPossibleDuplicateContacts(
      supabase,
      USER_ID,
      { displayName: 'Jane Doe', email: 'jane@example.com', linkedinUrl: null, currentCompany: null },
      CONTACT_ID,
    );

    expect(result).toHaveLength(0);
  });
});

describe('setOwnContactFollowUp', () => {
  it('sets follow_up_at scoped to id and user_id', async () => {
    const chain = makeChain({
      single: vi
        .fn()
        .mockResolvedValue({ data: { ...BASE_ROW, follow_up_at: '2026-06-14T12:00:00.000Z' }, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const contact = await setOwnContactFollowUp(
      supabase,
      USER_ID,
      CONTACT_ID,
      '2026-06-14T12:00:00.000Z',
    );

    expect(chain.update).toHaveBeenCalledWith({ follow_up_at: '2026-06-14T12:00:00.000Z' });
    expect(chain.eq).toHaveBeenCalledWith('id', CONTACT_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(contact.followUpAt).toBe('2026-06-14T12:00:00.000Z');
  });
});

describe('clearOwnContactFollowUp', () => {
  it('nulls follow_up_at scoped to id and user_id, and does nothing else', async () => {
    const chain = makeChain({
      single: vi.fn().mockResolvedValue({ data: BASE_ROW, error: null }),
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const contact = await clearOwnContactFollowUp(supabase, USER_ID, CONTACT_ID);

    expect(chain.update).toHaveBeenCalledWith({ follow_up_at: null });
    expect(chain.eq).toHaveBeenCalledWith('id', CONTACT_ID);
    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(contact.followUpAt).toBeNull();
  });
});

describe('listOwnContactsWithDueFollowUp', () => {
  it('filters by user_id, non-null follow_up_at, and <= now, ordered earliest first', async () => {
    const chain = makeChain();
    chain.order = vi.fn().mockResolvedValue({
      data: [{ ...BASE_ROW, follow_up_at: '2026-06-14T12:00:00.000Z' }],
      error: null,
    });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnContactsWithDueFollowUp(supabase, USER_ID, '2026-06-15T00:00:00.000Z');

    expect(chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(chain.not).toHaveBeenCalledWith('follow_up_at', 'is', null);
    expect(chain.lte).toHaveBeenCalledWith('follow_up_at', '2026-06-15T00:00:00.000Z');
    expect(chain.order).toHaveBeenCalledWith('follow_up_at', { ascending: true });
    expect(result).toHaveLength(1);
  });

  it('returns an empty array when nothing is due', async () => {
    const chain = makeChain();
    chain.order = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = { from: vi.fn(() => chain) } as unknown as CareerOsSupabaseClient;

    const result = await listOwnContactsWithDueFollowUp(supabase, USER_ID, '2026-06-15T00:00:00.000Z');
    expect(result).toEqual([]);
  });
});
