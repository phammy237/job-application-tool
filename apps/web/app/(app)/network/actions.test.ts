import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createOwnContact: vi.fn(),
  updateOwnContact: vi.fn(),
  deleteOwnContact: vi.fn(),
  findOwnPossibleDuplicateContacts: vi.fn(),
  linkOwnContactToApplication: vi.fn(),
  unlinkOwnContactFromApplication: vi.fn(),
  listOwnContacts: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnContact: mocks.createOwnContact,
  updateOwnContact: mocks.updateOwnContact,
  deleteOwnContact: mocks.deleteOwnContact,
  findOwnPossibleDuplicateContacts: mocks.findOwnPossibleDuplicateContacts,
  linkOwnContactToApplication: mocks.linkOwnContactToApplication,
  unlinkOwnContactFromApplication: mocks.unlinkOwnContactFromApplication,
  listOwnContacts: mocks.listOwnContacts,
}));

vi.mock('../../../lib/auth', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const {
  createContactAction,
  updateContactAction,
  deleteContactAction,
  searchOwnContactsAction,
  linkContactToApplicationAction,
  unlinkContactFromApplicationAction,
} = await import('./actions');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_CLIENT = { tag: 'session-scoped' };

const VALID_INPUT = { displayName: 'Jane Doe' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.findOwnPossibleDuplicateContacts.mockResolvedValue([]);
});

describe('createContactAction', () => {
  it('creates the contact when no duplicates are found', async () => {
    mocks.createOwnContact.mockResolvedValue({ id: CONTACT_ID });

    const result = await createContactAction(VALID_INPUT);

    expect(mocks.findOwnPossibleDuplicateContacts).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      expect.objectContaining({ displayName: 'Jane Doe' }),
    );
    expect(mocks.createOwnContact).toHaveBeenCalled();
    expect(result).toEqual({ status: 'ok', contactId: CONTACT_ID });
  });

  it('returns possible_duplicates and does not create when duplicates are found', async () => {
    const duplicate = { contact: { id: 'other' }, reason: 'EMAIL_MATCH' };
    mocks.findOwnPossibleDuplicateContacts.mockResolvedValue([duplicate]);

    const result = await createContactAction(VALID_INPUT);

    expect(mocks.createOwnContact).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'possible_duplicates', duplicates: [duplicate] });
  });

  it('skips the duplicate check and creates anyway when force is true', async () => {
    mocks.createOwnContact.mockResolvedValue({ id: CONTACT_ID });
    mocks.findOwnPossibleDuplicateContacts.mockResolvedValue([
      { contact: { id: 'other' }, reason: 'EMAIL_MATCH' },
    ]);

    const result = await createContactAction(VALID_INPUT, { force: true });

    expect(mocks.findOwnPossibleDuplicateContacts).not.toHaveBeenCalled();
    expect(mocks.createOwnContact).toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });

  it('links the new contact to an application when linkToApplication is given', async () => {
    mocks.createOwnContact.mockResolvedValue({ id: CONTACT_ID });

    await createContactAction(VALID_INPUT, {
      linkToApplication: { applicationId: APPLICATION_ID, role: 'REFERRER' },
    });

    expect(mocks.linkOwnContactToApplication).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      applicationId: APPLICATION_ID,
      contactId: CONTACT_ID,
      role: 'REFERRER',
    });
  });

  it('does not link when linkToApplication is not given', async () => {
    mocks.createOwnContact.mockResolvedValue({ id: CONTACT_ID });
    await createContactAction(VALID_INPUT);
    expect(mocks.linkOwnContactToApplication).not.toHaveBeenCalled();
  });

  it('returns a validation error and calls nothing else for an invalid input', async () => {
    const result = await createContactAction({ displayName: '' });

    expect(result.status).toBe('error');
    expect(mocks.findOwnPossibleDuplicateContacts).not.toHaveBeenCalled();
    expect(mocks.createOwnContact).not.toHaveBeenCalled();
  });
});

describe('updateContactAction', () => {
  it('excludes the contact being edited from its own duplicate check', async () => {
    mocks.updateOwnContact.mockResolvedValue({ id: CONTACT_ID });

    await updateContactAction(CONTACT_ID, { displayName: 'Jane' });

    expect(mocks.findOwnPossibleDuplicateContacts).toHaveBeenCalledWith(
      SESSION_CLIENT,
      USER_ID,
      expect.any(Object),
      CONTACT_ID,
    );
  });

  it('returns possible_duplicates without saving when a duplicate is found', async () => {
    mocks.findOwnPossibleDuplicateContacts.mockResolvedValue([
      { contact: { id: 'other' }, reason: 'NAME_COMPANY_MATCH' },
    ]);

    const result = await updateContactAction(CONTACT_ID, { displayName: 'Jane' });

    expect(mocks.updateOwnContact).not.toHaveBeenCalled();
    expect(result.status).toBe('possible_duplicates');
  });
});

describe('deleteContactAction', () => {
  it('deletes the contact scoped to the caller', async () => {
    await deleteContactAction(CONTACT_ID);
    expect(mocks.deleteOwnContact).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, CONTACT_ID);
  });
});

describe('searchOwnContactsAction', () => {
  it('passes the query through as the search filter', async () => {
    mocks.listOwnContacts.mockResolvedValue([]);
    await searchOwnContactsAction('jane');
    expect(mocks.listOwnContacts).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      search: 'jane',
    });
  });

  it('treats an empty query as no filter', async () => {
    mocks.listOwnContacts.mockResolvedValue([]);
    await searchOwnContactsAction('');
    expect(mocks.listOwnContacts).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      search: undefined,
    });
  });
});

describe('linkContactToApplicationAction', () => {
  it('links with a valid role', async () => {
    const result = await linkContactToApplicationAction(APPLICATION_ID, CONTACT_ID, 'REFERRER');
    expect(mocks.linkOwnContactToApplication).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      applicationId: APPLICATION_ID,
      contactId: CONTACT_ID,
      role: 'REFERRER',
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('rejects an invalid role without calling the database', async () => {
    const result = await linkContactToApplicationAction(APPLICATION_ID, CONTACT_ID, 'NOT_A_ROLE');
    expect(mocks.linkOwnContactToApplication).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
  });

  it('surfaces a database error (e.g. duplicate link) as a friendly result', async () => {
    mocks.linkOwnContactToApplication.mockRejectedValue(
      new Error('This contact already has that role on this application.'),
    );
    const result = await linkContactToApplicationAction(APPLICATION_ID, CONTACT_ID, 'REFERRER');
    expect(result).toEqual({
      status: 'error',
      message: 'This contact already has that role on this application.',
    });
  });
});

describe('unlinkContactFromApplicationAction', () => {
  it('unlinks scoped to the caller', async () => {
    await unlinkContactFromApplicationAction(APPLICATION_ID, CONTACT_ID, 'INTERVIEWER');
    expect(mocks.unlinkOwnContactFromApplication).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      applicationId: APPLICATION_ID,
      contactId: CONTACT_ID,
      role: 'INTERVIEWER',
    });
  });
});
