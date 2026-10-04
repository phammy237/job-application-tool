import {
  listOwnCandidates,
  listOwnGithubRepositories,
  loadOwnEvidenceGraph,
} from '@career-os/database';
import { achievementKindSchema, safeHttpHref, uuidSchema } from '@career-os/shared';
import { Badge, Input, Label, Select, Textarea, Button } from '@career-os/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate } from '../../../../../lib/myos/home';
import { requireUser } from '../../../../../lib/auth';
import { createClient } from '../../../../../lib/supabase/server';
import { EmptyState, FlagBadge, VerificationBadge, VisibilityBadge } from '../../_components/badges';
import {
  acceptCandidateAction,
  addProjectAchievementAction,
  addProjectEvidenceAction,
  addProjectSkillAction,
  deleteProjectAchievementAction,
  deleteProjectAction,
  rejectCandidateAction,
  removeProjectSkillAction,
  saveTalkingPointsAction,
  setProjectApprovalAction,
  setProjectVisibilityAction,
  unlinkProjectEvidenceAction,
  updateProjectAction,
} from '../actions';
import { Feedback, firstParam } from '../_components/feedback';
import { SubmitButton } from '../_components/submit-button';
import { projectDetailView } from '../detail-helpers';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const STATUS_OPTIONS = [
  ['IDEA', 'Idea'],
  ['ACTIVE', 'Active'],
  ['COMPLETED', 'Completed'],
  ['ARCHIVED', 'Archived'],
] as const;

const VISIBILITY_OPTIONS = [
  ['PRIVATE', 'Private'],
  ['CAREER_OS_ONLY', 'Career OS only'],
  ['PUBLIC', 'Public'],
] as const;

const SOURCE_LABEL: Record<string, string> = {
  GITHUB_REPO: 'GitHub repository',
  GITHUB_README: 'GitHub README',
  GITHUB_PR: 'GitHub pull request',
  GITHUB_COMMIT: 'GitHub commit',
  RESUME: 'Resume',
  USER_NOTE: 'Your note',
  LINK: 'Link',
  DOCUMENT: 'Document',
  AWARD: 'Award',
  OTHER: 'Other',
};

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-h`} className="border-border bg-card space-y-3 rounded-lg border p-4 scroll-mt-4">
      <div>
        <h2 id={`${id ?? title}-h`} className="text-sm font-semibold">
          {title}
        </h2>
        {description ? <p className="text-muted-foreground mt-0.5 text-xs">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function IdField({ id }: { id: string }) {
  return <input type="hidden" name="id" value={id} />;
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const sp = await searchParams;
  const notice = firstParam(sp.notice);
  const error = firstParam(sp.error);

  const user = await requireUser();
  const supabase = await createClient();
  const [graph, pendingAll, repos] = await Promise.all([
    loadOwnEvidenceGraph(supabase, user.id),
    listOwnCandidates(supabase, user.id, 'PENDING'),
    listOwnGithubRepositories(supabase, user.id),
  ]);

  const view = projectDetailView(graph, id);
  if (!view) notFound();
  const { project, skills, achievements, evidence } = view;
  const pending = pendingAll.filter((c) => c.projectId === id);
  const repo = repos.find((r) => r.projectId === id) ?? null;

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
        <Link href="/my/projects" className="hover:underline">
          Projects
        </Link>{' '}
        / <span className="text-foreground">{project.name}</span>
      </nav>

      <Feedback notice={notice} error={error} />

      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge variant="outline">{project.origin === 'GITHUB' ? 'GitHub' : project.origin === 'RESUME' ? 'Resume' : 'Manual'}</Badge>
          <VisibilityBadge visibility={project.visibility} />
          {!project.userApproved ? <FlagBadge>Unapproved</FlagBadge> : null}
          {evidence.length === 0 ? <FlagBadge>No evidence</FlagBadge> : null}
          <span className="text-muted-foreground">
            {[project.role, project.status ? STATUS_OPTIONS.find((s) => s[0] === project.status)?.[1] : null]
              .filter(Boolean)
              .join(' · ') || 'No role or status set'}
          </span>
          <span className="text-muted-foreground">
            {formatDate(project.startDate)} to {project.endDate ? formatDate(project.endDate) : 'present'}
          </span>
        </div>
        <p className="flex flex-wrap gap-x-4 text-sm">
          {safeHttpHref(project.url) ? (
            <a href={safeHttpHref(project.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Project link
            </a>
          ) : null}
          {repo && safeHttpHref(repo.htmlUrl) ? (
            <a href={safeHttpHref(repo.htmlUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Repository {repo.fullName}
            </a>
          ) : null}
        </p>
      </header>

      {/* Suggestions */}
      <Section
        id="suggestions"
        title="Suggestions to confirm"
        description="Detected automatically. Nothing here is part of your profile until you accept it."
      >
        {pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pending suggestions for this project.</p>
        ) : (
          <ul className="divide-border divide-y">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 text-sm">
                  <p>
                    <Badge variant="secondary" className="mr-2">
                      {c.payload.kind === 'SKILL'
                        ? 'Skill'
                        : c.payload.kind === 'TALKING_POINT'
                          ? 'Talking point'
                          : c.payload.kind === 'PROJECT_SUMMARY'
                            ? 'Summary'
                            : 'Competency'}
                    </Badge>
                    <span className="font-medium">
                      {c.payload.kind === 'SKILL'
                        ? c.payload.skill
                        : c.payload.kind === 'COMPETENCY'
                          ? c.payload.competency.replace(/_/g, ' ').toLowerCase()
                          : c.payload.text}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Inferred from {c.rationale ?? 'repository data'} — not yet part of your profile
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={acceptCandidateAction}>
                    <IdField id={id} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <SubmitButton size="sm" pendingLabel="Accepting…" aria-label={`Accept suggestion`}>
                      Accept
                    </SubmitButton>
                  </form>
                  <form action={rejectCandidateAction}>
                    <IdField id={id} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <SubmitButton size="sm" variant="outline" pendingLabel="Rejecting…">
                      Reject
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Summary & details */}
      <Section id="details" title="Summary and details">
        <form action={updateProjectAction} className="grid gap-3 sm:grid-cols-2">
          <IdField id={id} />
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} defaultValue={project.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Your role</Label>
            <Input id="role" name="role" maxLength={200} defaultValue={project.role ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={project.status ?? ''}>
              <option value="">Not set</option>
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <Input id="startDate" name="startDate" type="date" defaultValue={project.startDate ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End date</Label>
            <Input id="endDate" name="endDate" type="date" defaultValue={project.endDate ?? ''} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="url">Link</Label>
            <Input id="url" name="url" type="url" maxLength={500} defaultValue={project.url ?? ''} placeholder="https://" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" name="summary" rows={3} maxLength={4000} defaultValue={project.summary ?? ''} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={5} maxLength={8000} defaultValue={project.description ?? ''} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="collaborators">Collaborators</Label>
            <Input id="collaborators" name="collaborators" defaultValue={project.collaborators.join(', ')} aria-describedby="collab-help" />
            <p id="collab-help" className="text-muted-foreground text-xs">
              Comma-separated names.
            </p>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton size="sm">Save details</SubmitButton>
          </div>
        </form>
      </Section>

      {/* Skills */}
      <Section id="skills" title="Technologies and skills" description="Skills this project demonstrates.">
        {skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No skills linked yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {skills.map(({ edge, skill }) => (
              <li key={edge.id} className="border-border flex items-center gap-2 rounded-md border py-1 pl-2.5 pr-1 text-sm">
                <span className="font-medium">{skill.name}</span>
                <VerificationBadge state={edge.verificationState} />
                <form action={removeProjectSkillAction}>
                  <IdField id={id} />
                  <input type="hidden" name="edgeId" value={edge.id} />
                  <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`Remove ${skill.name} from this project`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addProjectSkillAction} className="flex flex-wrap items-end gap-2">
          <IdField id={id} />
          <div className="space-y-1.5">
            <Label htmlFor="skill">Add a skill</Label>
            <Input id="skill" name="skill" required maxLength={80} placeholder="e.g. PostgreSQL" autoComplete="off" />
          </div>
          <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </form>
      </Section>

      {/* Achievements */}
      <Section id="achievements" title="Achievements, metrics, and awards">
        {achievements.length === 0 ? (
          <p className="text-muted-foreground text-sm">None recorded for this project.</p>
        ) : (
          <ul className="divide-border divide-y">
            {achievements.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {a.title} <span className="text-muted-foreground text-xs font-normal">{a.kind.toLowerCase()} · {formatDate(a.occurredOn)}</span>
                  </p>
                  {a.metricText ? <p>Metric: {a.metricText}</p> : null}
                  {a.description ? <p className="text-muted-foreground">{a.description}</p> : null}
                  <p className="mt-1 flex gap-1.5">
                    <VerificationBadge state={a.verificationState} />
                    <VisibilityBadge visibility={a.visibility} />
                  </p>
                </div>
                <form action={deleteProjectAchievementAction}>
                  <IdField id={id} />
                  <input type="hidden" name="achievementId" value={a.id} />
                  <Button type="submit" variant="ghost" size="sm" aria-label={`Delete achievement ${a.title}`}>
                    Delete
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <details className="border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Add an achievement</summary>
          <form action={addProjectAchievementAction} className="grid gap-3 border-t p-3 sm:grid-cols-2">
            <IdField id={id} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="a-title">Title</Label>
              <Input id="a-title" name="title" required maxLength={300} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-kind">Type</Label>
              <Select id="a-kind" name="kind" defaultValue="ACHIEVEMENT">
                {achievementKindSchema.options.map((k) => (
                  <option key={k} value={k}>
                    {k.charAt(0) + k.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-date">Date</Label>
              <Input id="a-date" name="occurredOn" type="date" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="a-metric">Metric (optional)</Label>
              <Input id="a-metric" name="metricText" maxLength={300} aria-describedby="a-metric-help" />
              <p id="a-metric-help" className="text-muted-foreground text-xs">
                Only state metrics you can back with evidence. It is stored exactly as you type it and
                is not marked verified until evidence supports it.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="a-desc">Description</Label>
              <Textarea id="a-desc" name="description" rows={3} maxLength={4000} />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton size="sm" pendingLabel="Adding…">
                Add achievement
              </SubmitButton>
            </div>
          </form>
        </details>
      </Section>

      {/* Evidence */}
      <Section
        id="evidence"
        title="Evidence"
        description="Sources that back this project. Provenance is shown for each."
      >
        {evidence.length === 0 ? (
          <EmptyState
            title="No evidence yet"
            description="Link a note, article, demo, or document that shows this work happened."
          />
        ) : (
          <ul className="divide-border divide-y">
            {evidence.map(({ edge, item }) => (
              <li key={edge.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  {item.excerpt ? <p className="text-muted-foreground line-clamp-3">{item.excerpt}</p> : null}
                  <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <VerificationBadge state={item.verificationState} />
                    <span>{SOURCE_LABEL[item.sourceType] ?? item.sourceType}</span>
                    <span>{edge.relation === 'REPRESENTS' ? 'represents this project' : 'supports this project'}</span>
                    <span>{formatDate(item.occurredAt ?? item.createdAt)}</span>
                    {safeHttpHref(item.sourceUrl) ? (
                      <a href={safeHttpHref(item.sourceUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Source
                      </a>
                    ) : null}
                  </p>
                </div>
                <form action={unlinkProjectEvidenceAction}>
                  <IdField id={id} />
                  <input type="hidden" name="edgeId" value={edge.id} />
                  <Button type="submit" variant="ghost" size="sm" aria-label={`Unlink evidence ${item.title}`}>
                    Unlink
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <details className="border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Add a note or link as evidence</summary>
          <form action={addProjectEvidenceAction} className="grid gap-3 border-t p-3 sm:grid-cols-2">
            <IdField id={id} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e-title">Title</Label>
              <Input id="e-title" name="title" required maxLength={300} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e-url">Link</Label>
              <Input id="e-url" name="sourceUrl" type="url" maxLength={500} placeholder="https://" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e-note">Note</Label>
              <Textarea id="e-note" name="excerpt" rows={3} maxLength={2000} />
              <p className="text-muted-foreground text-xs">Provide a note, a link, or both. It is recorded as provided by you.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-date">Date</Label>
              <Input id="e-date" name="occurredOn" type="date" />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton size="sm" pendingLabel="Adding…">
                Add evidence
              </SubmitButton>
            </div>
          </form>
        </details>
      </Section>

      {/* Collaborators */}
      <Section id="collaborators" title="Collaborators">
        {project.collaborators.length === 0 ? (
          <p className="text-muted-foreground text-sm">None listed. Add names in Summary and details.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {project.collaborators.map((c) => (
              <li key={c} className="border-border rounded-md border px-2.5 py-1">
                {c}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Talking points */}
      <Section id="talking-points" title="Interview talking points" description="One per line, up to 20.">
        <form action={saveTalkingPointsAction} className="space-y-2">
          <IdField id={id} />
          <Label htmlFor="talkingPoints" className="sr-only">
            Interview talking points
          </Label>
          <Textarea id="talkingPoints" name="talkingPoints" rows={5} defaultValue={project.talkingPoints.join('\n')} />
          <SubmitButton size="sm">Save talking points</SubmitButton>
        </form>
      </Section>

      {/* Visibility & approval */}
      <Section id="visibility" title="Visibility and approval">
        <form action={setProjectVisibilityAction} className="space-y-2">
          <IdField id={id} />
          <div className="space-y-1.5">
            <Label htmlFor="visibility">Visibility</Label>
            <Select id="visibility" name="visibility" defaultValue={project.visibility} aria-describedby="vis-help" className="max-w-xs">
              {VISIBILITY_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <p id="vis-help" className="text-muted-foreground text-xs">
              Nothing is public unless you choose PUBLIC and enable the portfolio. Private stays
              visible only to you; Career OS only is used inside the app and is never exported.
            </p>
          </div>
          <SubmitButton size="sm" variant="outline">
            Save visibility
          </SubmitButton>
        </form>

        <form action={setProjectApprovalAction} className="border-border space-y-2 border-t pt-3">
          <IdField id={id} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Approval</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="userApproved" defaultChecked={project.userApproved} className="mt-1" />
              <span>
                I confirm this project is accurate
                <span className="text-muted-foreground block text-xs">
                  Unapproved projects are shown only to you and flagged as unconfirmed.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="approvedForApplications"
                defaultChecked={project.approvedForApplications}
                className="mt-1"
              />
              <span>
                Allow use in applications and resumes
                <span className="text-muted-foreground block text-xs">
                  Requires the confirmation above; otherwise it is ignored.
                </span>
              </span>
            </label>
          </fieldset>
          <SubmitButton size="sm" variant="outline">
            Save approval
          </SubmitButton>
        </form>
      </Section>

      {/* Delete */}
      <Section id="danger" title="Delete project">
        <details>
          <summary className="text-destructive cursor-pointer text-sm font-medium">Delete this project…</summary>
          <form action={deleteProjectAction} className="mt-3 space-y-2">
            <IdField id={id} />
            <p className="text-sm">
              This permanently deletes <strong>{project.name}</strong> and its links to skills and
              evidence. Evidence records and achievements are kept unless you delete them separately.
              This cannot be undone.
            </p>
            <SubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">
              Yes, delete project
            </SubmitButton>
          </form>
        </details>
      </Section>
    </div>
  );
}
