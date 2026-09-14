// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionForm } from './interaction-form';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createInteractionAction: vi.fn(),
  updateInteractionAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('./actions', () => ({
  createInteractionAction: mocks.createInteractionAction,
  updateInteractionAction: mocks.updateInteractionAction,
}));

const CONTACT_ID = 'contact-1';
const INTERACTION_ID = 'interaction-1';
const LINKED_APPLICATIONS = [{ id: 'app-1', company: 'Acme', title: 'Backend Engineer' }];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('InteractionForm', () => {
  it('requires only type and date/time — every other field is optional', async () => {
    render(
      <InteractionForm mode="create" contactId={CONTACT_ID} linkedApplications={[]} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Type *')).toBeInTheDocument());
    expect(screen.getByLabelText('Type *')).toBeRequired();
    expect(screen.getByLabelText('Date/time *')).toBeRequired();
    expect(screen.getByLabelText('Direction')).not.toBeRequired();
    expect(screen.getByLabelText('Subject')).not.toBeRequired();
  });

  it('defaults the date/time to now for a new interaction', async () => {
    render(
      <InteractionForm mode="create" contactId={CONTACT_ID} linkedApplications={[]} />,
    );
    await waitFor(() => {
      const input = screen.getByLabelText('Date/time *') as HTMLInputElement;
      expect(input.value).not.toBe('');
    });
  });

  it('only offers the contact’s own linked applications in the picker', async () => {
    render(
      <InteractionForm
        mode="create"
        contactId={CONTACT_ID}
        linkedApplications={LINKED_APPLICATIONS}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Related application')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('option', { name: 'Acme — Backend Engineer' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
  });

  it('submits a new interaction scoped to the contact', async () => {
    mocks.createInteractionAction.mockResolvedValue({
      status: 'ok',
      interactionId: INTERACTION_ID,
    });
    render(
      <InteractionForm mode="create" contactId={CONTACT_ID} linkedApplications={[]} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Type *')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Type *'), {
      target: { value: 'COFFEE_CHAT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log interaction' }));

    await waitFor(() => expect(mocks.createInteractionAction).toHaveBeenCalled());
    const [contactId, input] = mocks.createInteractionAction.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(contactId).toBe(CONTACT_ID);
    expect(input.interactionType).toBe('COFFEE_CHAT');
    expect(typeof input.occurredAt).toBe('string');
  });

  it('prefills fields in edit mode and calls updateInteractionAction, not create', async () => {
    mocks.updateInteractionAction.mockResolvedValue({
      status: 'ok',
      interactionId: INTERACTION_ID,
    });
    render(
      <InteractionForm
        mode="edit"
        contactId={CONTACT_ID}
        interactionId={INTERACTION_ID}
        linkedApplications={LINKED_APPLICATIONS}
        initialValues={{
          interactionType: 'MEETING',
          occurredAt: '2026-01-15T09:05:00.000Z',
          direction: 'OUTBOUND',
          subject: 'Intro call',
          notes: 'Went well.',
          applicationId: 'app-1',
        }}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Type *') as HTMLSelectElement).value).toBe(
        'MEETING',
      ),
    );
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe(
      'Intro call',
    );
    expect((screen.getByLabelText('Direction') as HTMLSelectElement).value).toBe(
      'OUTBOUND',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mocks.updateInteractionAction).toHaveBeenCalledWith(
        CONTACT_ID,
        INTERACTION_ID,
        expect.objectContaining({ interactionType: 'MEETING' }),
      ),
    );
    expect(mocks.createInteractionAction).not.toHaveBeenCalled();
  });

  it('shows an error message returned by the server action instead of navigating', async () => {
    mocks.createInteractionAction.mockResolvedValue({
      status: 'error',
      message: 'This application is not linked to this contact.',
    });
    render(
      <InteractionForm mode="create" contactId={CONTACT_ID} linkedApplications={[]} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Type *')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Log interaction' }));

    await waitFor(() =>
      expect(
        screen.getByText('This application is not linked to this contact.'),
      ).toBeInTheDocument(),
    );
  });
});
