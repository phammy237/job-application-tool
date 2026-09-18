import {
  getOwnProfile,
  getOwnResume,
  listOwnApplicationsWithWorkingResumeVersion,
  listOwnEducation,
  listOwnExperiences,
  listOwnProjects,
  listOwnResumeVersionsForResume,
  listOwnSkills,
} from '@career-os/database';
import {
  buildStructuredResumeFromProfile,
  createEmptyStructuredResume,
} from '@career-os/shared';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../../lib/auth';
import { formatFriendlyDateTime } from '../../../../../lib/format-friendly-date';
import { createClient } from '../../../../../lib/supabase/server';
import { ResumeStudio } from './resume-studio';

export default async function ResumeStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version: requestedVersionId } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const resume = await getOwnResume(supabase, user.id, id);
  if (!resume) {
    notFound();
  }

  const [versions, profile, experiences, education, projects, skills] = await Promise.all(
    [
      listOwnResumeVersionsForResume(supabase, user.id, id),
      getOwnProfile(supabase, user.id),
      listOwnExperiences(supabase, user.id),
      listOwnEducation(supabase, user.id),
      listOwnProjects(supabase, user.id),
      listOwnSkills(supabase, user.id),
    ],
  );

  // Default base version: the requested one if it belongs to this resume, otherwise the latest
  // STRUCTURED_V1 version — a METADATA_ONLY (legacy, Phase 7A) version has no structured content
  // to base a draft on (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §8), so it is never auto-selected
  // as a starting point even if it's the newest version.
  const requestedVersion = requestedVersionId
    ? versions.find((v) => v.id === requestedVersionId)
    : undefined;
  const baseVersion =
    requestedVersion ?? versions.find((v) => v.snapshotFormat === 'STRUCTURED_V1');

  const profileImportContent = buildStructuredResumeFromProfile(
    profile,
    experiences,
    education,
    projects,
    skills,
  );

  const initialContent =
    baseVersion?.snapshotFormat === 'STRUCTURED_V1'
      ? baseVersion.snapshotPayload
      : createEmptyStructuredResume(profileImportContent.header);

  const baseVersionLabel = baseVersion ? `version ${baseVersion.versionNumber}` : null;

  // Header identity — never parsed from `resume.name` (docs/IMPLEMENTATION_PLAN.md's own naming
  // convention already produces long, sometimes-inconsistent strings there, see resume-naming.ts;
  // fixing that is a display concern, not a database one). Reused from the resume DETAIL page's
  // own "applications using each version" lookup, batched across every version on this resume in
  // one pair of queries rather than a new per-page query.
  const versionIds = versions.map((v) => v.id);
  const workingUsage = await listOwnApplicationsWithWorkingResumeVersion(supabase, user.id, versionIds);
  let linkedApplication: { id: string; company: string; title: string } | null = null;
  for (const versionId of versionIds) {
    const working = workingUsage.get(versionId);
    if (working && working.length > 0) {
      linkedApplication = working[0]!;
      break;
    }
  }

  const heading =
    resume.kind === 'MASTER'
      ? 'Master résumé'
      : (linkedApplication ? `${linkedApplication.company} · ${linkedApplication.title}` : resume.name);
  const subline =
    resume.kind === 'MASTER'
      ? versions[0]
        ? `Version ${versions[0].versionNumber} · Updated ${formatFriendlyDateTime(versions[0].createdAt)}`
        : 'No versions yet'
      : `Tailored résumé${baseVersionLabel ? ` · Based on Master ${baseVersionLabel}` : ''}`;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{subline}</p>
        </div>
        {linkedApplication ? (
          <a
            href={`/applications/${linkedApplication.id}`}
            className="text-primary text-sm underline underline-offset-2"
          >
            View application
          </a>
        ) : null}
      </div>

      {requestedVersionId && !requestedVersion ? (
        <p className="text-destructive text-xs">
          The requested base version was not found for this resume — starting from the
          latest structured version instead.
        </p>
      ) : null}
      {baseVersion && baseVersion.snapshotFormat !== 'STRUCTURED_V1' ? (
        <p className="text-muted-foreground text-xs">
          This resume has no structured version yet — starting a new blank draft.
        </p>
      ) : null}

      <ResumeStudio
        resumeId={resume.id}
        resumeName={resume.name}
        baseVersionLabel={
          baseVersion?.snapshotFormat === 'STRUCTURED_V1' ? baseVersionLabel : null
        }
        initialContent={initialContent}
        profileImportContent={profileImportContent}
      />
    </div>
  );
}
