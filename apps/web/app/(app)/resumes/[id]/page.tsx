import {
  getOwnResume,
  listOwnApplicationsWithWorkingResumeVersion,
  listOwnResumeVersionsForResume,
  listOwnSubmittedApplicationsForResumeVersions,
} from '@career-os/database';
import { Button, Input, Label, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { createResumeVersion, renameResume } from '../actions';
import { DeleteResumeButton } from '../delete-resume-button';
import { DeleteVersionButton } from '../delete-version-button';
import { VersionLatexPreview } from '../version-latex-preview';

export default async function ResumeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const resume = await getOwnResume(supabase, user.id, id);
  if (!resume) {
    notFound();
  }

  const [versions, parent] = await Promise.all([
    listOwnResumeVersionsForResume(supabase, user.id, id),
    resume.parentResumeId ? getOwnResume(supabase, user.id, resume.parentResumeId) : null,
  ]);
  const versionIds = versions.map((v) => v.id);
  const [workingUsage, submittedUsage] = await Promise.all([
    listOwnApplicationsWithWorkingResumeVersion(supabase, user.id, versionIds),
    listOwnSubmittedApplicationsForResumeVersions(supabase, user.id, versionIds),
  ]);

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{resume.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {resume.kind === 'MASTER' ? 'Master résumé' : 'Tailored résumé'}
            {parent ? (
              <>
                {' '}
                · descends from{' '}
                <Link href={`/resumes/${parent.id}`} className="hover:underline">
                  {parent.name}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <Link
          href={`/resumes/${resume.id}/studio`}
          className={buttonVariants({ size: 'sm' })}
        >
          Open Studio
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">Rename</h2>
        <form
          action={renameResume.bind(null, resume.id)}
          className="flex items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rename-name" className="sr-only">
              Name
            </Label>
            <Input id="rename-name" name="name" defaultValue={resume.name} required />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Save
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Versions ({versions.length})
        </h2>

        {versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No versions yet.</p>
        ) : (
          <ul className="space-y-3">
            {versions.map((version) => {
              const working = workingUsage.get(version.id) ?? [];
              const submitted = submittedUsage.get(version.id) ?? [];
              return (
                <li
                  key={version.id}
                  className="border-border rounded-lg border p-4 text-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        Version {version.versionNumber} — {version.displayName}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        Created {new Date(version.createdAt).toLocaleString()} ·{' '}
                        {version.snapshotFormat === 'STRUCTURED_V1'
                          ? 'Structured'
                          : 'Metadata-only'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/resumes/${resume.id}/studio?version=${version.id}`}
                        className="text-primary text-xs hover:underline"
                      >
                        Edit as new version
                      </Link>
                      <DeleteVersionButton
                        resumeId={resume.id}
                        versionId={version.id}
                        label={`version ${version.versionNumber}`}
                      />
                    </div>
                  </div>

                  <VersionLatexPreview version={version} />

                  {submitted.length > 0 ? (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Submitted for {submitted.length} application
                      {submitted.length === 1 ? '' : 's'} — locked, cannot be deleted.
                    </p>
                  ) : null}
                  {working.length > 0 ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Currently the working résumé for:{' '}
                      {working.map((app, i) => (
                        <span key={app.id}>
                          {i > 0 ? ', ' : ''}
                          <Link
                            href={`/applications/${app.id}`}
                            className="hover:underline"
                          >
                            {app.company} — {app.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <form
          action={createResumeVersion.bind(null, resume.id)}
          className="border-border flex items-end gap-3 rounded-lg border border-dashed p-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="version-name">New version label</Label>
            <Input
              id="version-name"
              name="displayName"
              defaultValue={resume.name}
              required
            />
          </div>
          <Button type="submit" size="sm">
            Create new version
          </Button>
        </form>
      </section>

      <section className="border-border border-t pt-6">
        <DeleteResumeButton id={resume.id} name={resume.name} />
      </section>
    </div>
  );
}
