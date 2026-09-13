// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactForm } from './contact-form';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));

vi.mock('./actions', () => ({
  createContactAction: mocks.createContactAction,
  updateContactAction: mocks.updateContactAction,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ContactForm', () => {
  it('requires only a name — every other field is optional', () => {
    render(<ContactForm mode="create" />);
    expect(screen.getByLabelText('Name *')).toBeRequired();
    expect(screen.getByLabelText('Email')).not.toBeRequired();
    expect(screen.getByLabelText('Company')).not.toBeRequired();
  });

  it('creates the contact and navigates to its detail page on success', async () => {
    mocks.createContactAction.mockResolvedValue({ status: 'ok', contactId: 'contact-1' });
    render(<ContactForm mode="create" />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    await waitFor(() => expect(mocks.createContactAction).toHaveBeenCalled());
    expect(mocks.createContactAction.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Jane Doe' });
    expect(mocks.createContactAction.mock.calls[0]?.[1]).toMatchObject({ force: false });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/network/contact-1'));
  });

  it('shows a duplicate warning instead of navigating away when the server flags one', async () => {
    mocks.createContactAction.mockResolvedValue({
      status: 'possible_duplicates',
      duplicates: [
        {
          contact: { id: 'existing-1', displayName: 'Jane D.', currentCompany: 'Acme' },
          reason: 'EMAIL_MATCH',
        },
      ],
    });
    render(<ContactForm mode="create" />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    await waitFor(() => expect(screen.getByText('This may already exist')).toBeInTheDocument());
    expect(screen.getByText('Jane D.')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('"Create anyway" resubmits with force and does not silently reuse the existing contact', async () => {
    mocks.createContactAction.mockResolvedValueOnce({
      status: 'possible_duplicates',
      duplicates: [
        { contact: { id: 'existing-1', displayName: 'Jane D.', currentCompany: null }, reason: 'EMAIL_MATCH' },
      ],
    });
    mocks.createContactAction.mockResolvedValueOnce({ status: 'ok', contactId: 'new-contact' });
    render(<ContactForm mode="create" />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await waitFor(() => expect(screen.getByText('This may already exist')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create anyway' }));

    await waitFor(() => expect(mocks.createContactAction).toHaveBeenCalledTimes(2));
    expect(mocks.createContactAction.mock.calls[1]?.[1]).toMatchObject({ force: true });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/network/new-contact'));
  });

  it('"Cancel" on the duplicate warning returns to the editable form without saving', async () => {
    mocks.createContactAction.mockResolvedValue({
      status: 'possible_duplicates',
      duplicates: [
        { contact: { id: 'existing-1', displayName: 'Jane D.', currentCompany: null }, reason: 'EMAIL_MATCH' },
      ],
    });
    render(<ContactForm mode="create" />);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    await waitFor(() => expect(screen.getByText('This may already exist')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    expect(mocks.createContactAction).toHaveBeenCalledTimes(1);
  });

  it('edit mode calls updateContactAction with the given contactId, not createContactAction', async () => {
    mocks.updateContactAction.mockResolvedValue({ status: 'ok', contactId: 'contact-1' });
    render(
      <ContactForm
        mode="edit"
        contactId="contact-1"
        initialValues={{
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
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateContactAction).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({ displayName: 'Jane Doe' }),
      { force: false },
    ));
    expect(mocks.createContactAction).not.toHaveBeenCalled();
    // Edit mode never navigates away — it stays on the same detail page.
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not navigate to a new contact page when linking from application context', async () => {
    mocks.createContactAction.mockResolvedValue({ status: 'ok', contactId: 'contact-1' });
    render(<ContactForm mode="create" linkToApplicationId="app-1" />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    await waitFor(() => expect(mocks.createContactAction).toHaveBeenCalled());
    expect(mocks.createContactAction.mock.calls[0]?.[1]).toMatchObject({
      linkToApplication: { applicationId: 'app-1', role: expect.any(String) },
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
