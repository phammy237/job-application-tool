import { loadOwnEvidenceGraph } from '@career-os/database';
import { Badge, Input, Label, Select, Textarea } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { EmptyState, VerificationBadge, VisibilityBadge } from '../_components/badges';
import { ActionForm } from '../skills/action-form';
import { AchievementSupport } from './achievement-support';
import { createAchievementAction, deleteAchievementAction } from './actions';

export const metadata = { title: 'Achievements · myOS' };

export default async function AchievementsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const graph = await loadOwnEvidenceGraph(supabase, user.id);

  const projectName = new Map(graph.projects.map((p) => [p.id, p.name]));
  const experienceName = new Map(graph.experiences.map((e) => [e.id, `${e.title} at ${e.company}`]));
  const evidenceCount = new Map<string, number>();
  const linkedEvidence = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.relation === 'SUPPORTS' && edge.toType === 'ACHIEVEMENT') {
      evidenceCount.set(edge.toId, (evidenceCount.get(edge.toId) ?? 0) + 1);
      if (edge.fromType === 'EVIDENCE') {
        const set = linkedEvidence.get(edge.toId) ?? new Set<string>();
        set.add(edge.fromId);
        linkedEvidence.set(edge.toId, set);
      }
    }
  }
  const evidenceOptionsFor = (achievementId: string) =>
    graph.evidence
      .filter((e) => !linkedEvidence.get(achievementId)?.has(e.id))
      .map((e) => ({ id: e.id, label: e.title + ' (' + e.sourceType + ')' }));
  const achievements = [...graph.achievements].sort((a, b) =>
    (b.occurredOn ?? '').localeCompare(a.occurredOn ?? '') || a.title.localeCompare(b.title),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Achievements</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Awards, launches, leadership moments, and metrics. They appear on your{' '}
          <Link href="/my/timeline" className="underline underline-offset-2">
            timeline
          </Link>
          .
        </p>
      </div>

      <section aria-labelledby="add-achievement" className="space-y-2">
        <h2 id="add-achievement" className="text-sm font-medium">
          Add an achievement
        </h2>
        <ActionForm action={createAchievementAction} submitLabel="Add achievement" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ach-title">Title</Label>
              <Input id="ach-title" name="title" required maxLength={300} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ach-kind">Kind</Label>
              <Select id="ach-kind" name="kind" defaultValue="ACHIEVEMENT">
                <option value="ACHIEVEMENT">Achievement</option>
                <option value="AWARD">Award</option>
                <option value="METRIC">Metric</option>
                <option value="LAUNCH">Launch</option>
                <option value="LEADERSHIP">Leadership</option>
                <option value="MILESTONE">Milestone</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ach-date">Date (optional)</Label>
              <Input id="ach-date" name="occurredOn" type="date" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ach-metric">Metric (optional)</Label>
              <Input
                id="ach-metric"
                name="metricText"
                maxLength={300}
                aria-describedby="ach-metric-help"
              />
              <p id="ach-metric-help" className="text-muted-foreground text-xs">
                State only metrics you can evidence. A metric is never marked verified until a
                supporting evidence item is linked.
              </p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ach-desc">Description (optional)</Label>
              <Textarea id="ach-desc" name="description" rows={3} maxLength={4000} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ach-project">Project (optional)</Label>
              <Select id="ach-project" name="projectId" defaultValue="">
                <option value="">None</option>
                {graph.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ach-exp">Experience (optional)</Label>
              <Select id="ach-exp" name="experienceId" defaultValue="">
                <option value="">None</option>
                {graph.experiences.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} at {e.company}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ach-vis">Visibility</Label>
              <Select id="ach-vis" name="visibility" defaultValue="PRIVATE">
                <option value="PRIVATE">Private</option>
                <option value="CAREER_OS_ONLY">Career OS only</option>
                <option value="PUBLIC">Public</option>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="ach-approved"
                name="userApproved"
                type="checkbox"
                className="focus-visible:ring-ring h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2"
              />
              <Label htmlFor="ach-approved">I confirm this is accurate</Label>
            </div>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="ach-list" className="space-y-2">
        <h2 id="ach-list" className="text-sm font-medium">
          Your achievements ({achievements.length})
        </h2>
        {achievements.length === 0 ? (
          <EmptyState
            title="No achievements yet"
            description="Record an award, launch, or measurable result, with only claims you can back up."
          />
        ) : (
          <ul className="space-y-2">
            {achievements.map((a) => {
              const owner =
                (a.projectId && projectName.get(a.projectId)) ||
                (a.experienceId && experienceName.get(a.experienceId)) ||
                null;
              const count = evidenceCount.get(a.id) ?? 0;
              return (
                <li
                  key={a.id}
                  id={`a-${a.id}`}
                  className="border-border scroll-mt-20 rounded-md border px-3 py-2 text-sm target:ring-2 target:ring-[hsl(var(--ring))]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{a.title}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        <Badge variant="outline">{a.kind}</Badge>{' '}
                        {a.occurredOn ?? 'Undated'}
                        {owner ? ` · ${owner}` : ''}
                        {` · ${count} evidence item${count === 1 ? '' : 's'}`}
                        {a.userApproved ? '' : ' · not approved'}
                      </p>
                      {a.metricText ? (
                        <p className="mt-1 text-xs">
                          <span className="text-muted-foreground">Metric: </span>
                          {a.metricText}
                        </p>
                      ) : null}
                      {a.description ? (
                        <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">
                          {a.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <VerificationBadge state={a.verificationState} />
                      <VisibilityBadge visibility={a.visibility} />
                    </div>
                  </div>
                  <AchievementSupport
                    achievementId={a.id}
                    evidenceCount={count}
                    verified={a.verificationState === 'VERIFIED'}
                    options={evidenceOptionsFor(a.id)}
                  />
                  <ActionForm
                    action={deleteAchievementAction}
                    submitLabel="Delete"
                    pendingLabel="Deleting…"
                    variant="ghost"
                    confirmMessage={`Delete "${a.title}"? This cannot be undone.`}
                    className="mt-1"
                  >
                    <input type="hidden" name="id" value={a.id} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
