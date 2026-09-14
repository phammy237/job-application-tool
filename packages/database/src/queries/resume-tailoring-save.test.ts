import { describe, expect, it, vi } from 'vitest';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import {
  SaveReviewedTailoredResumeError,
  saveReviewedTailoredResume,
} from './resume-tailoring-save';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const APPLICATION_ID = '44444444-4444-4444-8444-444444444444';
const WORKING_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const JOB_SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';

const INPUT = {
  applicationId: APPLICATION_ID,
  expectedWorkingResumeVersionId: WORKING_VERSION_ID,
  expectedJobSnapshotId: JOB_SNAPSHOT_ID,
  targetResumeId: null,
  newResumeName: "Ada's Resume -- Acme -- Engineer",
  newResumeParentId: null,
  versionDisplayName: "Ada's Resume -- Acme -- Engineer",
  snapshotPayload: { schemaVersion: 1 } as Json,
};

function mockRpc(result: {
  data: unknown;
  error: { message: string; details?: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn(() => ({ single }));
  return { rpc, single };
}

describe('saveReviewedTailoredResume', () => {
  it('calls the RPC with the authenticated user id, never a client-supplied one, and maps the result', async () => {
    const { rpc, single } = mockRpc({
      data: {
        resume_id: 'r1',
        resume_created: true,
        version_id: 'v1',
        version_number: 1,
        display_name: INPUT.versionDisplayName,
      },
      error: null,
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    const result = await saveReviewedTailoredResume(supabase, USER_ID, INPUT);

    expect(rpc).toHaveBeenCalledWith('save_reviewed_tailored_resume', {
      p_user_id: USER_ID,
      p_application_id: APPLICATION_ID,
      p_expected_working_resume_version_id: WORKING_VERSION_ID,
      p_expected_job_snapshot_id: JOB_SNAPSHOT_ID,
      p_target_resume_id: null,
      p_new_resume_name: INPUT.newResumeName,
      p_new_resume_parent_id: null,
      p_version_display_name: INPUT.versionDisplayName,
      p_snapshot_payload: INPUT.snapshotPayload,
    });
    expect(single).toHaveBeenCalled();
    expect(result).toEqual({
      resumeId: 'r1',
      resumeCreated: true,
      versionId: 'v1',
      versionNumber: 1,
      displayName: INPUT.versionDisplayName,
    });
  });

  it.each([
    ['stale_base_resume' as const],
    ['stale_job_context' as const],
    ['application_not_found' as const],
    ['resume_not_found' as const],
  ])('maps a %s rejection to a typed SaveReviewedTailoredResumeError', async (reason) => {
    const { rpc } = mockRpc({
      data: null,
      error: { message: reason, details: 'old-id' },
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    try {
      await saveReviewedTailoredResume(supabase, USER_ID, INPUT);
      expect.unreachable('expected saveReviewedTailoredResume to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveReviewedTailoredResumeError);
      expect((error as SaveReviewedTailoredResumeError).reason).toBe(reason);
      expect((error as SaveReviewedTailoredResumeError).currentValue).toBe('old-id');
    }
  });

  it('throws a plain DatabaseError for an unrecognized RPC error', async () => {
    const { rpc } = mockRpc({
      data: null,
      error: { message: 'boom, something else broke' },
    });
    const supabase = { rpc } as unknown as CareerOsSupabaseClient;

    await expect(saveReviewedTailoredResume(supabase, USER_ID, INPUT)).rejects.toThrow(
      /boom, something else broke/,
    );
  });
});
