import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import {
  normalizedEmploymentTypeSchema,
  normalizedWorkplaceTypeSchema,
  roleFamilySchema,
  senioritySchema,
} from './job-role-taxonomy';

const sponsorshipSignalSchema = z.enum(['AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN']);
const citizenshipRequirementSchema = z.enum(['US_CITIZEN_ONLY', 'UNKNOWN']);
const clearanceRequirementSchema = z.enum([
  'ACTIVE_CLEARANCE_REQUIRED',
  'CLEARANCE_ELIGIBILITY_REQUIRED',
  'UNKNOWN',
]);
const workAuthorizationRequirementSchema = z.enum(['AUTHORIZATION_REQUIRED', 'UNKNOWN']);

/** Bounded, deterministic-template evidence snippets captured at extraction time — never raw
 * model output (there is no model), never unbounded. */
export const jobCatalogFeatureEvidenceSchema = z.object({
  sponsorship: z.string().nullable().optional(),
  citizenship: z.string().nullable().optional(),
  clearance: z.string().nullable().optional(),
  workAuthorization: z.string().nullable().optional(),
});
export type JobCatalogFeatureEvidence = z.infer<typeof jobCatalogFeatureEvidenceSchema>;

/**
 * The persisted `job_catalog_features` row (docs/JOB_DISCOVERY.md "Job feature model") — global,
 * user-independent, deterministic. One row per `job_catalog` row. Every classification enum here
 * uses an explicit `UNKNOWN` member (unlike `job_catalog` itself, which uses `null` for "not
 * specified") since this table exists specifically to represent "what could Career OS determine"
 * as a first-class value, not an absence.
 */
export const jobCatalogFeaturesSchema = z.object({
  id: uuidSchema,
  jobCatalogId: uuidSchema,
  contentHashAtExtraction: z.string().min(1),

  plainTextDescription: z.string(),

  roleFamily: roleFamilySchema,
  seniority: senioritySchema,
  isInternship: z.boolean(),
  isNewGrad: z.boolean(),

  normalizedEmploymentType: normalizedEmploymentTypeSchema,
  normalizedWorkplaceType: normalizedWorkplaceTypeSchema,

  locationTokens: z.array(z.string()),

  extractedCompetencyCodes: z.array(z.string()),

  requiredYearsMin: z.number().int().nullable(),
  requiredYearsMax: z.number().int().nullable(),

  graduationYearMin: z.number().int().nullable(),
  graduationYearMax: z.number().int().nullable(),

  sponsorshipSignal: sponsorshipSignalSchema,
  citizenshipRequirement: citizenshipRequirementSchema,
  clearanceRequirement: clearanceRequirementSchema,
  workAuthorizationRequirement: workAuthorizationRequirementSchema,

  evidence: jobCatalogFeatureEvidenceSchema,

  featureVersion: z.string().min(1),
  computedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type JobCatalogFeatures = z.infer<typeof jobCatalogFeaturesSchema>;
