import {
  getOwnResumeVersion,
  listOwnResumeVersions,
  listOwnResumes,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { Button, Label, Select } from '@career-os/ui';
import Link from 'next/link';
import { selectWorkingResumeVersion } from './actions';
import { ClearWorkingResumeButton } from './clear-working-resume-button';
import { CreateTailoredResumeButton } from './create-tailored-resume-button';

/**
 * The application detail page's "Resume" section (docs/IMPLEMENTATION_PLAN.md "Phase 7B" §17) —
 * shows and lets the user change the currently-selected *working* résumé version. Deliberately
 * separate from `SubmissionPacketSection`'s "submitted" résumé display below: the two are allowed
 * to disagree (working may have moved on since submission) and that disagreement is expected,
 * historical behavior, never presented as an error.
 */
export async function ResumeSection({
  supabase,
  userId,
  applicationId,
  workingResumeVersionId,
  company,
  title,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  applicationId: string;
  workingResumeVersionId: string | null;
  company: string;
  title: string;
}) {
  const [workingVersion, resumes, allVersions] = await Promise.all([
    workingResumeVersionId
      ? getOwnResumeVersion(supabase, userId, workingResumeVersionId)
      : null,
    listOwnResumes(supabase, userId),
    listOwnResumeVersions(supabase, userId),
  ]);
  const resumeNameById = new Map(resumes.map((r) => [r.id, r.name]));

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">Resume</h2>

      {workingVersion ? (
        <div className="border-border space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">
            {resumeNameById.get(workingVersion.resumeId) ?? workingVersion.displayName}
          </p>
          <p className="text-muted-foreground text-xs">
            Version {workingVersion.versionNumber} — {workingVersion.displayName}
          </p>
          <div className="flex gap-3 pt-2">
            <Link
              href={`/resumes/${workingVersion.resumeId}`}
              className="text-primary text-xs hover:underline"
            >
              View
            </Link>
            <ClearWorkingResumeButton applicationId={applicationId} />
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No resume selected.</p>
      )}

      {allVersions.length > 0 ? (
        <form
          action={selectWorkingResumeVersion.bind(null, applicationId)}
          className="flex items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="resumeVersionId" className="sr-only">
              Resume version
            </Label>
            <Select
              id="resumeVersionId"
              name="resumeVersionId"
              defaultValue=""
              className="max-w-xs"
            >
              <option value="" disabled>
                Select a résumé version…
              </option>
              {allVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {resumeNameById.get(version.resumeId) ?? version.displayName} — v
                  {version.versionNumber}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline" size="sm">
            {workingVersion ? 'Change' : 'Select resume'}
          </Button>
        </form>
      ) : null}

      <CreateTailoredResumeButton
        applicationId={applicationId}
        company={company}
        title={title}
      />
    </section>
  );
}
