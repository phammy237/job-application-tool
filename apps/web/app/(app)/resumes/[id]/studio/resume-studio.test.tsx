// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createEmptyStructuredResume } from '@career-os/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeStudio } from './resume-studio';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  saveNewStructuredResumeVersion: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('./actions', () => ({
  saveNewStructuredResumeVersion: mocks.saveNewStructuredResumeVersion,
}));

const HEADER = {
  fullName: 'Ada Lovelace',
  email: null,
  phone: null,
  location: null,
  links: {},
};

function baseResume() {
  return createEmptyStructuredResume(HEADER);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

describe('ResumeStudio — loading and header editing', () => {
  it('loads the header fields from the initial content', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel="version 1"
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    expect(screen.getByLabelText('Full name *')).toHaveValue('Ada Lovelace');
    expect(screen.getByText('Based on version 1')).toBeInTheDocument();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('marks the draft dirty after an edit and reflects it in the live LaTeX preview', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Full name *'), {
      target: { value: 'Grace Hopper' },
    });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getAllByText(/Grace Hopper/).length).toBeGreaterThan(0);
  });
});

describe('ResumeStudio — entry sections', () => {
  it('adds, edits, and removes an experience entry', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    expect(screen.getByText('No experience entry entries yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Add experience entry' }));
    expect(
      screen.queryByText('No experience entry entries yet.'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Organization *'), {
      target: { value: 'Acme Corp' },
    });
    fireEvent.change(screen.getByPlaceholderText('Role *'), {
      target: { value: 'Engineer' },
    });
    expect(screen.getAllByText(/Acme Corp/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove experience entry' }));
    expect(screen.getByText('No experience entry entries yet.')).toBeInTheDocument();
  });

  it('reorders two experience entries with the move-down control', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add experience entry' }));
    fireEvent.change(screen.getAllByPlaceholderText('Organization *')[0]!, {
      target: { value: 'First Co' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add experience entry' }));
    const orgInputs = screen.getAllByPlaceholderText('Organization *');
    fireEvent.change(orgInputs[1]!, { target: { value: 'Second Co' } });

    const orderBefore = screen
      .getAllByPlaceholderText('Organization *')
      .map((el) => (el as HTMLInputElement).value);
    expect(orderBefore).toEqual(['First Co', 'Second Co']);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Move experience entry down' })[0]!,
    );

    const orderAfter = screen
      .getAllByPlaceholderText('Organization *')
      .map((el) => (el as HTMLInputElement).value);
    expect(orderAfter).toEqual(['Second Co', 'First Co']);
  });

  it('adds and removes a bullet within an entry', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add experience entry' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add bullet' }));
    const textareas = screen
      .getAllByRole('textbox')
      .filter((el) => el.tagName === 'TEXTAREA');
    expect(textareas.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove bullet' }));
    // The bullet textarea should be gone (only the advanced-mode/preview elements remain, none
    // of which are plain empty textareas at this point).
    expect(
      screen.queryAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA'),
    ).toHaveLength(0);
  });
});

describe('ResumeStudio — save', () => {
  it('saves and shows the new version number on success', async () => {
    mocks.saveNewStructuredResumeVersion.mockResolvedValue({
      status: 'ok',
      version: { versionNumber: 2 },
    });
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save New Version' }));
    await waitFor(() =>
      expect(screen.getByText(/Saved as version 2/)).toBeInTheDocument(),
    );
    expect(mocks.saveNewStructuredResumeVersion).toHaveBeenCalledWith(
      'resume-1',
      expect.objectContaining({ displayName: 'Master Resume' }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('shows a friendly error and does not claim success when the save action fails', async () => {
    mocks.saveNewStructuredResumeVersion.mockResolvedValue({
      status: 'error',
      message: 'Resume not found.',
    });
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save New Version' }));
    await waitFor(() =>
      expect(screen.getByText('Resume not found.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Saved as version/)).not.toBeInTheDocument();
  });
});

describe('ResumeStudio — Advanced LaTeX mode', () => {
  it('shows the generated LaTeX read-only until the user clicks Customize', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced: LaTeX' }));
    expect(screen.getByText(/renders from structured content/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reset to generated LaTeX' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(
      screen.getByRole('button', { name: 'Reset to generated LaTeX' }),
    ).toBeInTheDocument();
  });

  it('resets the override back to generated LaTeX after confirmation', () => {
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced: LaTeX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to generated LaTeX' }));
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
  });

  it('never overwrites the override without an explicit confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={baseResume()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced: LaTeX' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to generated LaTeX' }));
    // confirm() returned false — the override must still be active.
    expect(
      screen.getByRole('button', { name: 'Reset to generated LaTeX' }),
    ).toBeInTheDocument();
  });
});

describe('ResumeStudio — import from profile', () => {
  it('replaces structured sections with the profile-derived content, but keeps the current header', () => {
    const importContent = {
      ...baseResume(),
      header: { ...HEADER, fullName: 'Should Not Appear' },
      experience: [
        {
          id: 'imported-1',
          organization: 'Imported Co',
          role: 'Imported Role',
          location: null,
          dateRange: { start: null, end: null, isPresent: false },
          bullets: [],
        },
      ],
    };
    render(
      <ResumeStudio
        resumeId="resume-1"
        resumeName="Master Resume"
        baseVersionLabel={null}
        initialContent={baseResume()}
        profileImportContent={importContent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import from profile' }));
    expect(screen.getByDisplayValue('Imported Co')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name *')).toHaveValue('Ada Lovelace');
  });
});
