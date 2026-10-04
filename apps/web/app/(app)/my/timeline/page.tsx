import { buildGraphIndex, buildTimeline, type TimelineEntry } from '@career-os/shared';
import { Badge, Label, Select, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../../lib/auth';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { EmptyState, VerificationBadge } from '../_components/badges';
import {
  TIMELINE_TYPES,
  TYPE_LABELS,
  availableYears,
  formatRange,
  groupByYear,
  parseTimelineParams,
  resolveEntryHref,
  timelineHref,
} from './helpers';

export const metadata = { title: 'Timeline · myOS' };

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={
        (active
          ? 'bg-primary text-primary-foreground border-transparent'
          : 'border-border hover:bg-accent') +
        ' focus-visible:ring-ring inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2'
      }
    >
      {children}
    </Link>
  );
}

function EntryItem({ entry }: { entry: TimelineEntry }) {
  return (
    <li className="border-border relative rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{TYPE_LABELS[entry.type]}</Badge>
            <Link
              href={resolveEntryHref(entry)}
              className="focus-visible:ring-ring font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
            >
              {entry.title}
            </Link>
          </p>
          {entry.subtitle ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{entry.subtitle}</p>
          ) : null}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {entry.isOngoing ? (
              <span className="text-foreground font-medium">{formatRange(entry)}</span>
            ) : (
              formatRange(entry)
            )}
            {entry.evidenceCount > 0
              ? ` · ${entry.evidenceCount} evidence item${entry.evidenceCount === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <VerificationBadge state={entry.verificationState} />
      </div>
      {entry.relatedSkillNames.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">
          Skills: {entry.relatedSkillNames.join(', ')}
        </p>
      ) : null}
    </li>
  );
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseTimelineParams(await searchParams);
  const user = await requireUser();
  const graph = await loadEvidenceGraphForRequest(user.id);
  const now = new Date();

  const index = buildGraphIndex(graph); // shared by both timeline builds below
  const everything = buildTimeline(index, { now });
  const total = everything.entries.length + everything.undated.length;
  const timeline = buildTimeline(index, {
    now,
    types: params.type ? [params.type] : undefined,
    year: params.year ?? undefined,
    skillId: params.skillId ?? undefined,
  });
  const groups = groupByYear(timeline.entries, now);
  const years = availableYears(everything.entries, now);
  const presentTypes = new Set(
    [...everything.entries, ...everything.undated].map((e) => e.type),
  );
  const skillsWithLinks = graph.skills
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filtered = !!(params.type || params.year || params.skillId);
  const shown = timeline.entries.length + timeline.undated.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Work, projects, education, and achievements in one chronological view.
          </p>
        </div>
        <Link
          href="/my/achievements"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Manage achievements
        </Link>
      </div>

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
        <>
          <section aria-label="Timeline filters" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-12 text-xs">Type</span>
              <Chip href={timelineHref(params, { type: null })} active={!params.type}>
                All
              </Chip>
              {TIMELINE_TYPES.filter((t) => presentTypes.has(t)).map((t) => (
                <Chip
                  key={t}
                  href={timelineHref(params, { type: t })}
                  active={params.type === t}
                >
                  {TYPE_LABELS[t]}
                </Chip>
              ))}
            </div>
            {years.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground w-12 text-xs">Year</span>
                <Chip
                  href={timelineHref(params, { year: null })}
                  active={params.year === null}
                >
                  All
                </Chip>
                {years.map((y) => (
                  <Chip
                    key={y}
                    href={timelineHref(params, { year: y })}
                    active={params.year === y}
                  >
                    {y}
                  </Chip>
                ))}
              </div>
            ) : null}
            {skillsWithLinks.length > 0 ? (
              <form
                method="get"
                action="/my/timeline"
                className="flex flex-wrap items-end gap-2"
              >
                {params.type ? (
                  <input type="hidden" name="type" value={params.type} />
                ) : null}
                {params.year ? (
                  <input type="hidden" name="year" value={params.year} />
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="tl-skill">Skill</Label>
                  <Select
                    id="tl-skill"
                    name="skill"
                    defaultValue={params.skillId ?? ''}
                    className="w-52"
                  >
                    <option value="">Any skill</option>
                    {skillsWithLinks.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="submit"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Apply
                </button>
                {filtered ? (
                  <Link
                    href="/my/timeline"
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    Clear filters
                  </Link>
                ) : null}
              </form>
            ) : null}
            <p className="text-muted-foreground text-xs" aria-live="polite">
              Showing {shown} of {total} entr{total === 1 ? 'y' : 'ies'}.
            </p>
          </section>

          {groups.length === 0 && timeline.undated.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No entries match these filters.
            </p>
          ) : null}

          {groups.map((group) => (
            <section key={group.year} aria-labelledby={`year-${group.year}`}>
              <h2 id={`year-${group.year}`} className="mb-2 text-lg font-semibold">
                {group.year}
              </h2>
              <ol className="border-border ml-1 space-y-2 border-l-2 pl-3 sm:pl-4">
                {group.entries.map((entry) => (
                  <EntryItem key={entry.id} entry={entry} />
                ))}
              </ol>
            </section>
          ))}

          {timeline.undated.length > 0 ? (
            <section aria-labelledby="undated-heading">
              <h2 id="undated-heading" className="mb-1 text-lg font-semibold">
                Undated
              </h2>
              <p className="text-muted-foreground mb-2 text-xs">
                These have no dates, so they cannot be placed in time. Add dates to see
                them above. The year filter does not apply here.
              </p>
              <ol className="border-border ml-1 space-y-2 border-l-2 border-dashed pl-3 sm:pl-4">
                {timeline.undated.map((entry) => (
                  <EntryItem key={entry.id} entry={entry} />
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
