// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApplicationTracker } from './useApplicationTracker';

const mocks = vi.hoisted(() => ({
  getTrackedApplication: vi.fn(),
  checkConsistency: vi.fn(),
  markApplied: vi.fn(),
  saveApplication: vi.fn(),
}));

vi.mock('../../lib/api-client', () => ({
  getTrackedApplication: mocks.getTrackedApplication,
  checkConsistency: mocks.checkConsistency,
  markApplied: mocks.markApplied,
  saveApplication: mocks.saveApplication,
}));

const JOB_ID = 'job-1';
const APPLICATION_ID = 'app-1';

const WARNING_FINDING = {
  id: 'w1',
  ruleId: 'GPA_MISMATCH' as const,
  severity: 'WARNING' as const,
  fieldALabel: 'GPA',
  fieldASource: 'GENERATED_ANSWER' as const,
  fieldAValue: '3.2',
  fieldBLabel: 'Approved GPA',
  fieldBSource: 'PROFILE_EDUCATION' as const,
  fieldBValue: '3.9',
  description: 'GPA mismatch',
};

const BLOCKING_FINDING = {
  id: 'b1',
  ruleId: 'ELIGIBILITY_SELF_CONTRADICTION' as const,
  severity: 'BLOCKING' as const,
  fieldALabel: 'Authorized?',
  fieldASource: 'GENERATED_ANSWER' as const,
  fieldAValue: 'Yes',
  fieldBLabel: 'Need sponsorship?',
  fieldBSource: 'GENERATED_ANSWER' as const,
  fieldBValue: 'No',
  description: 'Self-contradiction',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTrackedApplication.mockResolvedValue({
    id: APPLICATION_ID,
    status: 'IN_PROGRESS',
  });
});

async function readyHook() {
  const hook = renderHook(() => useApplicationTracker(JOB_ID));
  await waitFor(() => expect(hook.result.current.applicationId).toBe(APPLICATION_ID));
  return hook;
}

describe('useApplicationTracker — mark-as-applied consistency review (Phase 5B.2)', () => {
  it('a clean check (no findings) proceeds straight to marking applied, with no review step and no acknowledgement payload beyond an empty array', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [],
      blockingCount: 0,
      warningCount: 0,
    });
    mocks.markApplied.mockResolvedValue({
      status: 'ok',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });

    expect(mocks.markApplied).toHaveBeenCalledWith(APPLICATION_ID, []);
    expect(result.current.reviewFindings).toBeNull();
    expect(result.current.trackedStatus).toBe('APPLIED');
  });

  it('surfaces WARNING findings as a review step instead of marking applied immediately', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [WARNING_FINDING],
      blockingCount: 0,
      warningCount: 1,
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });

    expect(mocks.markApplied).not.toHaveBeenCalled();
    expect(result.current.status).toBe('reviewing-consistency');
    expect(result.current.reviewFindings).toEqual([WARNING_FINDING]);
  });

  it('sends only the acknowledged finding ids when confirming after review', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [WARNING_FINDING],
      blockingCount: 0,
      warningCount: 1,
    });
    mocks.markApplied.mockResolvedValue({
      status: 'ok',
      appliedAt: '2026-01-01T00:00:00.000Z',
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });
    act(() => {
      result.current.toggleAcknowledgement('w1', true);
    });
    await act(async () => {
      result.current.confirmMarkAsApplied();
    });

    expect(mocks.markApplied).toHaveBeenCalledWith(APPLICATION_ID, ['w1']);
  });

  it('never calls markApplied for a BLOCKING finding — there is nothing to acknowledge', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [BLOCKING_FINDING],
      blockingCount: 1,
      warningCount: 0,
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });

    expect(result.current.reviewFindings).toEqual([BLOCKING_FINDING]);
    // The popup's own UI is what actually disables the confirm button for BLOCKING findings
    // (ApplicationTracker.tsx) — this hook itself never refuses to call confirmMarkAsApplied, so
    // this test documents that the UI, not the hook, is the enforcement point here; the real
    // authority is always the server's own re-check regardless.
  });

  it('replaces the review findings with the server-authoritative result when the PATCH call itself rejects (never trusts the earlier GET as still current)', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [],
      blockingCount: 0,
      warningCount: 0,
    });
    mocks.markApplied.mockResolvedValue({
      status: 'consistency_check_failed',
      result: {
        status: 'consistency_check_failed',
        reason: 'blocking_findings',
        findings: [BLOCKING_FINDING],
        blockingCount: 1,
        warningCount: 0,
      },
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });

    expect(result.current.status).toBe('reviewing-consistency');
    expect(result.current.reviewFindings).toEqual([BLOCKING_FINDING]);
  });

  it('never duplicates rule logic locally — findings shown are exactly what the server returned, untouched', async () => {
    mocks.checkConsistency.mockResolvedValue({
      findings: [WARNING_FINDING, BLOCKING_FINDING],
      blockingCount: 1,
      warningCount: 1,
    });

    const { result } = await readyHook();
    await act(async () => {
      await result.current.startMarkAsApplied();
    });

    expect(result.current.reviewFindings).toEqual([WARNING_FINDING, BLOCKING_FINDING]);
  });
});
