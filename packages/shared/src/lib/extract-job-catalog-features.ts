import { htmlToPlainText } from './html-to-plain-text';
import { extractRoleFamily } from './extract-role-family';
import { extractSeniority } from './extract-seniority';
import { normalizeEmploymentType } from './normalize-employment-type';
import { normalizeWorkplaceType } from './normalize-workplace-type';
import { extractLocationTokens } from './extract-location-tokens';
import { matchCompetencyConcepts } from './competency-registry';
import { extractExperienceYears } from './extract-experience-years';
import { extractGraduationWindow } from './extract-graduation-window';
import { extractSponsorshipSignal } from './extract-sponsorship-signal';
import { extractCitizenshipRequirement } from './extract-citizenship-requirement';
import { extractClearanceRequirement } from './extract-clearance-requirement';
import { extractWorkAuthorizationRequirement } from './extract-work-authorization-requirement';
import type { JobCatalogFeatureEvidence } from '../schemas/job-catalog-features';
import type {
  NormalizedEmploymentType,
  NormalizedWorkplaceType,
  RoleFamily,
  Seniority,
} from '../schemas/job-role-taxonomy';

/** Bump when any extraction rule changes meaning — every stored `job_catalog_features` row
 * carries the version active when it was computed, so a version mismatch is how stale rows are
 * found for recomputation (docs/JOB_DISCOVERY.md "Versioning"). */
export const JOB_CATALOG_FEATURE_VERSION = 'd4-features-v2';

export interface ExtractJobCatalogFeaturesInput {
  title: string;
  description: string | null;
  locationText: string | null;
  employmentType: string | null;
  workplaceType: 'REMOTE' | 'HYBRID' | 'ONSITE' | null;
  contentHash: string;
}

export interface ExtractedJobCatalogFeatures {
  contentHashAtExtraction: string;
  plainTextDescription: string;
  roleFamily: RoleFamily;
  seniority: Seniority;
  isInternship: boolean;
  isNewGrad: boolean;
  normalizedEmploymentType: NormalizedEmploymentType;
  normalizedWorkplaceType: NormalizedWorkplaceType;
  locationTokens: string[];
  extractedCompetencyCodes: string[];
  requiredYearsMin: number | null;
  requiredYearsMax: number | null;
  graduationYearMin: number | null;
  graduationYearMax: number | null;
  sponsorshipSignal: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  citizenshipRequirement: 'US_CITIZEN_ONLY' | 'UNKNOWN';
  clearanceRequirement: 'ACTIVE_CLEARANCE_REQUIRED' | 'CLEARANCE_ELIGIBILITY_REQUIRED' | 'UNKNOWN';
  workAuthorizationRequirement: 'AUTHORIZATION_REQUIRED' | 'UNKNOWN';
  evidence: JobCatalogFeatureEvidence;
  featureVersion: string;
}

/**
 * The single entry point tying every deterministic D4 extractor together into one
 * `job_catalog_features` row's worth of data (docs/JOB_DISCOVERY.md "Job feature model") — pure,
 * synchronous, no I/O, no AI. `packages/discovery`'s orchestration layer is the only caller;
 * everything here operates purely on the values it's given.
 */
export function extractJobCatalogFeatures(
  input: ExtractJobCatalogFeaturesInput,
): ExtractedJobCatalogFeatures {
  const plainTextDescription = input.description ? htmlToPlainText(input.description) : '';

  const roleFamily = extractRoleFamily(input.title);
  const seniority = extractSeniority(input.title);
  const normalizedEmploymentType = normalizeEmploymentType(input.employmentType);
  const normalizedWorkplaceType = normalizeWorkplaceType(input.workplaceType, input.locationText);
  const locationTokens = extractLocationTokens(input.locationText);
  const extractedCompetencyCodes = matchCompetencyConcepts(plainTextDescription);

  const experienceYears = extractExperienceYears(plainTextDescription);
  const graduationWindow = extractGraduationWindow(plainTextDescription);
  const sponsorship = extractSponsorshipSignal(plainTextDescription);
  const citizenship = extractCitizenshipRequirement(plainTextDescription);
  const clearance = extractClearanceRequirement(plainTextDescription);
  const workAuthorization = extractWorkAuthorizationRequirement(plainTextDescription);

  // Internship detection uses BOTH the normalized employment-type field AND title patterns
  // (docs/JOB_DISCOVERY.md "Employment type normalization") — Greenhouse never populates
  // employment_type at all, so title is the only signal available for its internship postings.
  const isInternship = normalizedEmploymentType === 'INTERNSHIP' || seniority === 'INTERN';
  const isNewGrad = seniority === 'NEW_GRAD';

  return {
    contentHashAtExtraction: input.contentHash,
    plainTextDescription,
    roleFamily,
    seniority,
    isInternship,
    isNewGrad,
    normalizedEmploymentType,
    normalizedWorkplaceType,
    locationTokens,
    extractedCompetencyCodes,
    requiredYearsMin: experienceYears?.min ?? null,
    requiredYearsMax: experienceYears?.max ?? null,
    graduationYearMin: graduationWindow?.min ?? null,
    graduationYearMax: graduationWindow?.max ?? null,
    sponsorshipSignal: sponsorship.signal,
    citizenshipRequirement: citizenship.requirement,
    clearanceRequirement: clearance.requirement,
    workAuthorizationRequirement: workAuthorization.requirement,
    evidence: {
      sponsorship: sponsorship.evidence,
      citizenship: citizenship.evidence,
      clearance: clearance.evidence,
      workAuthorization: workAuthorization.evidence,
    },
    featureVersion: JOB_CATALOG_FEATURE_VERSION,
  };
}
