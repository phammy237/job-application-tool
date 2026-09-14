'use server';

import { createOwnResumeVersion, getOwnResume } from '@career-os/database';
import { structuredResumeV1Schema, type ResumeVersion } from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';
import { createClient } from '../../../../../lib/supabase/server';

export type SaveResumeVersionResult =
  { status: 'ok'; version: ResumeVersion } | { status: 'error'; message: string };

const saveInputSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  content: structuredResumeV1Schema,
});

/**
 * "Save New Version" (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §17). Server-side steps, in order:
 * verify ownership of the target resume, validate the structured content against
 * `structuredResumeV1Schema` (never trust the client's own validation alone), then create the
 * next immutable version via the service-role-only `create_resume_version` RPC — which computes
 * `version_number` itself, atomically; this action never passes or derives one.
 */
export async function saveNewStructuredResumeVersion(
  resumeId: string,
  input: { displayName: string; content: unknown },
): Promise<SaveResumeVersionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const resume = await getOwnResume(supabase, user.id, resumeId);
  if (!resume) {
    return { status: 'error', message: 'Resume not found.' };
  }

  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: `This resume has invalid content and cannot be saved: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
    };
  }

  const admin = createAdminClient();
  const version = await createOwnResumeVersion(admin, user.id, {
    resumeId,
    displayName: parsed.data.displayName,
    snapshotFormat: 'STRUCTURED_V1',
    snapshotPayload: parsed.data.content,
  });

  revalidatePath(`/resumes/${resumeId}`);
  revalidatePath(`/resumes/${resumeId}/studio`);
  return { status: 'ok', version };
}
