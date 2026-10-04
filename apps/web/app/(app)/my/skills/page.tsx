import { loadOwnEvidenceGraph } from '@career-os/database';
import {
  SKILL_STRENGTH_RULES,
  computeAllSkillStrengths,
  safeHttpHref,
  type RankedSkillStrength,
} from '@career-os/shared';
import { Badge, Input, Label, Select, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { EmptyState, StrengthBadge, VerificationBadge } from '../_components/badges';
import { ActionForm } from './action-form';
import { addSkillAction, deleteSkillAction, linkSkillAction } from './actions';
import {
  categoryLabel,
  detectMissingTechnologies,
  filterSortSkills,
  parseSkillListParams,
  qualityLabel,
  recencyLabel,
  skillEvidenceItems,
} from './helpers';

export const metadata = { title: 'Skills · myOS' };

function entityHref(type: string, id: string): string | null {
  if (type === 'PROJECT') return `/my/projects/${id}`;
  if (type === 'EXPERIENCE') return '/profile';
  if (type === 'STORY') return `/my/stories/${id}`;
  if (type === 'ACHIEVEMENT') return `/my/achievements#a-${id}`;
  return null;
}

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseSkillListParams(await searchParams);
  const user = await requireUser();
  const supabase = await createClient();
  const graph = await loadOwnEvidenceGraph(supabase, user.id);
  const now = new Date();

  const all = computeAllSkillStrengths(graph, now);
  const rows = filterSortSkills(all, params);
  const categories = [
    ...new Set(graph.skills.map((s) => s.category).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));
  const suggestions = detectMissingTechnologies(graph);
  const hasFilter = !!(params.q || params.category || params.sort !== 'strength');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A skill is only as strong as the projects, experience, and evidence behind it. Strength is
          derived, never self-rated.
        </p>
      </div>

      <details className="border-border rounded-md border text-sm">
        <summary className="focus-visible:ring-ring cursor-pointer rounded-md px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2">
          How strength is calculated
        </summary>
        <div className="border-border space-y-3 border-t px-3 py-3">
          <dl className="space-y-2">
            {SKILL_STRENGTH_RULES.levels.map((l) => (
              <div key={l.level} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                <dt className="sm:w-28 sm:shrink-0">
                  <StrengthBadge level={l.level} />
                </dt>
                <dd className="text-muted-foreground">{l.rule}</dd>
              </div>
            ))}
          </dl>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            {SKILL_STRENGTH_RULES.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </details>

      <section aria-labelledby="add-skill-heading" className="space-y-2">
        <h2 id="add-skill-heading" className="text-sm font-medium">
          Add a skill
        </h2>
        <ActionForm action={addSkillAction} submitLabel="Add skill" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="skill-name">Name</Label>
              <Input id="skill-name" name="name" required maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="skill-category">Category (optional)</Label>
              <Input
                id="skill-category"
                name="category"
                maxLength={60}
                list="skill-categories"
                placeholder="e.g. Language, Framework"
              />
              <datalist id="skill-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
        </ActionForm>
        <p className="text-muted-foreground text-xs">
          A new skill starts at NONE until you link it to a project or experience.
        </p>
      </section>

      {graph.skills.length === 0 ? (
        <EmptyState
          title="No skills yet"
          description="Add a skill above, or accept a detected technology below. Then link each skill to the projects and experience that demonstrate it."
        />
      ) : (
        <section aria-labelledby="skills-heading" className="space-y-3">
          <h2 id="skills-heading" className="sr-only">
            Your skills
          </h2>
          <form method="get" className="flex flex-wrap items-end gap-3" role="search">
            <div className="space-y-1">
              <Label htmlFor="filter-q">Search</Label>
              <Input id="filter-q" name="q" defaultValue={params.q} className="w-44" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-category">Category</Label>
              <Select
                id="filter-category"
                name="category"
                defaultValue={params.category}
                className="w-44"
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__none__">Uncategorized</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-sort">Sort by</Label>
              <Select id="filter-sort" name="sort" defaultValue={params.sort} className="w-40">
                <option value="strength">Strength</option>
                <option value="recency">Recency</option>
                <option value="name">Name</option>
              </Select>
            </div>
            <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Apply
            </button>
            {hasFilter ? (
              <Link href="/my/skills" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Clear
              </Link>
            ) : null}
          </form>

          <p className="text-muted-foreground text-sm" aria-live="polite">
            Showing {rows.length} of {all.length} skill{all.length === 1 ? '' : 's'}.
          </p>

          <ul className="space-y-2">
            {rows.map((row) => (
              <SkillRow key={row.skill.id} row={row} graph={graph} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="suggestions-heading" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="suggestions-heading" className="text-sm font-medium">
            Detected technologies not yet in your skills
          </h2>
          <Badge variant="outline">Inferred</Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          Found by matching a technology dictionary against your project and experience text. These
          are suggestions only; nothing is added until you click Add.
        </p>
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No new technologies detected.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => (
              <li key={s.name} className="border-border rounded-md border px-3 py-2 text-sm">
                <ActionForm action={addSkillAction} submitLabel="Add" variant="outline">
                  <input type="hidden" name="name" value={s.name} />
                  <input type="hidden" name="category" value={categoryLabel(s.category)} />
                  <p className="font-medium">
                    {s.name}{' '}
                    <span className="text-muted-foreground font-normal">
                      ({categoryLabel(s.category)})
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Mentioned in: {s.sources.slice(0, 3).join(', ')}
                    {s.sources.length > 3 ? ` +${s.sources.length - 3} more` : ''}
                  </p>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SkillRow({
  row,
  graph,
}: {
  row: RankedSkillStrength;
  graph: Awaited<ReturnType<typeof loadOwnEvidenceGraph>>;
}) {
  const { skill, strength } = row;
  const projects = strength.supportingEntities.filter((e) => e.type === 'PROJECT');
  const experiences = strength.supportingEntities.filter((e) => e.type === 'EXPERIENCE');
  const others = strength.supportingEntities.filter(
    (e) => e.type !== 'PROJECT' && e.type !== 'EXPERIENCE',
  );
  const evidence = skillEvidenceItems(
    graph,
    skill.id,
    strength.supportingEntities.map((e) => e.id),
  );
  const linkedIds = new Set(strength.supportingEntities.map((e) => e.id));
  const linkable = [
    ...graph.projects.filter((p) => !linkedIds.has(p.id)).map((p) => ({
      value: `PROJECT:${p.id}`,
      label: `Project: ${p.name}`,
    })),
    ...graph.experiences.filter((e) => !linkedIds.has(e.id)).map((e) => ({
      value: `EXPERIENCE:${e.id}`,
      label: `Experience: ${e.title} at ${e.company}`,
    })),
  ];

  return (
    <li className="border-border rounded-md border">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {skill.name}
            {skill.category ? <Badge variant="outline">{skill.category}</Badge> : null}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {recencyLabel(strength.recency, strength.latestActivity)} · {strength.evidenceCount}{' '}
            evidence ({strength.verifiedEvidenceCount} verified) · {qualityLabel(strength.quality)}
          </p>
          <p className="mt-1 text-xs">
            <EntityLinks label="Projects" items={projects} />
            <EntityLinks label="Experience" items={experiences} />
            <EntityLinks label="Other" items={others} />
            {strength.supportingEntities.length === 0 ? (
              <span className="text-muted-foreground">Not linked to anything yet.</span>
            ) : null}
          </p>
        </div>
        <StrengthBadge level={strength.level} />
      </div>

      <details className="border-border border-t text-sm">
        <summary className="focus-visible:ring-ring text-muted-foreground cursor-pointer px-3 py-2 focus-visible:outline-none focus-visible:ring-2">
          Why this strength?
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <ul className="list-disc space-y-1 pl-5">
            {strength.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide">Supporting items</h4>
            {strength.supportingEntities.length === 0 ? (
              <p className="text-muted-foreground text-xs">None.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {strength.supportingEntities.map((e) => {
                  const href = entityHref(e.type, e.id);
                  return (
                    <li key={`${e.type}:${e.id}`} className="text-xs">
                      <span className="text-muted-foreground">{categoryLabel(e.type)}: </span>
                      {href ? (
                        <Link href={href} className="underline underline-offset-2">
                          {e.name}
                        </Link>
                      ) : (
                        e.name
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide">Evidence</h4>
            {evidence.length === 0 ? (
              <p className="text-muted-foreground text-xs">No evidence attached.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {evidence.map((item) => (
                  <li key={item.evidence.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <VerificationBadge state={item.evidence.verificationState} />
                    {safeHttpHref(item.evidence.sourceUrl) ? (
                      <a
                        href={safeHttpHref(item.evidence.sourceUrl) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {item.evidence.title}
                      </a>
                    ) : (
                      <span>{item.evidence.title}</span>
                    )}
                    <span className="text-muted-foreground">
                      {categoryLabel(item.evidence.sourceType)}
                      {item.countsAsVerified ? ' · counts as verified' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ActionForm
            action={deleteSkillAction}
            submitLabel="Delete skill"
            pendingLabel="Deleting…"
            variant="ghost"
            confirmMessage={`Delete the skill "${skill.name}"? Its links to projects and experience are removed; the projects and evidence themselves are kept.`}
          >
            <input type="hidden" name="id" value={skill.id} />
          </ActionForm>

          {linkable.length > 0 ? (
            <ActionForm action={linkSkillAction} submitLabel="Link" variant="outline">
              <input type="hidden" name="skillId" value={skill.id} />
              <Label htmlFor={`link-${skill.id}`}>Link to a project or experience</Label>
              <Select id={`link-${skill.id}`} name="target" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {linkable.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </ActionForm>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function EntityLinks({
  label,
  items,
}: {
  label: string;
  items: Array<{ type: string; id: string; name: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <span className="mr-3 inline-block">
      <span className="text-muted-foreground">{label}: </span>
      {items.map((e, i) => {
        const href = entityHref(e.type, e.id);
        return (
          <span key={e.id}>
            {i > 0 ? ', ' : ''}
            {href ? (
              <Link href={href} className="underline underline-offset-2">
                {e.name}
              </Link>
            ) : (
              e.name
            )}
          </span>
        );
      })}
    </span>
  );
}
