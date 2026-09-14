// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  getOwnContact: vi.fn(),
  listOwnContactTags: vi.fn(),
  listOwnApplicationsForContact: vi.fn(),
  listOwnApplications: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@career-os/database', () => ({
  getOwnContact: mocks.getOwnContact,
  listOwnContactTags: mocks.listOwnContactTags,
  listOwnApplicationsForContact: mocks.listOwnApplicationsForContact,
  listOwnApplications: mocks.listOwnApplications,
}));

vi.mock('../../../../lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

// Client subcomponents get their own dedicated tests — stubbed here so this page test stays
// focused on the detail page's own data assembly and rendering.
vi.mock('../contact-form', () => ({
  ContactForm: () => <div data-testid="contact-form-stub" />,
}));
vi.mock('../delete-contact-button', () => ({
  DeleteContactButton: ({ displayName }: { displayName: string }) => (
    <button type="button">Delete {displayName}</button>
  ),
}));
vi.mock('../unlink-button', () => ({
  UnlinkButton: () => <button type="button">Unlink</button>,
}));
vi.mock('./link-application-form', () => ({
  LinkApplicationForm: () => <div data-testid="link-application-form-stub" />,
}));
vi.mock('./interaction-timeline', () => ({
  InteractionTimeline: ({
    linkedApplications,
  }: {
    linkedApplications: { id: string; company: string; title: string }[];
  }) => (
    <div data-testid="interaction-timeline-stub">
      {linkedApplications.map((a) => a.id).join(',')}
    </div>
  ),
}));
vi.mock('./follow-up-reminder-controls', () => ({
  FollowUpReminderControls: ({ isDue }: { isDue: boolean }) => (
    <div data-testid="follow-up-reminder-controls-stub">{isDue ? 'due' : 'not-due'}</div>
  ),
}));

const { default: ContactDetailPage } = await import('./page');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_CLIENT = { tag: 'session-scoped' };

const BASE_CONTACT = {
  id: CONTACT_ID,
  userId: USER_ID,
  displayName: 'Jane Doe',
  firstName: null,
  lastName: null,
  email: 'jane@example.com',
  phone: null,
  linkedinUrl: null,
  currentCompany: 'Acme',
  currentTitle: 'Recruiter',
  location: null,
  notes: null,
  source: 'MANUAL',
  followUpAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renderPage() {
  const element = await ContactDetailPage({
    params: Promise.resolve({ id: CONTACT_ID }),
  });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue(SESSION_CLIENT);
  mocks.listOwnContactTags.mockResolvedValue([]);
  mocks.listOwnApplicationsForContact.mockResolvedValue([]);
  mocks.listOwnApplications.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('ContactDetailPage', () => {
  it('renders the owner’s contact', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('Recruiter at Acme')).toBeInTheDocument();
  });

  it('calls notFound (never leaking existence) when the contact is missing or not owned', async () => {
    mocks.getOwnContact.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('renders relationship tags', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    mocks.listOwnContactTags.mockResolvedValue(['RECRUITER', 'ALUMNI']);
    await renderPage();
    expect(screen.getByText('Recruiter')).toBeInTheDocument();
    expect(screen.getByText('Alumni')).toBeInTheDocument();
  });

  it('shows linked applications with role and a link to the application', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    mocks.listOwnApplicationsForContact.mockResolvedValue([
      {
        application: {
          id: 'app-1',
          company: 'Acme',
          title: 'Backend Engineer',
          status: 'INTERVIEW',
        },
        role: 'INTERVIEWER',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await renderPage();
    const link = screen.getByRole('link', { name: 'Acme — Backend Engineer' });
    expect(link).toHaveAttribute('href', '/applications/app-1');
    expect(screen.getByText('Interviewer')).toBeInTheDocument();
  });

  it('shows an honest empty state when not linked to any application', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    await renderPage();
    expect(screen.getByText('Not linked to any applications yet.')).toBeInTheDocument();
  });

  it('renders the edit form and a delete button', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    await renderPage();
    expect(screen.getByTestId('contact-form-stub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Jane Doe' })).toBeInTheDocument();
  });

  it('passes the contact’s own linked applications through to the interaction timeline', async () => {
    mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
    mocks.listOwnApplicationsForContact.mockResolvedValue([
      {
        application: {
          id: 'app-1',
          company: 'Acme',
          title: 'Backend Engineer',
          status: 'INTERVIEW',
        },
        role: 'INTERVIEWER',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await renderPage();
    expect(screen.getByTestId('interaction-timeline-stub')).toHaveTextContent('app-1');
  });

  describe('follow-up reminder', () => {
    it('shows "no reminder set" when follow_up_at is null', async () => {
      mocks.getOwnContact.mockResolvedValue(BASE_CONTACT);
      await renderPage();
      expect(screen.getByText('No follow-up reminder set.')).toBeInTheDocument();
      expect(screen.getByTestId('follow-up-reminder-controls-stub')).toHaveTextContent(
        'not-due',
      );
    });

    it('shows a factual "follow up on" state for a future reminder', async () => {
      mocks.getOwnContact.mockResolvedValue({
        ...BASE_CONTACT,
        followUpAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      });
      await renderPage();
      expect(screen.getByText(/^Follow up on /)).toBeInTheDocument();
      expect(screen.getByTestId('follow-up-reminder-controls-stub')).toHaveTextContent(
        'not-due',
      );
    });

    it('shows a due state for a past reminder', async () => {
      mocks.getOwnContact.mockResolvedValue({
        ...BASE_CONTACT,
        followUpAt: '2020-01-01T00:00:00.000Z',
      });
      await renderPage();
      expect(screen.getByText(/^Follow-up reminder due: /)).toBeInTheDocument();
      expect(screen.getByTestId('follow-up-reminder-controls-stub')).toHaveTextContent('due');
    });

    it('never uses judgmental language like "neglected" or "overdue"', async () => {
      mocks.getOwnContact.mockResolvedValue({
        ...BASE_CONTACT,
        followUpAt: '2020-01-01T00:00:00.000Z',
      });
      await renderPage();
      expect(document.body.textContent?.toLowerCase()).not.toMatch(/neglect|overdue/);
    });
  });
});
