// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOwnContactInteractions: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  listOwnContactInteractions: mocks.listOwnContactInteractions,
}));

vi.mock('../interaction-form', () => ({
  InteractionForm: ({ mode }: { mode: string }) => (
    <div data-testid={`interaction-form-${mode}`} />
  ),
}));
vi.mock('../delete-interaction-button', () => ({
  DeleteInteractionButton: () => <button type="button">Delete</button>,
}));

const { InteractionTimeline } = await import('./interaction-timeline');

const SUPABASE = {} as never;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const LINKED_APPLICATIONS = [{ id: 'app-1', company: 'Acme', title: 'Backend Engineer' }];

async function renderTimeline() {
  const element = await InteractionTimeline({
    supabase: SUPABASE,
    userId: USER_ID,
    contactId: CONTACT_ID,
    linkedApplications: LINKED_APPLICATIONS,
  });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('InteractionTimeline', () => {
  it('shows an honest empty state with no interactions', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([]);
    await renderTimeline();
    expect(screen.getByText('No interactions logged yet.')).toBeInTheDocument();
  });

  it('never suggests AI in the empty state', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([]);
    await renderTimeline();
    expect(screen.queryByText(/AI/i)).not.toBeInTheDocument();
  });

  it('lists an interaction with type, direction, subject, and notes', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([
      {
        id: 'i1',
        userId: USER_ID,
        contactId: CONTACT_ID,
        interactionType: 'COFFEE_CHAT',
        direction: 'MUTUAL',
        occurredAt: '2026-01-15T09:05:00.000Z',
        subject: 'Discussed PM internship',
        notes: 'Went well, follow up in a week.',
        applicationId: null,
        source: 'MANUAL',
        createdAt: '2026-01-15T09:05:00.000Z',
        updatedAt: '2026-01-15T09:05:00.000Z',
      },
    ]);
    await renderTimeline();
    expect(screen.getByText('Coffee chat')).toBeInTheDocument();
    expect(screen.getByText('Mutual')).toBeInTheDocument();
    expect(screen.getByText('Discussed PM internship')).toBeInTheDocument();
    expect(screen.getByText('Went well, follow up in a week.')).toBeInTheDocument();
  });

  it('shows a human-readable related application, not a raw UUID, linking to the application', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([
      {
        id: 'i1',
        userId: USER_ID,
        contactId: CONTACT_ID,
        interactionType: 'MEETING',
        direction: null,
        occurredAt: '2026-01-15T09:05:00.000Z',
        subject: null,
        notes: null,
        applicationId: 'app-1',
        source: 'MANUAL',
        createdAt: '2026-01-15T09:05:00.000Z',
        updatedAt: '2026-01-15T09:05:00.000Z',
      },
    ]);
    await renderTimeline();
    const link = screen.getByRole('link', { name: 'Backend Engineer — Acme' });
    expect(link).toHaveAttribute('href', '/applications/app-1');
    expect(screen.queryByText('app-1')).not.toBeInTheDocument();
  });

  it('renders edit and delete affordances per interaction', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([
      {
        id: 'i1',
        userId: USER_ID,
        contactId: CONTACT_ID,
        interactionType: 'EMAIL',
        direction: 'INBOUND',
        occurredAt: '2026-01-15T09:05:00.000Z',
        subject: null,
        notes: null,
        applicationId: null,
        source: 'MANUAL',
        createdAt: '2026-01-15T09:05:00.000Z',
        updatedAt: '2026-01-15T09:05:00.000Z',
      },
    ]);
    await renderTimeline();
    expect(screen.getByTestId('interaction-form-edit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders the "Log interaction" create form', async () => {
    mocks.listOwnContactInteractions.mockResolvedValue([]);
    await renderTimeline();
    expect(screen.getByText('Log interaction')).toBeInTheDocument();
    expect(screen.getByTestId('interaction-form-create')).toBeInTheDocument();
  });
});
