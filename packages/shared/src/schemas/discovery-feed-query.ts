import { z } from 'zod';
import {
  normalizedEmploymentTypeSchema,
  normalizedWorkplaceTypeSchema,
  roleFamilySchema,
  type NormalizedEmploymentType,
  type NormalizedWorkplaceType,
  type RoleFamily,
} from './job-role-taxonomy';
import { eligibilityStatusSchema, type EligibilityStatus } from './eligibility-check';

/** The role-family/workplace-type/employment-type values the /discover filter UI offers —
 * deliberately excludes each enum's own `UNKNOWN` member: filtering *to* "unknown role" isn't a
 * meaningful positive user intent the way it is for Eligibility (where UNKNOWN is a real,
 * useful filter target — "show me jobs I can't yet evaluate"). Never invents a filter value not
 * already supported by the normalized D4 data. */
export const DISCOVERY_ROLE_FAMILY_OPTIONS = roleFamilySchema.options.filter(
  (value) => value !== 'UNKNOWN',
);
export const DISCOVERY_WORKPLACE_TYPE_OPTIONS = normalizedWorkplaceTypeSchema.options.filter(
  (value) => value !== 'UNKNOWN',
);
export const DISCOVERY_EMPLOYMENT_TYPE_OPTIONS = normalizedEmploymentTypeSchema.options.filter(
  (value) => value !== 'UNKNOWN',
);
export const DISCOVERY_ELIGIBILITY_STATUS_OPTIONS = eligibilityStatusSchema.options;

export const DISCOVERY_FEED_PAGE_SIZE = 20;

/** Raw shape a Next.js server component's `searchParams` arrives as — every value is optional,
 * and a repeated query-string key (checkbox groups) comes through as a string array. */
const rawStringOrArray = z.union([z.string(), z.array(z.string())]).optional();

const discoveryFeedRawQuerySchema = z.object({
  q: z.string().optional(),
  role: rawStringOrArray,
  location: z.string().optional(),
  workplace: rawStringOrArray,
  employment: rawStringOrArray,
  eligibility: rawStringOrArray,
  minMatch: z.string().optional(),
  minCoverage: z.string().optional(),
  freshness: z.string().optional(),
  page: z.string().optional(),
});
export type DiscoveryFeedRawQuery = z.infer<typeof discoveryFeedRawQuerySchema>;

export interface DiscoveryFeedFilters {
  search: string | null;
  roleFamilies: RoleFamily[] | null;
  locationToken: string | null;
  workplaceTypes: NormalizedWorkplaceType[] | null;
  employmentTypes: NormalizedEmploymentType[] | null;
  eligibilityStatuses: EligibilityStatus[] | null;
  minMatch: number | null;
  minCoverage: number | null;
  freshnessDays: number | null;
  /** 1-based page number. */
  page: number;
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function clampPercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, parsed));
}

function clampPositiveInt(raw: string | undefined, max: number): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(max, parsed);
}

/**
 * Parses and validates a `/discover` request's raw query params into a clean filter object —
 * never throws, never crashes the page on a malformed/unexpected value (docs/JOB_DISCOVERY.md
 * "URL state"). An unrecognized enum value in `role`/`workplace`/`employment`/`eligibility` is
 * silently dropped rather than rejected outright, so a stale bookmarked URL (e.g. from before a
 * filter option was renamed) degrades to "no filter" instead of an error page.
 */
export function parseDiscoveryFeedQuery(raw: unknown): DiscoveryFeedFilters {
  const parsedRaw = discoveryFeedRawQuerySchema.safeParse(raw);
  const input: DiscoveryFeedRawQuery = parsedRaw.success ? parsedRaw.data : {};

  const search = input.q?.trim();
  const location = input.location?.trim();

  const roleFamilies = toArray(input.role).filter((value): value is RoleFamily =>
    (DISCOVERY_ROLE_FAMILY_OPTIONS as readonly string[]).includes(value),
  );
  const workplaceTypes = toArray(input.workplace).filter(
    (value): value is NormalizedWorkplaceType =>
      (DISCOVERY_WORKPLACE_TYPE_OPTIONS as readonly string[]).includes(value),
  );
  const employmentTypes = toArray(input.employment).filter(
    (value): value is NormalizedEmploymentType =>
      (DISCOVERY_EMPLOYMENT_TYPE_OPTIONS as readonly string[]).includes(value),
  );
  const eligibilityStatuses = toArray(input.eligibility).filter(
    (value): value is EligibilityStatus =>
      (DISCOVERY_ELIGIBILITY_STATUS_OPTIONS as readonly string[]).includes(value),
  );

  const page = clampPositiveInt(input.page, 10_000) ?? 1;

  return {
    search: search && search.length > 0 ? search.slice(0, 200) : null,
    roleFamilies: roleFamilies.length > 0 ? roleFamilies : null,
    locationToken: location && location.length > 0 ? location.slice(0, 100) : null,
    workplaceTypes: workplaceTypes.length > 0 ? workplaceTypes : null,
    employmentTypes: employmentTypes.length > 0 ? employmentTypes : null,
    eligibilityStatuses: eligibilityStatuses.length > 0 ? eligibilityStatuses : null,
    minMatch: clampPercent(input.minMatch),
    minCoverage: clampPercent(input.minCoverage),
    freshnessDays: clampPositiveInt(input.freshness, 365),
    page,
  };
}
