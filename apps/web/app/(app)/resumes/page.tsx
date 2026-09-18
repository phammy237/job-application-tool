import {
  listOwnApplicationsWithWorkingResumeVersion,
  listOwnResumeVersions,
  listOwnResumes,
} from '@career-os/database';
import type { Resume, ResumeVersion } from '@career-os/shared';
import { Badge, Button, Card, CardContent, Input, Label } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { formatFriendlyDateTime } from '../../../lib/format-friendly-date';
import { createClient } from '../../../lib/supabase/server';
import { createMasterResume, createTailoredResume } from './actions';
import { CreateMasterVersionButton } from './create-master-version-button';

export default async function ResumesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [resumes, allVersions] = await Promise.all([
    listOwnResumes(supabase, user.id),
    listOwnResumeVersions(supabase, user.id),
  ]);

  const versionsByResume = new Map<string, ResumeVersion[]>();
  for (const version of allVersions) {
    const list = versionsByResume.get(version.resumeId) ?? [];
    list.push(version);
    versionsByResume.set(version.resumeId, list);
  }

  const workingUsage = await listOwnApplicationsWithWorkingResumeVersion(
    supabase,
    user.id,
    allVersions.map((v) => v.id),
  );

  function linkedApplicationFor(resumeId: string) {
    for (const version of versionsByResume.get(resumeId) ?? []) {
      const working = workingUsage.get(version.id);
      if (working && working.length > 0) return working[0]!;
    }
    return null;
  }

  const master = resumes.find((r) => r.kind === 'MASTER') ?? null;
  const tailored = resumes.filter((r) => r.kind === 'TAILORED');

  // Phase C: does the MASTER already have a structured version? Drives which label/action
  // Create-master-version offers ("Create structured master resume" vs "Create new master
  // version from profile") — never mutating whichever version already exists either way.
  const masterVersions = master ? (versionsByResume.get(master.id) ?? []) : [];
  const masterHasStructuredVersion = masterVersions.some((v) => v.snapshotFormat === 'STRUCTURED_V1');
  const masterLatest = masterVersions[0] ?? null;

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
          <Card>
            <CardContent className="flex items-center justify-between gap-4 pt-6">
              <div>
                <p className="font-medium">Master résumé</p>
                <p className="text-muted-foreground text-xs">
                  {masterLatest
                    ? `Version ${masterLatest.versionNumber} · Updated ${formatFriendlyDateTime(master.updatedAt)}`
                    : 'No versions yet'}
                </p>
              </div>
              <Link href={`/resumes/${master.id}`} className="text-primary text-sm underline underline-offset-2">
                Open
              </Link>
            </CardContent>
          </Card>
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
              <TailoredResumeCard
                key={resume.id}
                resume={resume}
                latestVersion={(versionsByResume.get(resume.id) ?? [])[0] ?? null}
                versionCount={(versionsByResume.get(resume.id) ?? []).length}
                linkedApplication={linkedApplicationFor(resume.id)}
              />
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

function TailoredResumeCard({
  resume,
  latestVersion,
  versionCount,
  linkedApplication,
}: {
  resume: Resume;
  latestVersion: ResumeVersion | null;
  versionCount: number;
  linkedApplication: { id: string; company: string; title: string } | null;
}) {
  return (
    <li>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <div>
            {linkedApplication ? (
              <>
                <p className="font-medium">{linkedApplication.company}</p>
                <p className="text-muted-foreground text-sm">{linkedApplication.title}</p>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <p className="font-medium">{resume.name}</p>
                <Badge variant="outline">Unlinked</Badge>
              </div>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              {latestVersion
                ? `Version ${latestVersion.versionNumber} · Updated ${formatFriendlyDateTime(resume.updatedAt)}`
                : 'No versions yet'}
              {versionCount > 1 ? ` · ${versionCount} versions` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <Link href={`/resumes/${resume.id}`} className="text-primary underline underline-offset-2">
              Open
            </Link>
            {linkedApplication ? (
              <Link
                href={`/applications/${linkedApplication.id}`}
                className="text-muted-foreground underline underline-offset-2"
              >
                View application
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
