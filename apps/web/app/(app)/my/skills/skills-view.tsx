import {
  SKILL_LEVEL_RANK,
  SKILL_STRENGTH_RULES,
  computeAllSkillStrengths,
  safeHttpHref,
  type EvidenceGraphData,
  type RankedSkillStrength,
} from '@career-os/shared';
import { Input, Label, Select, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { ActionForm } from '../_components/action-form';
import {
  EmptyState,
  StrengthBadge,
  SubHeading,
  TonePill,
  VerificationBadge,
} from '../_components/badges';
import { Collapsible } from '../_components/collapsible';
import { FilterableList, type FilterItem } from '../_components/filterable-list';
import type { FilterState } from '../_components/filter-state';
import { Mutation, PageHeader } from '../_components/page-header';
import { addSkillAction, deleteSkillAction, linkSkillAction } from './actions';
import {
  categoryLabel,
  detectMissingTechnologies,
  indexSupportingEvidence,
  qualityLabel,
  recencyLabel,
  skillEvidenceItems,
  type SupportingEvidenceIndex,
} from './helpers';

function entityHref(type: string, id: string): string | null {
  if (type === 'PROJECT') return `/my/projects/${id}`;
  if (type === 'EXPERIENCE') return '/profile';
  if (type === 'STORY') return `/my/stories/${id}`;
  if (type === 'ACHIEVEMENT') return `/my/achievements#a-${id}`;
  return null;
}

const STRENGTH_OPTIONS = [
  { value: 'STRONG', label: 'Well supported' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'LIMITED', label: 'Limited' },
  { value: 'NONE', label: 'No evidence' },
];

export interface SkillsViewProps {
  graph: EvidenceGraphData;
  initial: FilterState;
  now?: Date;
  readOnly?: boolean;
}

export function SkillsView({
  graph,
  initial,
  now = new Date(),
  readOnly,
}: SkillsViewProps) {
  const all = computeAllSkillStrengths(graph, now).sort((a, b) =>
    a.skill.name.localeCompare(b.skill.name),
  );
  const evidenceIndex = indexSupportingEvidence(graph);
  const categories = [
    ...new Set(graph.skills.map((s) => s.category).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));
  const suggestions = detectMissingTechnologies(graph);
  const levelsPresent = STRENGTH_OPTIONS.filter((o) =>
    all.some((r) => r.strength.level === o.value),
  );

  const items: FilterItem[] = all.map((row) => ({
    id: row.skill.id,
    text: `${row.skill.name} ${row.skill.category ?? ''}`.toLowerCase(),
    facets: {
      category: row.skill.category ?? '__none__',
      strength: row.strength.level,
    },
    sortValues: {
      strength:
        SKILL_LEVEL_RANK[row.strength.level] * 10000 +
        row.strength.verifiedEvidenceCount * 100 +
        row.strength.evidenceCount,
      recency: -(row.strength.monthsSinceLatest ?? 100000),
      name: row.skill.name.toLowerCase(),
      evidence: row.strength.evidenceCount,
    },
    node: (
      <SkillRow
        row={row}
        graph={graph}
        evidenceIndex={evidenceIndex}
        readOnly={readOnly}
      />
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description="A skill is only as strong as the projects, experience, and evidence behind it. Strength is derived, never self-rated."
        actions={
          <a href="#add-skill" className={buttonVariants({ size: 'sm' })}>
            Add a skill
          </a>
        }
      />

      <Collapsible
        title="How strength is calculated"
        headingLevel={2}
        storageKey="skills:rules"
        contentClassName="space-y-3 text-sm"
      >
        <dl className="space-y-2">
          {SKILL_STRENGTH_RULES.levels.map((l) => (
            <div
              key={l.level}
              className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3"
            >
              <dt className="sm:w-32 sm:shrink-0">
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
      </Collapsible>

      {graph.skills.length === 0 ? (
        <EmptyState
          title="No skills yet"
          description="Add a skill below, or accept a detected technology. Then link each skill to the projects and experience that demonstrate it."
          action={
            <a href="#add-skill" className={buttonVariants({ size: 'sm' })}>
              Add your first skill
            </a>
          }
        />
      ) : (
        <section aria-labelledby="skills-heading" className="space-y-3">
          <h2 id="skills-heading" className="sr-only">
            Your skills
          </h2>
          <FilterableList
            label="Filter skills"
            items={items}
            initial={initial}
            search={{ label: 'Search', placeholder: 'Skill name' }}
            facets={[
              ...(categories.length > 0
                ? [
                    {
                      param: 'category',
                      label: 'Category',
                      options: [
                        ...categories.map((c) => ({ value: c, label: categoryLabel(c) })),
                        { value: '__none__', label: 'Uncategorized' },
                      ],
                    },
                  ]
                : []),
              {
                param: 'strength',
                label: 'Strength',
                kind: 'chips' as const,
                options: levelsPresent,
              },
            ]}
            sorts={[
              { value: 'strength', label: 'Strength' },
              { value: 'recency', label: 'Recency' },
              { value: 'evidence', label: 'Evidence count' },
              { value: 'name', label: 'Name', dir: 'asc' },
            ]}
            noun={{ singular: 'skill', plural: 'skills' }}
            expandControls
          />
        </section>
      )}

      <Collapsible
        title="Detected technologies not yet in your skills"
        count={suggestions.length}
        meta={<TonePill tone="warning">Inferred</TonePill>}
        summary="Matched from your project and experience text. Nothing is added until you click Add."
        headingLevel={2}
        defaultOpen={suggestions.length > 0 && suggestions.length <= 6}
        storageKey="skills:detected"
      >
        {suggestions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No new technologies detected.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((s) => (
              <li
                key={s.name}
                className="border-border rounded-md border px-3 py-2 text-sm"
              >
                <Mutation readOnly={readOnly}>
                  <ActionForm
                    action={addSkillAction}
                    submitLabel={`Add ${s.name}`}
                    variant="outline"
                  >
                    <input type="hidden" name="name" value={s.name} />
                    <input
                      type="hidden"
                      name="category"
                      value={categoryLabel(s.category)}
                    />
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
                </Mutation>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible
        id="add-skill"
        title="Add a skill"
        headingLevel={2}
        defaultOpen={graph.skills.length === 0}
      >
        <Mutation readOnly={readOnly}>
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
          <p className="text-muted-foreground mt-2 text-xs">
            A new skill starts at “No evidence” until you link it to a project or
            experience.
          </p>
        </Mutation>
      </Collapsible>
    </div>
  );
}

function SkillRow({
  row,
  graph,
  evidenceIndex,
  readOnly,
}: {
  row: RankedSkillStrength;
  graph: EvidenceGraphData;
  evidenceIndex: SupportingEvidenceIndex;
  readOnly?: boolean;
}) {
  const { skill, strength } = row;
  const projects = strength.supportingEntities.filter((e) => e.type === 'PROJECT');
  const experiences = strength.supportingEntities.filter((e) => e.type === 'EXPERIENCE');
  const evidence = skillEvidenceItems(
    graph,
    skill.id,
    strength.supportingEntities.map((e) => e.id),
    evidenceIndex,
  );
  const linkedIds = new Set(strength.supportingEntities.map((e) => e.id));
  const linkable = [
    ...graph.projects
      .filter((p) => !linkedIds.has(p.id))
      .map((p) => ({ value: `PROJECT:${p.id}`, label: `Project: ${p.name}` })),
    ...graph.experiences
      .filter((e) => !linkedIds.has(e.id))
      .map((e) => ({
        value: `EXPERIENCE:${e.id}`,
        label: `Experience: ${e.title} at ${e.company}`,
      })),
  ];

  const counts = [
    `${projects.length} project${projects.length === 1 ? '' : 's'}`,
    `${experiences.length} role${experiences.length === 1 ? '' : 's'}`,
    `${strength.evidenceCount} evidence (${strength.verifiedEvidenceCount} verified)`,
  ].join(' · ');

  return (
    <Collapsible
      variant="row"
      headingLevel={3}
      title={skill.name}
      meta={
        <>
          {skill.category ? (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {categoryLabel(skill.category)}
            </span>
          ) : null}
          <StrengthBadge level={strength.level} />
        </>
      }
      summary={`${recencyLabel(strength.recency, strength.latestActivity)} · ${counts}`}
      contentClassName="space-y-4 text-sm"
    >
      <div>
        <SubHeading>Why this strength</SubHeading>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {strength.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-1 text-xs">
          {qualityLabel(strength.quality)}.
        </p>
      </div>

      <div>
        <SubHeading>Supporting items</SubHeading>
        {strength.supportingEntities.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Not linked to anything yet.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {strength.supportingEntities.map((e) => {
              const href = entityHref(e.type, e.id);
              return (
                <li key={`${e.type}:${e.id}`}>
                  {href ? (
                    <Link
                      href={href}
                      className="border-border hover:bg-accent focus-visible:ring-ring inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2"
                    >
                      <span className="text-muted-foreground">
                        {categoryLabel(e.type)}:
                      </span>
                      {e.name}
                    </Link>
                  ) : (
                    <span className="border-border inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs">
                      <span className="text-muted-foreground">
                        {categoryLabel(e.type)}:
                      </span>
                      {e.name}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <SubHeading>Evidence</SubHeading>
        {evidence.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">No evidence attached.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {evidence.map((item) => {
              const href = safeHttpHref(item.evidence.sourceUrl);
              return (
                <li
                  key={item.evidence.id}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <VerificationBadge state={item.evidence.verificationState} />
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {item.evidence.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span>{item.evidence.title}</span>
                  )}
                  <span className="text-muted-foreground">
                    {categoryLabel(item.evidence.sourceType)}
                    {item.countsAsVerified ? ' · counts as verified' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Mutation readOnly={readOnly}>
        <div className="border-border flex flex-wrap items-end justify-between gap-3 border-t pt-3">
          {linkable.length > 0 ? (
            <ActionForm
              action={linkSkillAction}
              submitLabel="Link"
              variant="outline"
              className="min-w-0 flex-1 basis-56"
            >
              <input type="hidden" name="skillId" value={skill.id} />
              <Label htmlFor={`link-${skill.id}`}>Link to a project or experience</Label>
              <Select
                id={`link-${skill.id}`}
                name="target"
                required
                defaultValue=""
                className="mt-1"
              >
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
          <ActionForm
            action={deleteSkillAction}
            submitLabel="Delete skill"
            pendingLabel="Deleting…"
            variant="ghost"
            confirmMessage={`Delete the skill "${skill.name}"? Its links to projects and experience are removed; the projects and evidence themselves are kept.`}
          >
            <input type="hidden" name="id" value={skill.id} />
          </ActionForm>
        </div>
      </Mutation>
    </Collapsible>
  );
}
