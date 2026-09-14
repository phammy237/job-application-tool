// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpReminderControls } from './follow-up-reminder-controls';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  setContactFollowUpAction: vi.fn(),
  clearContactFollowUpAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('../actions', () => ({
  setContactFollowUpAction: mocks.setContactFollowUpAction,
  clearContactFollowUpAction: mocks.clearContactFollowUpAction,
}));

const CONTACT_ID = 'contact-1';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('FollowUpReminderControls', () => {
  it('shows "Set follow-up reminder" when no reminder exists', () => {
    render(
      <FollowUpReminderControls contactId={CONTACT_ID} followUpAt={null} isDue={false} />,
    );
    expect(screen.getByRole('button', { name: 'Set follow-up reminder' })).toBeInTheDocument();
  });

  it('opens the date/time form after clicking "Set follow-up reminder"', () => {
    render(
      <FollowUpReminderControls contactId={CONTACT_ID} followUpAt={null} isDue={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set follow-up reminder' }));
    expect(screen.getByLabelText('Follow up on')).toBeInTheDocument();
  });

  it('shows "Change" and "Clear" for a future (not due) reminder', () => {
    render(
      <FollowUpReminderControls
        contactId={CONTACT_ID}
        followUpAt="2027-01-01T00:00:00.000Z"
        isDue={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
  });

  it('shows "Mark done" and "Reschedule" for a due reminder', () => {
    render(
      <FollowUpReminderControls
        contactId={CONTACT_ID}
        followUpAt="2020-01-01T00:00:00.000Z"
        isDue={true}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('calls setContactFollowUpAction with a real ISO timestamp on save', async () => {
    mocks.setContactFollowUpAction.mockResolvedValue({ status: 'ok' });
    render(
      <FollowUpReminderControls contactId={CONTACT_ID} followUpAt={null} isDue={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set follow-up reminder' }));
    fireEvent.change(screen.getByLabelText('Follow up on'), {
      target: { value: '2027-06-15T09:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.setContactFollowUpAction).toHaveBeenCalled());
    const [contactId, input] = mocks.setContactFollowUpAction.mock.calls[0] as [
      string,
      { followUpAt: string },
    ];
    expect(contactId).toBe(CONTACT_ID);
    expect(typeof input.followUpAt).toBe('string');
    expect(input.followUpAt).not.toContain('T09:00$'); // real ISO, not the raw local value
  });

  it('shows a server-returned error instead of closing the form', async () => {
    mocks.setContactFollowUpAction.mockResolvedValue({
      status: 'error',
      message: 'Choose a valid date and time.',
    });
    render(
      <FollowUpReminderControls contactId={CONTACT_ID} followUpAt={null} isDue={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set follow-up reminder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText('Choose a valid date and time.')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Follow up on')).toBeInTheDocument();
  });

  it('calls clearContactFollowUpAction when "Mark done" is clicked, with no other side effect', async () => {
    render(
      <FollowUpReminderControls
        contactId={CONTACT_ID}
        followUpAt="2020-01-01T00:00:00.000Z"
        isDue={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(mocks.clearContactFollowUpAction).toHaveBeenCalledWith(CONTACT_ID));
    expect(mocks.setContactFollowUpAction).not.toHaveBeenCalled();
  });

  it('calls clearContactFollowUpAction when "Clear" is clicked on a future reminder', async () => {
    render(
      <FollowUpReminderControls
        contactId={CONTACT_ID}
        followUpAt="2027-01-01T00:00:00.000Z"
        isDue={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mocks.clearContactFollowUpAction).toHaveBeenCalledWith(CONTACT_ID));
  });

  it('"Cancel" returns to the display state without saving', () => {
    render(
      <FollowUpReminderControls contactId={CONTACT_ID} followUpAt={null} isDue={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set follow-up reminder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Set follow-up reminder' })).toBeInTheDocument();
    expect(mocks.setContactFollowUpAction).not.toHaveBeenCalled();
  });
});
