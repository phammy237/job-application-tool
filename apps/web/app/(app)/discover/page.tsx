import { listDiscoveryLocationTokens, listOwnDiscoveryFeed } from '@career-os/database';
import {
  DISCOVERY_ELIGIBILITY_STATUS_OPTIONS,
  DISCOVERY_EMPLOYMENT_TYPE_OPTIONS,
  DISCOVERY_FEED_PAGE_SIZE,
  DISCOVERY_ROLE_FAMILY_OPTIONS,
  DISCOVERY_WORKPLACE_TYPE_OPTIONS,
  parseDiscoveryFeedQuery,
  type DiscoveryFeedFilters,
} from '@career-os/shared';
import { Button, Input, Label, Select } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { JobCard } from './job-card';

const ROLE_FAMILY_LABELS: Record<string, string> = {
  PRODUCT_MANAGEMENT: 'Product Management',
  TECHNICAL_PROGRAM_MANAGEMENT: 'Technical Program Management',
  PRODUCT_ANALYTICS: 'Product Analytics',
  DATA_ANALYTICS: 'Data Analytics',
  DATA_SCIENCE: 'Data Science',
  SOFTWARE_ENGINEERING: 'Software Engineering',
  BUSINESS_ANALYTICS: 'Business Analytics',
  STRATEGY_OPERATIONS: 'Strategy & Operations',
  CONSULTING: 'Consulting',
};

const WORKPLACE_LABELS: Record<string, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
};

const ELIGIBILITY_FILTER_LABELS: Record<string, string> = {
  ELIGIBLE: 'No conflicts found',
  UNKNOWN: 'Eligibility unknown',
  CONFLICT: 'Possible conflict',
};

const FRESHNESS_OPTIONS = [
  { value: '1', label: 'Past 24 hours' },
  { value: '3', label: 'Past 3 days' },
  { value: '7', label: 'Past week' },
  { value: '14', label: 'Past 2 weeks' },
  { value: '30', label: 'Past month' },
];

/** `NEW_YORK_NY` -> `New York NY`, `UNITED_STATES` -> `United States` — purely cosmetic; the
 * value actually submitted is always the raw token from `list_discovery_location_tokens`, never
 * this label. */
function formatLocationTokenLabel(token: string): string {
  return token
    .split('_')
    .map((part) => (part.length <= 2 ? part : part[0] + part.slice(1).toLowerCase()))
    .join(' ');
}

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Rebuilds the current query string with only `page` replaced — every other filter is carried
 * forward so Prev/Next never silently drop a filter (docs/JOB_DISCOVERY.md "URL state"). */
function buildPageHref(raw: RawSearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'page' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/discover?${qs}` : '/discover';
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const filters: DiscoveryFeedFilters = parseDiscoveryFeedQuery(rawSearchParams);

  // RLS + `list_own_discovery_feed`'s own `auth.uid()` scoping (migration 0031) enforce
  // ownership; `requireUser()` here is purely the auth *gate* (redirect to /login when
  // unauthenticated), same posture as extension-connect/page.tsx — this page never needs the
  // user's id directly.
  await requireUser();
  const supabase = await createClient();

  const [feedPage, locationTokens] = await Promise.all([
    listOwnDiscoveryFeed(supabase, filters, { pageSize: DISCOVERY_FEED_PAGE_SIZE }),
    listDiscoveryLocationTokens(supabase),
  ]);

  const now = new Date();
  const hasAnyFilter =
    filters.search !== null ||
    filters.roleFamilies !== null ||
    filters.locationToken !== null ||
    filters.workplaceTypes !== null ||
    filters.employmentTypes !== null ||
    filters.eligibilityStatuses !== null ||
    filters.minMatch !== null ||
    filters.minCoverage !== null ||
    filters.freshnessDays !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Jobs ranked against your scoring and eligibility profile. Match and Coverage are always
          shown separately — Coverage reflects how much of Match a posting gave Career OS enough
          information to evaluate, not how good the job is.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.search ?? ''}
            placeholder="Title, company, or location"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role family</Label>
          <Select id="role" name="role" defaultValue={filters.roleFamilies?.[0] ?? ''}>
            <option value="">Any role</option>
            {DISCOVERY_ROLE_FAMILY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ROLE_FAMILY_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Select id="location" name="location" defaultValue={filters.locationToken ?? ''}>
            <option value="">Any location</option>
            {locationTokens.map((token) => (
              <option key={token} value={token}>
                {formatLocationTokenLabel(token)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workplace">Workplace</Label>
          <Select id="workplace" name="workplace" defaultValue={filters.workplaceTypes?.[0] ?? ''}>
            <option value="">Any workplace</option>
            {DISCOVERY_WORKPLACE_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {WORKPLACE_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="employment">Employment type</Label>
          <Select
            id="employment"
            name="employment"
            defaultValue={filters.employmentTypes?.[0] ?? ''}
          >
            <option value="">Any employment type</option>
            {DISCOVERY_EMPLOYMENT_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {EMPLOYMENT_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eligibility">Eligibility</Label>
          <Select
            id="eligibility"
            name="eligibility"
            defaultValue={filters.eligibilityStatuses?.[0] ?? ''}
          >
            <option value="">Any eligibility</option>
            {DISCOVERY_ELIGIBILITY_STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ELIGIBILITY_FILTER_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor="minMatch">Min Match</Label>
          <Input
            id="minMatch"
            name="minMatch"
            type="number"
            min={0}
            max={100}
            defaultValue={filters.minMatch ?? ''}
            placeholder="0-100"
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor="minCoverage">Min Coverage</Label>
          <Input
            id="minCoverage"
            name="minCoverage"
            type="number"
            min={0}
            max={100}
            defaultValue={filters.minCoverage ?? ''}
            placeholder="0-100"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="freshness">Posted</Label>
          <Select
            id="freshness"
            name="freshness"
            defaultValue={filters.freshnessDays !== null ? String(filters.freshnessDays) : ''}
          >
            <option value="">Any time</option>
            {FRESHNESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {hasAnyFilter ? (
          <Link href="/discover" className="text-muted-foreground text-sm hover:underline">
            Clear filters
          </Link>
        ) : null}
      </form>

      {feedPage.items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {hasAnyFilter
            ? 'No jobs match your search and filters.'
            : "No ranked jobs yet. Once Career OS has scored jobs against your profile, they'll show up here."}
        </p>
      ) : (
        <div className="space-y-3">
          {feedPage.items.map((job) => (
            <JobCard key={job.jobCatalogId} job={job} now={now} />
          ))}
        </div>
      )}

      {filters.page > 1 || feedPage.hasNextPage ? (
        <div className="flex items-center justify-between pt-2">
          {filters.page > 1 ? (
            <Link
              href={buildPageHref(rawSearchParams, filters.page - 1)}
              className="text-muted-foreground text-sm hover:underline"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground text-sm">Page {filters.page}</span>
          {feedPage.hasNextPage ? (
            <Link
              href={buildPageHref(rawSearchParams, filters.page + 1)}
              className="text-muted-foreground text-sm hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}
