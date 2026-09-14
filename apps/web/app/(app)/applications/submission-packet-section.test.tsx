// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnSubmissionPacketByApplicationId: vi.fn(),
  getOwnRequirementMappingRunById: vi.fn(),
  countOwnRequirementMappingsForRun: vi.fn(),
  getOwnResumeVersion: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  getOwnSubmissionPacketByApplicationId: mocks.getOwnSubmissionPacketByApplicationId,
  getOwnRequirementMappingRunById: mocks.getOwnRequirementMappingRunById,
  countOwnRequirementMappingsForRun: mocks.countOwnRequirementMappingsForRun,
  getOwnResumeVersion: mocks.getOwnResumeVersion,
}));

const { SubmissionPacketSection } = await import('./submission-packet-section');

const SUPABASE = {} as never;
const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

const BASE_PACKET = {
  id: 'packet-1',
  userId: USER_ID,
  applicationId: APPLICATION_ID,
  jobSnapshotId: null,
  resumeId: null,
  resumeVersionId: null,
  requirementMappingRunId: null,
  answersSnapshot: [],
  autofillSummary: null,
  unresolvedFields: [],
  consistencyFindings: [],
  consistencyAcknowledgements: [],
  contentFingerprint: 'v1:abc',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function renderSection() {
  const element = await SubmissionPacketSection({
    supabase: SUPABASE,
    userId: USER_ID,
    applicationId: APPLICATION_ID,
  });
  render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SubmissionPacketSection — legacy state (Phase 5B.1G)', () => {
  it('shows an honest "unavailable" message, never fabricates a packet, when none exists', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(null);
    await renderSection();
    expect(
      screen.getByText(
        'This application was marked applied before submission snapshots were introduced, so a frozen submission record is unavailable for it.',
      ),
    ).toBeInTheDocument();
    expect(mocks.getOwnRequirementMappingRunById).not.toHaveBeenCalled();
  });
});

describe('SubmissionPacketSection — reviewed answers', () => {
  it('shows an honest "no literal value" note when no fields were reviewed', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(BASE_PACKET);
    await renderSection();
    expect(screen.getByText(/Career OS has/)).toBeInTheDocument();
  });

  it('renders each reviewed answer with its final (edited) text when present', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      answersSnapshot: [
        {
          generatedAnswerId: 'ans-1',
          fieldLabel: 'Why this role?',
          fieldClassification: 'FREE_RESPONSE',
          originalAnswer: 'Original AI draft.',
          finalText: 'My edited final answer.',
          userDecision: 'EDITED',
          sourceFactIds: [],
          confidence: 0.8,
        },
      ],
    });
    await renderSection();
    expect(screen.getByText('My edited final answer.')).toBeInTheDocument();
    expect(screen.queryByText('Original AI draft.')).not.toBeInTheDocument();
    expect(screen.getByText(/· edited/)).toBeInTheDocument();
  });
});

describe('SubmissionPacketSection — résumé honesty', () => {
  it('states the résumé is not recorded when neither resumeVersionId nor legacy resumeId is set', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(BASE_PACKET);
    await renderSection();
    expect(
      screen.getByText('Resume not recorded for this submission.'),
    ).toBeInTheDocument();
    expect(mocks.getOwnResumeVersion).not.toHaveBeenCalled();
  });

  it('shows the exact submitted version when resumeVersionId resolves', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      resumeVersionId: 'version-1',
    });
    mocks.getOwnResumeVersion.mockResolvedValue({
      id: 'version-1',
      versionNumber: 2,
      displayName: 'My Resume -- Acme -- Engineer',
    });
    await renderSection();
    expect(
      screen.getByText(/Version 2 — My Resume -- Acme -- Engineer/),
    ).toBeInTheDocument();
  });

  it('states the version is no longer available rather than fabricating a summary', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      resumeVersionId: 'version-deleted',
    });
    mocks.getOwnResumeVersion.mockResolvedValue(null);
    await renderSection();
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  });

  it('falls back to the legacy resumeId rendering for a pre-migration-0021 packet', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      resumeId: 'legacy-resume-1',
    });
    await renderSection();
    expect(screen.getByText('Résumé legacy-resume-1')).toBeInTheDocument();
    expect(mocks.getOwnResumeVersion).not.toHaveBeenCalled();
  });
});

describe('SubmissionPacketSection — requirement analysis summary', () => {
  it('renders nothing about requirement analysis when the packet never referenced a run', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue(BASE_PACKET);
    await renderSection();
    expect(screen.queryByText('Requirement analysis')).not.toBeInTheDocument();
    expect(mocks.getOwnRequirementMappingRunById).not.toHaveBeenCalled();
  });

  it('shows the requirement count and date for a still-CURRENT run, without a superseded caveat', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      requirementMappingRunId: RUN_ID,
    });
    mocks.getOwnRequirementMappingRunById.mockResolvedValue({
      id: RUN_ID,
      status: 'CURRENT',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.countOwnRequirementMappingsForRun.mockResolvedValue(12);

    await renderSection();

    expect(screen.getByText(/12 requirements analyzed/)).toBeInTheDocument();
    expect(screen.queryByText(/newer analysis/)).not.toBeInTheDocument();
  });

  it('honestly notes a superseded run rather than implying it is still current', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      requirementMappingRunId: RUN_ID,
    });
    mocks.getOwnRequirementMappingRunById.mockResolvedValue({
      id: RUN_ID,
      status: 'SUPERSEDED',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.countOwnRequirementMappingsForRun.mockResolvedValue(5);

    await renderSection();

    expect(
      screen.getByText(/newer analysis has since replaced this run/),
    ).toBeInTheDocument();
  });

  it('never fabricates a summary for a run that no longer resolves — states it plainly instead', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      requirementMappingRunId: RUN_ID,
    });
    mocks.getOwnRequirementMappingRunById.mockResolvedValue(null);

    await renderSection();

    expect(
      screen.getByText(
        'This application referenced a requirement analysis run that is no longer available.',
      ),
    ).toBeInTheDocument();
    expect(mocks.countOwnRequirementMappingsForRun).not.toHaveBeenCalled();
  });
});

describe('SubmissionPacketSection — consistency findings', () => {
  it('shows an acknowledgement timestamp only for a finding that actually has one', async () => {
    mocks.getOwnSubmissionPacketByApplicationId.mockResolvedValue({
      ...BASE_PACKET,
      consistencyFindings: [
        {
          id: 'f1',
          ruleId: 'GPA_MISMATCH',
          severity: 'WARNING',
          fieldALabel: 'GPA',
          fieldASource: 'GENERATED_ANSWER',
          fieldAValue: '3.2',
          fieldBLabel: 'Approved GPA',
          fieldBSource: 'PROFILE_EDUCATION',
          fieldBValue: '3.9',
          description: 'GPA differs from your approved profile.',
        },
      ],
      consistencyAcknowledgements: [
        { findingId: 'f1', acknowledgedAt: '2026-01-01T00:05:00.000Z' },
      ],
    });
    await renderSection();
    expect(
      screen.getByText('GPA differs from your approved profile.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged/)).toBeInTheDocument();
  });
});
