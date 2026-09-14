// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createEmptyStructuredResume, type ResumeVersion } from '@career-os/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionLatexPreview } from './version-latex-preview';

const BASE = {
  id: 'v1',
  userId: 'user-1',
  resumeId: 'resume-1',
  versionNumber: 1,
  displayName: 'My Resume',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('VersionLatexPreview', () => {
  it('states plainly that a METADATA_ONLY version has no LaTeX, never fabricating one', () => {
    const version: ResumeVersion = {
      ...BASE,
      snapshotFormat: 'METADATA_ONLY',
      snapshotPayload: null,
    };
    render(<VersionLatexPreview version={version} />);
    expect(
      screen.getByText('This version predates structured résumé content.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View LaTeX' })).not.toBeInTheDocument();
  });

  it('shows the rendered LaTeX for a STRUCTURED_V1 version only after expanding', () => {
    const version: ResumeVersion = {
      ...BASE,
      snapshotFormat: 'STRUCTURED_V1',
      snapshotPayload: createEmptyStructuredResume({
        fullName: 'Ada Lovelace',
        email: null,
        phone: null,
        location: null,
        links: {},
      }),
    };
    render(<VersionLatexPreview version={version} />);
    expect(screen.queryByText(/documentclass/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View LaTeX' }));
    expect(screen.getByText(/documentclass/)).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide LaTeX' }));
    expect(screen.queryByText(/documentclass/)).not.toBeInTheDocument();
  });
});
