import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { roleFamilySchema } from './job-role-taxonomy';

/**
 * D4 V1 supported ranking criteria (docs/JOB_DISCOVERY.md "Match Score"). A closed, system-owned
 * registry — users choose importance (0-10) and preferences within these criteria, but cannot
 * define their own. New system-supported criteria can be added to this enum later without
 * redesigning the scoring engine (`compute-match-score.ts` iterates this list generically).
 * Deliberately excludes salary, ATS provider, company popularity, applicant counts, employer
 * size, and raw provider `posted_at` — see docs/JOB_DISCOVERY.md for why each is out of scope.
 */
export const scoringCriterionSchema = z.enum([
  'ROLE_FIT',
  'COMPETENCY_FIT',
  'SENIORITY_FIT',
  'LOCATION_FIT',
  'WORK_MODE_FIT',
  'EMPLOYMENT_TYPE_FIT',
  'OBSERVED_FRESHNESS',
]);
export type ScoringCriterion = z.infer<typeof scoringCriterionSchema>;
export const ALL_SCORING_CRITERIA = scoringCriterionSchema.options;

/** Integer 0-10: 0 disables the criterion (excluded entirely, not scored as zero-fit). */
const importanceSchema = z.number().int().min(0).max(10);

export const criteriaWeightsSchema = z.record(scoringCriterionSchema, importanceSchema);
export type CriteriaWeights = z.infer<typeof criteriaWeightsSchema>;

/** 0-10 preference strength for a specific role family the user has explicitly rated. A family
 * absent from this map is treated as UNKNOWN for that user (docs/JOB_DISCOVERY.md "Role"), not
 * as an implicit 0 — the same "missing data never penalizes" rule applied symmetrically to
 * missing *user* data, not just missing job data. */
export const rolePreferencesSchema = z.record(roleFamilySchema, importanceSchema);
export type RolePreferences = z.infer<typeof rolePreferencesSchema>;

export const senioritySchemaForPreferences = z.enum([
  'INTERN',
  'NEW_GRAD',
  'ENTRY',
  'MID',
  'SENIOR',
  'STAFF',
  'PRINCIPAL',
  'MANAGER',
  'DIRECTOR_PLUS',
]);
export const seniorityPreferencesSchema = z.record(senioritySchemaForPreferences, importanceSchema);
export type SeniorityPreferences = z.infer<typeof seniorityPreferencesSchema>;

/**
 * Location preference categories (docs/JOB_DISCOVERY.md "Location"). EXCLUDE is a hard personal
 * filter, not a numeric fit value — a job with any EXCLUDE-matching location token is removed
 * from consideration entirely rather than scored (docs/JOB_DISCOVERY.md "User hard preference
 * exclusions") and is never conflated with Eligibility.
 */
export const locationPreferenceCategorySchema = z.enum([
  'PREFERRED',
  'ACCEPTABLE',
  'AVOID',
  'EXCLUDE',
]);
export type LocationPreferenceCategory = z.infer<typeof locationPreferenceCategorySchema>;

/** Keyed by a location token from `extract-location-tokens.ts` (e.g. "NEW_YORK_NY",
 * "UNITED_STATES"). A token absent from this map is UNKNOWN for that user. */
export const locationPreferencesSchema = z.record(z.string(), locationPreferenceCategorySchema);
export type LocationPreferences = z.infer<typeof locationPreferencesSchema>;

export const workModeSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE']);
export const workModePreferencesSchema = z.record(workModeSchema, importanceSchema);
export type WorkModePreferences = z.infer<typeof workModePreferencesSchema>;

export const employmentTypeForPreferencesSchema = z.enum([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
]);
export const employmentTypePreferencesSchema = z.record(
  employmentTypeForPreferencesSchema,
  importanceSchema,
);
export type EmploymentTypePreferences = z.infer<typeof employmentTypePreferencesSchema>;

export const discoveryScoringPresetSchema = z.enum([
  'BALANCED',
  'CAREER_FIT_FIRST',
  'LOCATION_FIRST',
  'CUSTOM',
]);
export type DiscoveryScoringPreset = z.infer<typeof discoveryScoringPresetSchema>;

/**
 * The persisted `discovery_scoring_profiles` row (docs/JOB_DISCOVERY.md "Discovery Scoring
 * Profile"). One scoring engine, one structure — a preset only pre-populates these same editable
 * fields; it never forks the algorithm (docs/JOB_DISCOVERY.md "Default profile vs custom
 * profile"). `profileVersion` is a schema-shape version for this row (distinct from
 * `rankingVersion`, the scoring-engine version stamped onto computed match scores).
 */
export const discoveryScoringProfileSchema = z.object({
  userId: uuidSchema,
  profileVersion: z.string().min(1),
  preset: discoveryScoringPresetSchema,
  criteriaWeights: criteriaWeightsSchema,
  rolePreferences: rolePreferencesSchema,
  seniorityPreferences: seniorityPreferencesSchema,
  locationPreferences: locationPreferencesSchema,
  workModePreferences: workModePreferencesSchema,
  employmentTypePreferences: employmentTypePreferencesSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DiscoveryScoringProfile = z.infer<typeof discoveryScoringProfileSchema>;

/** Everything a user can edit directly; userId/profileVersion/timestamps are server-derived. */
export const discoveryScoringProfileUpdateSchema = discoveryScoringProfileSchema
  .omit({ userId: true, profileVersion: true, createdAt: true, updatedAt: true })
  .partial();
export type DiscoveryScoringProfileUpdate = z.infer<typeof discoveryScoringProfileUpdateSchema>;
