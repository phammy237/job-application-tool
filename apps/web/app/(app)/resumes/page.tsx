import {
  countOwnResumeVersionsForResumes,
  listOwnResumeVersionsForResume,
  listOwnResumes,
} from '@career-os/database';
import { Button, Input, Label } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { createMasterResume, createTailoredResume } from './actions';
import { CreateMasterVersionButton } from './create-master-version-button';

export default async function ResumesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const resumes = await listOwnResumes(supabase, user.id);
  const versionCounts = await countOwnResumeVersionsForResumes(
    supabase,
    user.id,
    resumes.map((r) => r.id),
  );

  const master = resumes.find((r) => r.kind === 'MASTER') ?? null;
  const tailored = resumes.filter((r) => r.kind === 'TAILORED');

  // Phase C: does the MASTER already have a structured version? Drives which label/action
  // Create-master-version offers ("Create structured master resume" vs "Create new master
  // version from profile") — never mutating whichever version already exists either way.
  const masterVersions = master
    ? await listOwnResumeVersionsForResume(supabase, user.id, master.id)
    : [];
  const masterHasStructuredVersion = masterVersions.some((v) => v.snapshotFormat === 'STRUCTURED_V1');

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your résumé library — a master résumé, and any versions tailored for specific
          applications. Every version is kept permanently once created; editing always adds a
          new one rather than changing history.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Master résumé</h2>
        {master ? (
          <div className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <Link href={`/resumes/${master.id}`} className="hover:text-primary font-medium hover:underline">
              {master.name}
            </Link>
            <span className="text-muted-foreground text-xs">
              {versionCounts.get(master.id) ?? 0} version
              {(versionCounts.get(master.id) ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
        ) : (
          <form action={createMasterResume} className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="master-name">Name</Label>
              <Input id="master-name" name="name" defaultValue="My Resume" required />
            </div>
            <Button type="submit" size="sm">
              Create master resume
            </Button>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <CreateMasterVersionButton hasStructuredVersion={masterHasStructuredVersion} />
          {!masterHasStructuredVersion ? (
            <p className="text-muted-foreground text-xs">
              Already have a résumé?{' '}
              <Link href="/settings/resume-import" className="underline underline-offset-2">
                Import it
              </Link>{' '}
              to populate your Candidate Profile first, or use your approved profile data
              directly with the button above.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Tailored résumés</h2>
        {tailored.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. Tailored résumés are usually created from an application&apos;s detail page
            (&quot;Create resume for this application&quot;), or manually below.
          </p>
        ) : (
          <ul className="space-y-2">
            {tailored.map((resume) => (
              <li
                key={resume.id}
                className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <Link
                  href={`/resumes/${resume.id}`}
                  className="hover:text-primary font-medium hover:underline"
                >
                  {resume.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {versionCounts.get(resume.id) ?? 0} version
                  {(versionCounts.get(resume.id) ?? 0) === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <details className="border-border rounded-lg border border-dashed p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Add tailored resume manually
          </summary>
          <form action={createTailoredResume} className="mt-4 flex items-end gap-3">
            <input type="hidden" name="parentResumeId" value={master?.id ?? ''} />
            <div className="space-y-1.5">
              <Label htmlFor="tailored-name">Name</Label>
              <Input
                id="tailored-name"
                name="name"
                placeholder="My Resume -- Company -- Role"
                required
              />
            </div>
            <Button type="submit" size="sm">
              Create
            </Button>
          </form>
        </details>
      </section>
    </div>
  );
}
