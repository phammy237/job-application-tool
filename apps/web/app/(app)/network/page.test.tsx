// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  listOwnContacts: vi.fn(),
  listOwnContactTagsForContacts: vi.fn(),
  countOwnApplicationLinksForContacts: vi.fn(),
  listOwnContactsWithDueFollowUp: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnContacts: mocks.listOwnContacts,
  listOwnContactTagsForContacts: mocks.listOwnContactTagsForContacts,
  countOwnApplicationLinksForContacts: mocks.countOwnApplicationLinksForContacts,
  listOwnContactsWithDueFollowUp: mocks.listOwnContactsWithDueFollowUp,
}));

vi.mock('../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));

// ContactForm is a client component with its own dedicated tests — stub it here so this page
// test stays focused on the page's own list/search/empty-state rendering.
vi.mock('./contact-form', () => ({
  ContactForm: () => <div data-testid="contact-form-stub" />,
}));

const { default: NetworkPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_CLIENT = { tag: 'session-scoped' };

const CONTACT_A = {
  id: 'contact-a',
  displayName: 'Jane Doe',
  currentTitle: 'Recruiter',
  currentCompany: 'Acme',
  email: 'jane@example.com',
};

async function renderPage(searchParams: { q?: string } = {}) {
  const element = await NetworkPage({ searchParams: Promise.resolve(searchParams) });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.listOwnContactTagsForContacts.mockResolvedValue(new Map());
  mocks.countOwnApplicationLinksForContacts.mockResolvedValue(new Map());
  mocks.listOwnContactsWithDueFollowUp.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('NetworkPage', () => {
  it('shows a purposeful empty state (no giant empty table) with no contacts and no search term', async () => {
    mocks.listOwnContacts.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    expect(
      screen.getByText('Track recruiters, referrals, and people related to your applications.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a distinct empty state when a search matches nothing, also without a giant empty table', async () => {
    mocks.listOwnContacts.mockResolvedValue([]);
    await renderPage({ q: 'nobody' });
    expect(screen.getByText('No contacts match your search.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lists contacts with a link to their detail page', async () => {
    mocks.listOwnContacts.mockResolvedValue([CONTACT_A]);
    await renderPage();
    const link = screen.getByRole('link', { name: 'Jane Doe' });
    expect(link).toHaveAttribute('href', '/network/contact-a');
    expect(screen.getByText('Recruiter at Acme')).toBeInTheDocument();
  });

  it('passes the q search param through to listOwnContacts', async () => {
    mocks.listOwnContacts.mockResolvedValue([]);
    await renderPage({ q: 'jane' });
    expect(mocks.listOwnContacts).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, {
      search: 'jane',
    });
  });

  it('batches tag and application-count lookups instead of querying per row', async () => {
    mocks.listOwnContacts.mockResolvedValue([CONTACT_A, { ...CONTACT_A, id: 'contact-b' }]);
    await renderPage();
    expect(mocks.listOwnContactTagsForContacts).toHaveBeenCalledTimes(1);
    expect(mocks.listOwnContactTagsForContacts).toHaveBeenCalledWith(SESSION_CLIENT, USER_ID, [
      'contact-a',
      'contact-b',
    ]);
    expect(mocks.countOwnApplicationLinksForContacts).toHaveBeenCalledTimes(1);
  });

  describe('Follow-ups due', () => {
    it('shows an honest empty state with no due follow-ups', async () => {
      mocks.listOwnContacts.mockResolvedValue([]);
      mocks.listOwnContactsWithDueFollowUp.mockResolvedValue([]);
      await renderPage();
      expect(screen.getByText('No follow-ups due right now.')).toBeInTheDocument();
    });

    it('lists one due follow-up with a link to the contact', async () => {
      mocks.listOwnContacts.mockResolvedValue([]);
      mocks.listOwnContactsWithDueFollowUp.mockResolvedValue([
        { ...CONTACT_A, followUpAt: '2020-01-01T00:00:00.000Z' },
      ]);
      await renderPage();
      const link = screen.getByRole('link', { name: 'Jane Doe' });
      expect(link).toHaveAttribute('href', '/network/contact-a');
    });

    it('lists multiple due follow-ups in the order the query already returned them', async () => {
      mocks.listOwnContacts.mockResolvedValue([]);
      mocks.listOwnContactsWithDueFollowUp.mockResolvedValue([
        { ...CONTACT_A, id: 'contact-a', displayName: 'Alice', followUpAt: '2020-01-01T00:00:00.000Z' },
        { ...CONTACT_A, id: 'contact-b', displayName: 'Bob', followUpAt: '2020-01-02T00:00:00.000Z' },
      ]);
      await renderPage();
      const links = screen.getAllByRole('link', { name: /Alice|Bob/ });
      expect(links.map((l) => l.textContent)).toEqual(['Alice', 'Bob']);
    });

    it('scopes the due query to the caller with a computed now', async () => {
      mocks.listOwnContacts.mockResolvedValue([]);
      await renderPage();
      expect(mocks.listOwnContactsWithDueFollowUp).toHaveBeenCalledWith(
        SESSION_CLIENT,
        USER_ID,
        expect.any(String),
      );
    });
  });

  describe('follow-up column', () => {
    it('shows "No reminder" for a contact without one', async () => {
      mocks.listOwnContacts.mockResolvedValue([{ ...CONTACT_A, followUpAt: null }]);
      await renderPage();
      expect(screen.getByText('No reminder')).toBeInTheDocument();
    });

    it('does not show a future reminder in the Follow-ups due section', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      mocks.listOwnContacts.mockResolvedValue([{ ...CONTACT_A, followUpAt: future }]);
      mocks.listOwnContactsWithDueFollowUp.mockResolvedValue([]);
      await renderPage();
      expect(screen.getByText('No follow-ups due right now.')).toBeInTheDocument();
    });
  });
});
