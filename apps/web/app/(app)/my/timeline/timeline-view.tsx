import {
  buildGraphIndex,
  buildTimeline,
  type EvidenceGraphData,
  type TimelineEntry,
} from '@career-os/shared';
import { buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { EmptyState, TonePill, VerificationBadge } from '../_components/badges';
import { Collapsible } from '../_components/collapsible';
import { FilterableList, type FilterItem } from '../_components/filterable-list';
import type { FilterState } from '../_components/filter-state';
import { PageHeader } from '../_components/page-header';
import {
  TIMELINE_TYPES,
  TYPE_LABELS,
  availableYears,
  entryYears,
  formatRange,
  groupByYear,
  resolveEntryHref,
} from './helpers';

function EntryRow({ entry }: { entry: TimelineEntry }) {
  const href = resolveEntryHref(entry);
  return (
    <Collapsible
      variant="row"
      headingLevel={3}
      title={entry.title}
      meta={
        <>
          <VerificationBadge state={entry.verificationState} />
          <Link
            href={href}
            className="text-primary focus-visible:ring-ring inline-flex min-h-10 items-center rounded-md px-1.5 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2"
          >
            Open<span className="sr-only"> {entry.title}</span>
          </Link>
        </>
      }
      summary={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TonePill tone="neutral">{TYPE_LABELS[entry.type]}</TonePill>
          <span className={entry.isOngoing ? 'text-foreground font-medium' : undefined}>
            {formatRange(entry)}
          </span>
          {entry.subtitle ? <span>· {entry.subtitle}</span> : null}
        </span>
      }
      contentClassName="space-y-1 text-sm"
    >
      <p>
        <span className="text-muted-foreground">Evidence: </span>
        {entry.evidenceCount > 0
          ? `${entry.evidenceCount} item${entry.evidenceCount === 1 ? '' : 's'}`
          : 'none linked yet'}
      </p>
      <p>
        <span className="text-muted-foreground">Skills: </span>
        {entry.relatedSkillNames.length > 0
          ? entry.relatedSkillNames.join(', ')
          : 'none linked'}
      </p>
    </Collapsible>
  );
}

export interface TimelineViewProps {
  graph: EvidenceGraphData;
  initial: FilterState;
  now?: Date;
}

export function TimelineView({ graph, initial, now = new Date() }: TimelineViewProps) {
  const index = buildGraphIndex(graph);
  const everything = buildTimeline(index, { now });
  const total = everything.entries.length + everything.undated.length;
  const groups = groupByYear(everything.entries, now);
  const years = availableYears(everything.entries, now);
  const presentTypes = TIMELINE_TYPES.filter((t) =>
    [...everything.entries, ...everything.undated].some((e) => e.type === t),
  );
  const skillIdsByName = new Map<string, string[]>();
  for (const s of graph.skills)
    skillIdsByName.set(s.name, [...(skillIdsByName.get(s.name) ?? []), s.id]);
  const skillOptions = graph.skills
    .map((s) => ({ value: s.id, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const toItem = (entry: TimelineEntry, group: string, dated: boolean): FilterItem => ({
    id: entry.id,
    group,
    text: `${entry.title} ${entry.subtitle ?? ''} ${entry.relatedSkillNames.join(' ')}`.toLowerCase(),
    facets: {
      type: entry.type,
      // Undated entries cannot be placed in a year, so the year filter does not apply to them.
      year: dated ? entryYears(entry, now).map(String) : ['*'],
      skill: entry.relatedSkillNames.flatMap((n) => skillIdsByName.get(n) ?? []),
    },
    node: <EntryRow entry={entry} />,
  });
  const items: FilterItem[] = [
    ...groups.flatMap((g) => g.entries.map((e) => toItem(e, String(g.year), true))),
    ...everything.undated.map((e) => toItem(e, 'undated', false)),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timeline"
        description="Work, projects, education, and achievements in one chronological view."
        actions={
          <Link
            href="/my/achievements"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Manage achievements
          </Link>
        }
      />

      {total === 0 ? (
        <EmptyState
          title="Nothing on your timeline yet"
          description="Add experience or projects, connect GitHub, or record an achievement to start building it."
          action={
            <Link href="/my/achievements" className={buttonVariants({ size: 'sm' })}>
              Add an achievement
            </Link>
          }
        />
      ) : (
        <FilterableList
          label="Filter timeline"
          items={items}
          initial={initial}
          search={{ label: 'Search', placeholder: 'Title, organization, or skill' }}
          facets={[
            {
              param: 'type',
              label: 'Type',
              kind: 'chips',
              options: presentTypes.map((t) => ({ value: t, label: TYPE_LABELS[t] })),
            },
            {
              param: 'year',
              label: 'Year',
              allLabel: 'Any year',
              options: years.map((y) => ({ value: String(y), label: String(y) })),
            },
            ...(skillOptions.length > 0
              ? [
                  {
                    param: 'skill',
                    label: 'Skill',
                    allLabel: 'Any skill',
                    options: skillOptions,
                  },
                ]
              : []),
          ]}
          groups={[
            ...groups.map((g, i) => ({
              key: String(g.year),
              label: String(g.year),
              defaultOpen: i < 3,
            })),
            {
              key: 'undated',
              label: 'Undated',
              description:
                'These have no dates, so they cannot be placed in time. Add dates to see them above. The year filter does not apply here.',
            },
          ]}
          groupStorageKey="timeline:year"
          as="ol"
          noun={{ singular: 'entry', plural: 'entries' }}
          expandControls
          listClassName="border-border ml-1 space-y-2 border-l-2 pl-3 sm:pl-4"
        />
      )}
    </div>
  );
}
