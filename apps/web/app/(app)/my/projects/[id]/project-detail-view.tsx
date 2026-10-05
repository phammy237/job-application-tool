import {
  achievementKindSchema,
  safeHttpHref,
  type EvidenceGraphData,
  type GithubRepository,
  type MyosCandidate,
} from '@career-os/shared';
import { Input, Label, Select, Textarea } from '@career-os/ui';
import { formatDate } from '../../../../../lib/myos/home';
import { AchievementSupport } from '../../achievements/achievement-support';
import {
  EmptyState,
  FlagBadge,
  TonePill,
  VerificationBadge,
  VisibilityBadge,
} from '../../_components/badges';
import {
  Collapsible,
  CollapsibleGroup,
  CollapsibleGroupControls,
} from '../../_components/collapsible';
import { Feedback } from '../../_components/feedback';
import { Mutation, PageHeader } from '../../_components/page-header';
import {
  acceptCandidateAction,
  addProjectAchievementAction,
  addProjectEvidenceAction,
  addProjectSkillAction,
  deleteProjectAchievementAction,
  deleteProjectAction,
  deleteProjectEvidenceAction,
  rejectCandidateAction,
  removeProjectSkillAction,
  saveTalkingPointsAction,
  setProjectApprovalAction,
  setProjectVisibilityAction,
  unlinkProjectEvidenceAction,
  updateProjectAction,
} from '../actions';
import { ConfirmDeleteForm } from '../_components/confirm-delete-form';
import { SubmitButton } from '../_components/submit-button';
import { VisibilitySelect } from '../_components/visibility-select';
import type { ProjectDetailView as ProjectSlice } from '../detail-helpers';

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

export const SOURCE_LABEL: Record<string, string> = {
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

const CANDIDATE_KIND: Record<string, string> = {
  SKILL: 'Skill',
  TALKING_POINT: 'Talking point',
  PROJECT_SUMMARY: 'Summary',
  COMPETENCY: 'Competency',
};

const rowList = 'divide-border -my-2 divide-y';

function IdField({ id }: { id: string }) {
  return <input type="hidden" name="id" value={id} />;
}

export interface ProjectDetailViewProps {
  graph: EvidenceGraphData;
  view: ProjectSlice;
  /** Pending candidates for THIS project only. */
  pending: MyosCandidate[];
  repo: Pick<GithubRepository, 'fullName' | 'htmlUrl'> | null;
  notice?: string;
  error?: string;
  readOnly?: boolean;
}

export function ProjectDetailView({
  graph,
  view,
  pending,
  repo,
  notice,
  error,
  readOnly,
}: ProjectDetailViewProps) {
  const { project, skills, achievements, evidence } = view;
  const id = project.id;

  // EVIDENCE→ACHIEVEMENT support links grouped once, instead of a full edge scan per achievement.
  const supportByAchievement = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (
      e.relation !== 'SUPPORTS' ||
      e.fromType !== 'EVIDENCE' ||
      e.toType !== 'ACHIEVEMENT'
    )
      continue;
    const set = supportByAchievement.get(e.toId) ?? new Set<string>();
    set.add(e.fromId);
    supportByAchievement.set(e.toId, set);
  }
  const supportFor = (achievementId: string) => {
    const linked = supportByAchievement.get(achievementId) ?? new Set<string>();
    return {
      count: linked.size,
      options: graph.evidence
        .filter((e) => !linked.has(e.id))
        .map((e) => ({ id: e.id, label: `${e.title} (${e.sourceType})` })),
    };
  };

  const statusLabel = project.status
    ? STATUS_OPTIONS.find((s) => s[0] === project.status)?.[1]
    : null;
  const projectHref = safeHttpHref(project.url);
  const repoHref = repo ? safeHttpHref(repo.htmlUrl) : null;

  const jump: [string, string, number | null][] = [
    ['suggestions', 'Suggestions', pending.length],
    ['skills', 'Skills', skills.length],
    ['achievements', 'Achievements', achievements.length],
    ['evidence', 'Evidence', evidence.length],
    ['talking-points', 'Talking points', project.talkingPoints.length],
    ['details', 'Details', null],
    ['visibility', 'Visibility', null],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={{ href: '/my/projects', label: 'Projects' }}
        title={project.name}
        description={project.summary ?? undefined}
        actions={
          <>
            {projectHref ? (
              <a
                href={projectHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary min-h-10 content-center text-sm hover:underline"
              >
                Project link<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {repo && repoHref ? (
              <a
                href={repoHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary min-h-10 content-center break-all text-sm hover:underline"
              >
                {repo.fullName}
                <span className="sr-only"> repository (opens in a new tab)</span>
              </a>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <TonePill tone="neutral">
            {project.origin === 'GITHUB'
              ? 'GitHub'
              : project.origin === 'RESUME'
                ? 'Resume'
                : 'Manual'}
          </TonePill>
          <VisibilityBadge visibility={project.visibility} />
          {project.userApproved ? (
            <TonePill tone="success">Approved</TonePill>
          ) : (
            <FlagBadge>Unapproved</FlagBadge>
          )}
          {evidence.length === 0 ? <FlagBadge>No evidence</FlagBadge> : null}
          <span className="text-muted-foreground text-xs">
            {[project.role, statusLabel].filter(Boolean).join(' · ') ||
              'No role or status set'}
            {' · '}
            {formatDate(project.startDate)} to{' '}
            {project.endDate ? formatDate(project.endDate) : 'present'}
          </span>
        </div>
      </PageHeader>

      <Feedback notice={notice} error={error} />

      <nav aria-label="On this page" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1.5">
          {jump.map(([anchor, label, n]) => (
            <li key={anchor}>
              <a
                href={`#${anchor}`}
                className="border-border hover:bg-accent focus-visible:ring-ring inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2"
              >
                {label}
                {n !== null ? (
                  <span className="text-muted-foreground tabular-nums">{n}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <CollapsibleGroup>
        <div className="flex justify-end">
          <CollapsibleGroupControls label="project sections" />
        </div>
        <div className="mt-1 space-y-3">
          {/* Suggestions */}
          <Collapsible
            id="suggestions"
            title="Suggestions to confirm"
            count={pending.length}
            summary="Detected automatically. Nothing here is part of your profile until you accept it."
            headingLevel={2}
            defaultOpen={pending.length > 0}
          >
            {pending.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No pending suggestions for this project.
              </p>
            ) : (
              <ul className={rowList}>
                {pending.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0 flex-1 basis-56 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <TonePill tone="warning">
                          {CANDIDATE_KIND[c.payload.kind]}
                        </TonePill>
                        <span className="font-medium">
                          {c.payload.kind === 'SKILL'
                            ? c.payload.skill
                            : c.payload.kind === 'COMPETENCY'
                              ? c.payload.competency.replace(/_/g, ' ').toLowerCase()
                              : c.payload.text}
                        </span>
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        Inferred from {c.rationale ?? 'repository data'} — not yet part of
                        your profile
                      </p>
                    </div>
                    <Mutation readOnly={readOnly}>
                      <div className="flex gap-2">
                        <form action={acceptCandidateAction}>
                          <IdField id={id} />
                          <input type="hidden" name="candidateId" value={c.id} />
                          <SubmitButton
                            size="sm"
                            className="h-10"
                            pendingLabel="Accepting…"
                          >
                            Accept
                          </SubmitButton>
                        </form>
                        <form action={rejectCandidateAction}>
                          <IdField id={id} />
                          <input type="hidden" name="candidateId" value={c.id} />
                          <SubmitButton
                            size="sm"
                            variant="outline"
                            className="h-10"
                            pendingLabel="Rejecting…"
                          >
                            Reject
                          </SubmitButton>
                        </form>
                      </div>
                    </Mutation>
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>

          {/* Skills */}
          <Collapsible
            id="skills"
            title="Technologies and skills"
            count={skills.length}
            summary="Skills this project demonstrates."
            headingLevel={2}
            defaultOpen
            storageKey="project:skills"
          >
            {skills.length === 0 ? (
              <p className="text-muted-foreground text-sm">No skills linked yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {skills.map(({ edge, skill }) => (
                  <li
                    key={edge.id}
                    className="border-border bg-background flex items-center gap-2 rounded-full border py-0.5 pl-3 pr-0.5 text-sm"
                  >
                    <span className="font-medium">{skill.name}</span>
                    <VerificationBadge state={edge.verificationState} />
                    <Mutation readOnly={readOnly}>
                      <form action={removeProjectSkillAction}>
                        <IdField id={id} />
                        <input type="hidden" name="edgeId" value={edge.id} />
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 rounded-full p-0"
                          pendingLabel="…"
                          aria-label={`Remove ${skill.name} from this project`}
                          title={`Remove ${skill.name}`}
                        >
                          <span aria-hidden="true">×</span>
                        </SubmitButton>
                      </form>
                    </Mutation>
                  </li>
                ))}
              </ul>
            )}
            <Mutation readOnly={readOnly}>
              <form
                action={addProjectSkillAction}
                className="mt-3 flex flex-wrap items-end gap-2"
              >
                <IdField id={id} />
                <div className="min-w-0 flex-1 basis-48 space-y-1.5 sm:max-w-xs">
                  <Label htmlFor="skill">Add a skill</Label>
                  <Input
                    id="skill"
                    name="skill"
                    required
                    maxLength={80}
                    placeholder="e.g. PostgreSQL"
                    autoComplete="off"
                  />
                </div>
                <SubmitButton
                  size="sm"
                  variant="outline"
                  className="h-10"
                  pendingLabel="Adding…"
                >
                  Add
                </SubmitButton>
              </form>
            </Mutation>
          </Collapsible>

          {/* Achievements */}
          <Collapsible
            id="achievements"
            title="Achievements, metrics, and awards"
            count={achievements.length}
            headingLevel={2}
            defaultOpen
            storageKey="project:achievements"
          >
            {achievements.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None recorded for this project.
              </p>
            ) : (
              <ul className={rowList}>
                {achievements.map((a) => {
                  const support = supportFor(a.id);
                  return (
                    <li key={a.id} className="space-y-1.5 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 basis-56">
                          <p className="font-medium">{a.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {a.kind.charAt(0) + a.kind.slice(1).toLowerCase()} ·{' '}
                            {formatDate(a.occurredOn)}
                          </p>
                          {a.metricText ? (
                            <p className="mt-1 text-xs">
                              <span className="text-muted-foreground">Metric: </span>
                              {a.metricText}
                            </p>
                          ) : null}
                          {a.description ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {a.description}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <VerificationBadge state={a.verificationState} />
                          <VisibilityBadge visibility={a.visibility} />
                          <Mutation readOnly={readOnly}>
                            <form action={deleteProjectAchievementAction}>
                              <IdField id={id} />
                              <input type="hidden" name="achievementId" value={a.id} />
                              <SubmitButton
                                variant="ghost"
                                size="sm"
                                className="h-10"
                                pendingLabel="Deleting…"
                                aria-label={`Delete achievement ${a.title}`}
                              >
                                Delete
                              </SubmitButton>
                            </form>
                          </Mutation>
                        </div>
                      </div>
                      <AchievementSupport
                        achievementId={a.id}
                        evidenceCount={support.count}
                        verified={a.verificationState === 'VERIFIED'}
                        options={support.options}
                        readOnly={readOnly}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <Collapsible
              variant="row"
              headingLevel={null}
              title="Add an achievement"
              className="bg-background mt-3"
            >
              <Mutation readOnly={readOnly}>
                <form
                  action={addProjectAchievementAction}
                  className="grid gap-3 sm:grid-cols-2"
                >
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
                    <Input
                      id="a-metric"
                      name="metricText"
                      maxLength={300}
                      aria-describedby="a-metric-help"
                    />
                    <p id="a-metric-help" className="text-muted-foreground text-xs">
                      Only state metrics you can back with evidence. It is stored exactly
                      as you type it and is not marked verified until evidence supports
                      it.
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
              </Mutation>
            </Collapsible>
          </Collapsible>

          {/* Evidence */}
          <Collapsible
            id="evidence"
            title="Evidence"
            count={evidence.length}
            summary="Sources that back this project. Provenance is shown for each."
            headingLevel={2}
            defaultOpen
            storageKey="project:evidence"
          >
            {evidence.length === 0 ? (
              <EmptyState
                title="No evidence yet"
                description="Link a note, article, demo, or document that shows this work happened."
              />
            ) : (
              <ul className={rowList}>
                {evidence.map(({ edge, item }) => {
                  const href = safeHttpHref(item.sourceUrl);
                  return (
                    <li
                      key={edge.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
                    >
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="font-medium">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {item.title}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            item.title
                          )}
                        </p>
                        {item.excerpt ? (
                          <p className="text-muted-foreground line-clamp-2 text-xs">
                            {item.excerpt}
                          </p>
                        ) : null}
                        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <VerificationBadge state={item.verificationState} />
                          <span>{SOURCE_LABEL[item.sourceType] ?? item.sourceType}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {edge.relation === 'REPRESENTS'
                              ? 'represents this project'
                              : 'supports this project'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatDate(item.occurredAt ?? item.createdAt)}</span>
                        </p>
                      </div>
                      <Mutation readOnly={readOnly}>
                        <div className="flex gap-1">
                          <form action={unlinkProjectEvidenceAction}>
                            <IdField id={id} />
                            <input type="hidden" name="edgeId" value={edge.id} />
                            <SubmitButton
                              variant="ghost"
                              size="sm"
                              className="h-10"
                              pendingLabel="Unlinking…"
                              aria-label={`Unlink evidence ${item.title}`}
                            >
                              Unlink
                            </SubmitButton>
                          </form>
                          <ConfirmDeleteForm
                            action={deleteProjectEvidenceAction}
                            fields={{ id, evidenceId: item.id }}
                            label="Delete"
                            ariaLabel={`Delete evidence ${item.title}`}
                            message={`Delete the evidence "${item.title}"? It is removed everywhere it is linked (other projects and achievements lose this support). This cannot be undone.`}
                          />
                        </div>
                      </Mutation>
                    </li>
                  );
                })}
              </ul>
            )}
            <Collapsible
              variant="row"
              headingLevel={null}
              title="Add a note or link as evidence"
              className="bg-background mt-3"
            >
              <Mutation readOnly={readOnly}>
                <form
                  action={addProjectEvidenceAction}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <IdField id={id} />
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="e-title">Title</Label>
                    <Input id="e-title" name="title" required maxLength={300} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="e-url">Link</Label>
                    <Input
                      id="e-url"
                      name="sourceUrl"
                      type="url"
                      maxLength={500}
                      placeholder="https://"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="e-note">Note</Label>
                    <Textarea id="e-note" name="excerpt" rows={3} maxLength={2000} />
                    <p className="text-muted-foreground text-xs">
                      Provide a note, a link, or both. It is recorded as provided by you.
                    </p>
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
              </Mutation>
            </Collapsible>
          </Collapsible>

          {/* Talking points */}
          <Collapsible
            id="talking-points"
            title="Interview talking points"
            count={project.talkingPoints.length}
            summary="Your own words, one per line, up to 20."
            headingLevel={2}
            storageKey="project:talking-points"
          >
            {project.talkingPoints.length > 0 ? (
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
                {project.talkingPoints.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
            <Mutation readOnly={readOnly}>
              <form action={saveTalkingPointsAction} className="space-y-2">
                <IdField id={id} />
                <Label htmlFor="talkingPoints">Edit talking points</Label>
                <Textarea
                  id="talkingPoints"
                  name="talkingPoints"
                  rows={4}
                  defaultValue={project.talkingPoints.join('\n')}
                />
                <SubmitButton size="sm" variant="outline">
                  Save talking points
                </SubmitButton>
              </form>
            </Mutation>
          </Collapsible>

          {/* Collaborators */}
          <Collapsible
            id="collaborators"
            title="Collaborators"
            count={project.collaborators.length}
            headingLevel={2}
            storageKey="project:collaborators"
          >
            {project.collaborators.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None listed. Add names in Summary and details.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {project.collaborators.map((c) => (
                  <li key={c} className="border-border rounded-full border px-3 py-1">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>

          {/* Summary & details */}
          <Collapsible
            id="details"
            title="Summary and details"
            summary="Name, role, dates, link, summary and description."
            headingLevel={2}
            defaultOpen={error === 'invalid'}
          >
            <Mutation readOnly={readOnly}>
              <form action={updateProjectAction} className="grid gap-3 sm:grid-cols-2">
                <IdField id={id} />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={project.name}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role">Your role</Label>
                  <Input
                    id="role"
                    name="role"
                    maxLength={200}
                    defaultValue={project.role ?? ''}
                  />
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
                  <Input
                    id="startDate"
                    name="startDate"
                    type="date"
                    defaultValue={project.startDate ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate">End date</Label>
                  <Input
                    id="endDate"
                    name="endDate"
                    type="date"
                    defaultValue={project.endDate ?? ''}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="url">Link</Label>
                  <Input
                    id="url"
                    name="url"
                    type="url"
                    maxLength={500}
                    defaultValue={project.url ?? ''}
                    placeholder="https://"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="summary">Summary</Label>
                  <Textarea
                    id="summary"
                    name="summary"
                    rows={3}
                    maxLength={4000}
                    defaultValue={project.summary ?? ''}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={5}
                    maxLength={8000}
                    defaultValue={project.description ?? ''}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="collaborators-input">Collaborators</Label>
                  <Input
                    id="collaborators-input"
                    name="collaborators"
                    defaultValue={project.collaborators.join(', ')}
                    aria-describedby="collab-help"
                  />
                  <p id="collab-help" className="text-muted-foreground text-xs">
                    Comma-separated names.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton size="sm">Save details</SubmitButton>
                </div>
              </form>
            </Mutation>
          </Collapsible>

          {/* Visibility & approval */}
          <Collapsible
            id="visibility"
            title="Visibility and approval"
            summary={`${
              VISIBILITY_OPTIONS.find((v) => v[0] === project.visibility)?.[1] ?? ''
            } · ${project.userApproved ? 'confirmed' : 'not confirmed'} · ${
              project.userApproved && project.approvedForApplications
                ? 'used in applications'
                : 'not used in applications'
            }`}
            headingLevel={2}
          >
            <Mutation readOnly={readOnly}>
              <form action={setProjectVisibilityAction} className="space-y-2">
                <IdField id={id} />
                <div className="space-y-1.5">
                  <Label htmlFor="visibility-select">Visibility</Label>
                  <VisibilitySelect
                    defaultValue={project.visibility}
                    options={VISIBILITY_OPTIONS}
                  />
                  <p id="vis-help" className="text-muted-foreground text-xs">
                    Nothing is public unless you choose PUBLIC and enable the portfolio.
                    Private stays visible only to you; Career OS only is used inside the
                    app and is never exported.
                  </p>
                </div>
                <SubmitButton size="sm" variant="outline">
                  Save visibility
                </SubmitButton>
              </form>

              <form
                action={setProjectApprovalAction}
                className="border-border mt-4 space-y-2 border-t pt-4"
              >
                <IdField id={id} />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Approval</legend>
                  <label className="flex min-h-10 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="userApproved"
                      defaultChecked={project.userApproved}
                      className="accent-primary mt-1 h-4 w-4"
                    />
                    <span>
                      I confirm this project is accurate
                      <span className="text-muted-foreground block text-xs">
                        Unapproved projects are shown only to you and flagged as
                        unconfirmed.
                      </span>
                    </span>
                  </label>
                  <label className="flex min-h-10 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="approvedForApplications"
                      defaultChecked={project.approvedForApplications}
                      className="accent-primary mt-1 h-4 w-4"
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
            </Mutation>
          </Collapsible>

          {/* Delete */}
          <Collapsible
            id="danger"
            title="Delete project"
            summary="Permanently removes this project."
            headingLevel={2}
          >
            <Mutation readOnly={readOnly}>
              <form action={deleteProjectAction} className="space-y-2">
                <IdField id={id} />
                <p className="text-sm">
                  This permanently deletes <strong>{project.name}</strong> and its links
                  to skills and evidence. Evidence records and achievements are kept
                  unless you delete them separately. This cannot be undone.
                </p>
                <SubmitButton size="sm" variant="destructive" pendingLabel="Deleting…">
                  Yes, delete project
                </SubmitButton>
              </form>
            </Mutation>
          </Collapsible>
        </div>
      </CollapsibleGroup>
    </div>
  );
}
