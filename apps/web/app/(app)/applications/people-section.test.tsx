// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOwnApplicationContacts: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnApplicationContacts: mocks.listOwnApplicationContacts,
}));

vi.mock('../network/contact-form', () => ({
  ContactForm: ({
    linkToApplicationId,
    initialValues,
  }: {
    linkToApplicationId?: string;
    initialValues?: { currentCompany?: string | null };
  }) => (
    <div data-testid="add-new-contact-form">
      linkToApplicationId: {linkToApplicationId}, prefillCompany: {initialValues?.currentCompany}
    </div>
  ),
}));
vi.mock('../network/unlink-button', () => ({
  UnlinkButton: ({ role }: { role: string }) => <button type="button">Unlink ({role})</button>,
}));
vi.mock('./link-existing-contact-form', () => ({
  LinkExistingContactForm: () => <div data-testid="link-existing-contact-form" />,
}));

const { PeopleSection } = await import('./people-section');

const SUPABASE = {} as never;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';

async function renderSection() {
  const element = await PeopleSection({
    supabase: SUPABASE,
    userId: USER_ID,
    applicationId: APPLICATION_ID,
    company: 'Acme',
  });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('PeopleSection', () => {
  it('shows an honest empty state with no linked contacts', async () => {
    mocks.listOwnApplicationContacts.mockResolvedValue([]);
    await renderSection();
    expect(screen.getByText('No people linked to this application yet.')).toBeInTheDocument();
  });

  it('lists a linked contact with its application-specific role and a link to /network/[id]', async () => {
    mocks.listOwnApplicationContacts.mockResolvedValue([
      {
        contact: {
          id: 'contact-1',
          displayName: 'Jane Doe',
          currentTitle: 'Recruiter',
          currentCompany: 'Acme',
        },
        role: 'REFERRER',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await renderSection();
    const link = screen.getByRole('link', { name: 'Jane Doe' });
    expect(link).toHaveAttribute('href', '/network/contact-1');
    expect(screen.getByText('Referrer')).toBeInTheDocument();
    expect(screen.getByText('Unlink (REFERRER)')).toBeInTheDocument();
  });

  it('renders the "link existing contact" panel', async () => {
    mocks.listOwnApplicationContacts.mockResolvedValue([]);
    await renderSection();
    expect(screen.getByText('Link existing contact')).toBeInTheDocument();
    expect(screen.getByTestId('link-existing-contact-form')).toBeInTheDocument();
  });

  it('prefills "Add new contact" with the application\'s company and links it to this application', async () => {
    mocks.listOwnApplicationContacts.mockResolvedValue([]);
    await renderSection();
    const form = screen.getByTestId('add-new-contact-form');
    expect(form).toHaveTextContent(`linkToApplicationId: ${APPLICATION_ID}`);
    expect(form).toHaveTextContent('prefillCompany: Acme');
  });
});
